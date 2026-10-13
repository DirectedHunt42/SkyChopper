#!/usr/bin/env bash
set -Eeuo pipefail

if [[ "$EUID" -ne 0 ]]; then
  echo "Run this script through the SkyChopper service or sudo" >&2
  exit 1
fi

STATE_DIR=/var/lib/skychopper
STATUS_FILE="$STATE_DIR/update-status"
LOG_FILE=/var/log/skychopper-update.log
LOCK_FILE=/run/lock/skychopper-update.lock
REPO_FILE=/etc/skychopper-update-repo
APT_UPGRADE_DECISION="$STATE_DIR/apt-upgrade-decision"
mkdir -p "$STATE_DIR"

set_status() {
  printf '%s\n' "$1" > "$STATUS_FILE"
  chmod 0644 "$STATUS_FILE"
}

case "${1:-}" in
  --approve-apt-upgrade|--decline-apt-upgrade)
    current_status="$(cat "$STATUS_FILE" 2>/dev/null || true)"
    case "$current_status" in
      "APT upgrade available:"*) ;;
      *) echo "No pending apt upgrade prompt" >&2; exit 1 ;;
    esac
    if [[ "$1" == "--approve-apt-upgrade" ]]; then
      printf 'upgrade\n' > "$APT_UPGRADE_DECISION"
    else
      printf 'skip\n' > "$APT_UPGRADE_DECISION"
    fi
    chmod 0644 "$APT_UPGRADE_DECISION"
    exit 0
    ;;
  --run) ;;
  "")
    exec 8>/run/lock/skychopper-update-start.lock
    if ! flock -n 8; then echo "An update is already starting" >&2; exit 1; fi
    current="$(cat "$STATUS_FILE" 2>/dev/null || true)"
    case "$current" in
      "Starting SkyChopper update..."|"Updating SkyChopper..."|"APT upgrade available:"*|"Upgrading system packages...")
        if ! flock -n "$LOCK_FILE" -c true; then echo "An update is already running" >&2; exit 1; fi
        ;;
    esac
    : > "$LOG_FILE"
    chmod 0644 "$LOG_FILE"
    set_status "Starting SkyChopper update..."
    if ! /usr/bin/systemd-run --quiet --collect --unit=skychopper-update \
      /usr/local/sbin/skychopper-update --run >>"$LOG_FILE" 2>&1; then
      set_status "Update failed to start. See the update log."
      exit 1
    fi
    exit 0
    ;;
  *) echo "Invalid updater invocation" >&2; exit 2 ;;
esac

REPO_DIR="$(cat "$REPO_FILE")"
exec >>"$LOG_FILE" 2>&1
exec 9>"$LOCK_FILE"
flock -n 9 || { echo "An update is already running"; exit 1; }
trap 'result=$?; if (( result != 0 )); then set_status "Update failed (exit $result). See the update log."; fi' EXIT
set_status "Updating SkyChopper..."
rm -f "$APT_UPGRADE_DECISION"

if [[ ! -d "$REPO_DIR/.git" || ! -f "$REPO_DIR/setup.sh" ]]; then
  echo "SkyChopper repository not found at $REPO_DIR" >&2
  exit 1
fi

REPO_OWNER="$(stat -c '%U' "$REPO_DIR")"
run_as_repo_owner() {
  if [[ "$REPO_OWNER" == root ]]; then "$@"; else runuser -u "$REPO_OWNER" -- "$@"; fi
}

echo "Resetting tracked changes in $REPO_DIR"
run_as_repo_owner git -C "$REPO_DIR" reset --hard
echo "Pulling updates"
run_as_repo_owner git -C "$REPO_DIR" pull

chmod +x "$REPO_DIR/setup.sh"
echo "Running SkyChopper setup"
cd "$REPO_DIR"
./setup.sh

echo "Refreshing package lists before checking for system upgrades"
apt-get update
upgradeable_count="$(apt-get --just-print upgrade | awk '/^Inst / { count++ } END { print count+0 }')"
if [[ "$upgradeable_count" -gt 0 ]]; then
  rm -f "$APT_UPGRADE_DECISION"
  echo "$upgradeable_count system package(s) can be upgraded"
  set_status "APT upgrade available: $upgradeable_count package(s). Waiting for confirmation."
  decision=""
  for _ in $(seq 1 300); do
    decision="$(cat "$APT_UPGRADE_DECISION" 2>/dev/null || true)"
    if [[ "$decision" == "upgrade" ]]; then
      set_status "Upgrading system packages..."
      echo "Starting apt upgrade"
      apt-get upgrade -y
      break
    elif [[ "$decision" == "skip" ]]; then
      echo "APT upgrade declined"
      break
    fi
    sleep 1
  done
  rm -f "$APT_UPGRADE_DECISION"
  if [[ "$decision" != "upgrade" && "$decision" != "skip" ]]; then
    echo "APT upgrade prompt timed out; continuing without upgrading packages"
  fi
fi

set_status "Update complete."
trap - EXIT
