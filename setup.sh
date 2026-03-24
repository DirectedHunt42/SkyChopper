#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SERVICE_NAME="skychopper"
NODE_SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
NGINX_SITE="/etc/nginx/sites-available/${SERVICE_NAME}"
NGINX_SITE_LINK="/etc/nginx/sites-enabled/${SERVICE_NAME}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run with sudo: sudo ./setup.sh"
  exit 1
fi

echo "== SkyChopper setup =="
echo "Repo: ${ROOT_DIR}"

echo "Installing packages..."
apt-get update -y
apt-get install -y nginx avahi-daemon

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Installing Node.js LTS..."
  curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
  apt-get install -y nodejs
fi

echo "Configuring nginx..."
cat > "${NGINX_SITE}" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root ${ROOT_DIR};
    index index.html;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF

if [[ -L "${NGINX_SITE_LINK}" || -e "${NGINX_SITE_LINK}" ]]; then
  rm -f "${NGINX_SITE_LINK}"
fi
ln -s "${NGINX_SITE}" "${NGINX_SITE_LINK}"
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl restart nginx
systemctl enable nginx

echo "Setting hostname to skychopper..."
if command -v hostnamectl >/dev/null 2>&1; then
  hostnamectl set-hostname skychopper
else
  echo "skychopper" > /etc/hostname
  sed -i "s/127.0.1.1.*/127.0.1.1\tskychopper/g" /etc/hosts || true
fi

echo "Configuring systemd service..."
cat > "${NODE_SERVICE_FILE}" <<EOF
[Unit]
Description=SkyChopper telemetry reader
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
ExecStart=/usr/bin/node ${ROOT_DIR}/scripts/read.js
Restart=always
RestartSec=2
Environment=ENABLE_API_SERVER=1

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}"
systemctl restart "${SERVICE_NAME}"

echo "Ensuring avahi is running for .local access..."
systemctl enable avahi-daemon
systemctl restart avahi-daemon

echo "Setup complete."
echo "Access the dashboard at: http://<pi-ip>/ or http://skychopper.local/"
