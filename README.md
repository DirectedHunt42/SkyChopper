<p align="center">
  <img src="assets/wind-turbine.svg" alt="SkyChopper wind turbine" width="72" height="72">
</p>

<h1 align="center">SkyChopper</h1>

<p align="center">A Raspberry Pi wind turbine telemetry dashboard with live power monitoring, Arduino serial input, and system controls.</p>

**Version: 1.4.2**

## Overview

SkyChopper combines a canvas-driven dashboard with a backend service for a
wind turbine power system. The dashboard reads live status from
`data/status.json`, shows source and battery health, animates the turbine from
pack voltage, and provides controls for settings and logs. On a Raspberry Pi,
the backend reads Arduino serial telemetry (or uses a simulator fallback),
computes power decisions, logs CSV data, and serves a lightweight API.

## Features
- HTML5 canvas rendering loop with layout that adapts to viewport width.
- 1 Hz polling of `data/status.json` with interpolation for smooth transitions.
- Status LEDs with voltage-range tooltips for source/battery/buck health.
- Settings modal with persisted JSON writes (`data/settings.json`) via the local API server.
- Logs modal with a live 10-minute voltage chart showing recorded samples without smoothing and a CSV table.
- Files modal with telemetry/network history, recent service/Nginx/update logs, and available runtime/service configuration downloads.
- Repository File Tree panel with tracked files and installed/generated file mappings.
- Serial bridge with auto-reconnect and simulator fallback.
- Power override (BATT/AUTO/SOURCE) switch synced to settings.
- Optional Home Assistant MQTT Discovery for Raspberry Pi temperature, CPU,
  memory, disk, uptime, and load sensors.

## Quick Start (Arduino + Raspberry Pi)
1. Flash the Arduino with the telemetry sketch and connect it to the Pi over USB serial.

   For source-voltage-only monitoring, upload `arduino/source_voltage_only.ino`
   instead. It reads `A1` and sends only `source_voltage` four times per second; the
   original `arduino/arduino.ino` remains the full telemetry and relay sketch.

2. On the Raspberry Pi, install the locked production dependencies from
   `package.json` and `package-lock.json`:

```bash
npm ci --omit=dev
```

3. Run the backend on the Pi (telemetry + logging + API):

```powershell
# Raspberry Pi example
SERIAL_PORT=/dev/ttyUSB0
SERIAL_BAUD=115200
node scripts/read.js
```

4. Serve the UI on the Pi with nginx, Live Server, or any static server.

5. Optional: auto-restart the backend on changes:

```bash
npm ci
npm run read:watch
```

## Hardware Overview
- Arduino: streams JSON telemetry lines over USB serial.
- Raspberry Pi: runs `scripts/read.js`, hosts the API, and serves the UI.

## Serial Data Expectations
The Arduino should emit newline-delimited JSON containing fields like:

```json
{"batt_voltage":12.2,"source_voltage":9.1,"buck_voltage":8.9,"relay_state":"BATT"}
node scripts/read.js
```

## Environment Variables
- `SERIAL_PORT`: Serial device path. Example `COM3` (Windows) or `/dev/ttyUSB0` (Linux).
- `SERIAL_BAUD`: Serial baud rate. Default `115200`.
- `PORT`: API server port. Default `8000`.
- `ENABLE_API_SERVER`: Set to `0` to disable the API server.
- `MQTT_URL`: Optional MQTT broker URL (`mqtt://`, `mqtts://`, `ws://`, or `wss://`). Setting it enables Home Assistant Discovery.
- `MQTT_USERNAME` / `MQTT_PASSWORD`: Optional broker credentials.
- `MQTT_BASE_TOPIC`: MQTT state and availability topic prefix. Default: `skychopper`.
- `MQTT_DISCOVERY_PREFIX`: Home Assistant discovery topic prefix. Default: `homeassistant`.
- `MQTT_PUBLISH_INTERVAL_MS`: Stats publish interval in milliseconds. Default: `30000` (minimum: `1000`).

## Settings
The settings modal edits battery thresholds and writes JSON to `data/settings.json` using the local API server on port `8000` (configurable by `PORT`). The API server is enabled by default.

### Settings fields (`data/settings.json`)
- `source_voltage_only`: Defaults to `true`. Reads and records source voltage only, suppresses power decisions, and disables simulator fallback. Turn it off to use full system telemetry.
- `target_buck_voltage`: Target buck output voltage.
- `source_expected_min_v`: Expected minimum source voltage.
- `source_expected_max_v`: Expected maximum source voltage.
- `batt_full_voltage`: Battery pack full voltage.
- `batt_empty_voltage`: Battery pack empty voltage.
- `batt_on_percent`: Battery percentage to turn system on.
- `batt_off_percent`: Battery percentage to turn system off.
- `sim_fallback_enabled`: Enable/disable simulator fallback when serial is unavailable.
- `power_override`: `"off" | "auto" | "on"` (maps to BATT/AUTO/SOURCE).

## Telemetry Data Contract
The UI reads `data/status.json` and supports the following fields:
- `batt_voltage` (number)
- `source_voltage` (number)
- `buck_voltage` (number)
- `batt_percent` (number)
- `use_source` (boolean)
- `system_on` (boolean)
- `rpm` (number)
- `current` (number)
- `dump_load` (boolean)
- `batt_start_v` (number)
- `batt_stop_v` (number)
- `source_expected_min_v` (number)
- `source_expected_max_v` (number)
- `arduino_connected` (boolean)
- `telemetry_mode` (`"source_only"` or `"full"`)

Missing values are gracefully ignored; cards only render for keys present in the JSON.

## API Endpoints
All endpoints are served from `http://localhost:8000` by default.
- `POST /api/settings`: Persist settings JSON. Body is merged over defaults.
- `POST /api/reset-all`: Delete all data files and recreate defaults.
- `POST /api/clear-logs`: Truncate `data/log.csv` to just the header.
- `GET /api/network`: Read hostname, active IPv4 interfaces, default route, Wi-Fi connection details, and outage history.
- `GET /api/files`: List telemetry and network history, recent dashboard/Nginx/update logs, and available runtime/service configuration files.
- `GET /api/files/:id`: Download one of the listed logs or configuration files. Service and Nginx logs are limited to their latest 1,000 lines.
- `GET /api/repo-files`: List repository files and report installed/generated file mappings.
- `GET /api/update` and `POST /api/update`: Read update progress and start the installed updater.
- `GET /api/system`: Read system temperature, CPU, memory, uptime, load average, and disk usage.

## Home Assistant

### Add SkyChopper as a device

The SkyChopper Home Assistant integration lets you add the Pi from Home
Assistant's integration screen and creates a device with its stats sensors.
It reads the Pi's existing system API directly; MQTT and broker credentials
are not required.

1. Install the integration using either method:
   - **HACS:** In HACS, open **Integrations → ⋮ → Custom repositories**, add
     `https://github.com/DirectedHunt42/SkyChopper` as an **Integration**, and
     install **SkyChopper**. Restart Home Assistant.
   - **Manual:** Copy `custom_components/skychopper` from this repository into
     the Home Assistant configuration directory's `custom_components`
     directory, then restart Home Assistant.
2. In Home Assistant, go to **Settings → Devices & services → Add integration**
   and search for **SkyChopper**.
3. Enter the Pi address, including the API port, for example
   `http://skychopper.local:8000` or `http://192.168.1.50:8000`.
   Home Assistant must be able to reach the Pi on port `8000`.

The integration creates a SkyChopper device with temperature, CPU, memory,
disk, uptime, and load average sensors, updating every 30 seconds. Add the
following [custom:button-card](https://github.com/custom-cards/button-card)
configuration to a dashboard for a compact stats panel. In the card editor,
select your SkyChopper temperature sensor as the entity. The card derives the
other sensor IDs from that entity, so it works with different Home Assistant
entity prefixes as long as the sensor suffixes are unchanged.

```yaml
type: custom:button-card
entity: sensor.skychopper_temperature
name: SKYCHOPPER
icon: mdi:server-network
show_state: true
show_label: true
label: |
  [[[
    const base = entity.entity_id.replace(/^sensor\./, '').replace(/_temperature$/, '');
    const cpu = states[`sensor.${base}_cpu_usage`];
    const memory = states[`sensor.${base}_memory_usage`];
    const available = sensor =>
      sensor && !['unknown', 'unavailable'].includes(sensor.state);

    if (!available(cpu) || !available(memory)) {
      return 'System stats unavailable';
    }

    return `CPU ${cpu.state}% · Memory ${memory.state}%`;
  ]]]
styles:
  card:
    - padding: 12px
  grid:
    - grid-template-areas: '"i n" "i s" "i l" "progress progress" "details details"'
    - grid-template-columns: 45px 1fr
    - grid-template-rows: min-content min-content min-content min-content min-content
  icon:
    - width: 32px
    - color: '#2196F3'
  name:
    - font-size: 15px
    - font-weight: bold
    - justify-self: start
  state:
    - font-size: 16px
    - font-weight: bold
    - justify-self: start
  label:
    - font-size: 10px
    - justify-self: start
  custom_fields:
    progress:
      - grid-area: progress
      - width: 100%
      - padding-top: 12px
    details:
      - grid-area: details
      - width: 100%
      - padding-top: 12px
custom_fields:
  progress: |
    [[[
      const base = entity.entity_id.replace(/^sensor\./, '').replace(/_temperature$/, '');
      const sensor = states[`sensor.${base}_cpu_usage`];
      const raw = sensor?.state;
      const valid = raw !== undefined
        && !['unknown', 'unavailable', ''].includes(raw)
        && Number.isFinite(Number(raw));
      const value = valid ? Math.max(0, Math.min(100, Number(raw))) : 0;
      const color = valid ? '#2196F3' : 'var(--secondary-text-color)';

      return `
        <div style="display:flex; flex-direction:column; gap:6px; width:100%;">
          <div style="display:flex; justify-content:space-between; font-size:12px; font-weight:bold;">
            <span>CPU Usage</span>
            <span style="color:${color};">${valid ? `${value.toFixed(1)}%` : 'Unavailable'}</span>
          </div>
          <div style="width:100%; height:8px; background:var(--secondary-background-color); border-radius:10px; overflow:hidden;">
            <div style="width:${value}%; height:100%; background:${color}; border-radius:10px;"></div>
          </div>
        </div>
      `;
    ]]]
  details: |
    [[[
      const base = entity.entity_id.replace(/^sensor\./, '').replace(/_temperature$/, '');
      const get = name => states[`sensor.${base}_${name}`];

      const read = name => {
        const sensor = get(name);
        if (!sensor || ['unknown', 'unavailable', ''].includes(sensor.state)) return '—';
        const unit = sensor.attributes.unit_of_measurement || '';
        return `${sensor.state}${unit ? ` ${unit}` : ''}`;
      };

      const memoryUsed = () => {
        const sensor = get('memory_used');
        if (!sensor || !Number.isFinite(Number(sensor.state))) return '—';
        let size = Number(sensor.state);
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let index = 0;
        while (size >= 1024 && index < units.length - 1) {
          size /= 1024;
          index++;
        }
        return `${size.toFixed(index ? 1 : 0)} ${units[index]}`;
      };

      const uptime = () => {
        const sensor = get('uptime');
        if (!sensor || !Number.isFinite(Number(sensor.state))) return '—';
        let seconds = Math.max(0, Math.floor(Number(sensor.state)));
        const days = Math.floor(seconds / 86400);
        seconds %= 86400;
        const hours = Math.floor(seconds / 3600);
        seconds %= 3600;
        const minutes = Math.floor(seconds / 60);
        return `${days}d ${hours}h ${minutes}m`;
      };

      const safe = value => String(value).replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;',
        '"': '&quot;', "'": '&#39;'
      })[character]);

      const row = (label, value) => `
        <div style="display:flex; flex-direction:column; gap:3px; min-width:0;">
          <span style="font-size:10px; color:var(--secondary-text-color);">${label}</span>
          <span style="font-size:12px; font-weight:500; overflow-wrap:anywhere;">${safe(value)}</span>
        </div>
      `;

      return `
        <div style="width:100%; border-top:1px solid var(--divider-color); padding-top:12px; display:flex; flex-direction:column; gap:12px;">
          <div style="font-size:12px; font-weight:bold;">SYSTEM DETAILS</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
            ${row('Memory Usage', read('memory_usage'))}
            ${row('Memory Used', memoryUsed())}
            ${row('Disk Usage', read('disk_usage'))}
            ${row('Uptime', uptime())}
            ${row('Load Average (1m)', read('load_average_1m'))}
            ${row('Load Average (5m)', read('load_average_5m'))}
            ${row('Load Average (15m)', read('load_average_15m'))}
          </div>
        </div>
      `;
    ]]]
```

### Optional MQTT Discovery

As an alternative, SkyChopper can publish stats through MQTT Discovery. This
requires an MQTT broker configured in Home Assistant (for example, the
Mosquitto broker add-on). On the Pi, edit `/etc/skychopper/mqtt.env` and set:

```ini
MQTT_URL=mqtt://homeassistant.local:1883
MQTT_USERNAME=your_mqtt_username
MQTT_PASSWORD=your_mqtt_password
```

Use the broker's reachable host name or IP address; use `mqtts://` when the
broker requires TLS. Keep this file private with
`sudo chmod 600 /etc/skychopper/mqtt.env`, then restart the service:

```bash
sudo systemctl restart skychopper
```

The setup script installs an optional systemd environment file at that path and
does not overwrite it on later runs. Once connected, SkyChopper publishes
retained Home Assistant discovery and stats messages every 30 seconds. The
device appears under **Settings → Devices & services → MQTT**. Its entities
include temperature, CPU usage, memory usage and used memory, disk usage,
uptime, and 1/5/15-minute load averages. MQTT availability marks the device
offline when the Pi loses its broker connection. If `MQTT_URL` is unset, MQTT
publishing stays disabled and the existing dashboard/API behavior is unchanged.

## Update from the dashboard
On a Raspberry Pi installed from a Git checkout, choose **Update** in the
dashboard and confirm. The updater resets tracked local changes, pulls the
latest commit, and reruns `setup.sh` so the installed services match the
updated repository. Nginx and the SkyChopper telemetry service are restarted
during setup, and the dashboard reloads automatically when the update finishes;
a reboot is not required to apply an update. Untracked files are preserved.
The progress window shows the updater status and output. After refreshing the
APT package lists, the updater asks before installing any available system
package upgrades; declining or not answering within five minutes skips them.

## Runtime Behavior
- Polling: `fetch()` to `data/status.json` every 1000 ms (no cache) with graceful failure handling.
- Rendering: a requestAnimationFrame loop interpolates toward the latest telemetry for smooth UI changes.
- Turbine animation: spin rate derived from normalized battery voltage between `batt_empty_voltage` and `batt_full_voltage`.
- Status indicators: LED state is computed from live voltage vs. expected ranges, with tooltips updated per poll.
- Sampling and logging: the Arduino sends telemetry every 250 ms, and voltage CSV rows are written up to every 250 ms (trimmed to 1,000,000 lines). Network transitions are monitored every 10 seconds and recorded in `data/network.csv`, also trimmed to 1,000,000 entries.

## Project Structure
- `index.html`: Main dashboard shell and modal markup.
- `arduino/arduino.ino`: Full telemetry and relay firmware (kept unchanged).
- `arduino/source_voltage_only.ino`: Source voltage monitor firmware.
- `assets/rtk-dashboard.css`: Dashboard styling and color theme.
- `assets/favicon.svg`: Dashboard favicon.
- `scripts/write.js`: Front-end rendering, settings, and UI logic.
- `scripts/read.js`: Telemetry reader, simulator fallback, API server.
- `custom_components/skychopper/`: Home Assistant integration for adding the
  Pi as a device from the Integrations screen.
- `hacs.json`: HACS metadata for installing the custom integration.
- Network status uses the Linux `iw` utility for Wi-Fi signal and link details. The backend checks for active non-internal IPv4 interfaces every 10 seconds and records detected disconnect/reconnect times and outage durations.
- `data/settings.json`: User-configurable thresholds.
- `data/status.json`: Live status payload consumed by the UI.
- `data/log.csv`: Rolling telemetry log.
- `data/network.csv`: Rolling network disconnect/reconnect log with outage durations.

## Function Reference

### Backend (`scripts/read.js`)
- `ensureDataFolder()`: Creates the `data` directory if missing.
- `countLogLines()`: Counts existing CSV data lines to enforce the max log size.
- `trimLogIfNeeded()`: Trims the CSV log to the most recent `LOG_MAX_LINES`.
- `maybeLog(telemetry)`: Appends a CSV line at the configured interval.
- `recordNetworkState(stats)`: Records changes in active IPv4 connectivity and computes outage statistics.
- `trimNetworkLogIfNeeded()`: Trims network transition history to the most recent `NETWORK_LOG_MAX_LINES`.
- `loadSettings()`: Loads settings from disk with defaults fallback.
- `computeDecision(telemetry, prev)`: Applies battery and source logic to decide `system_on` and `use_source`.
- `writeStatus(telemetry, decision)`: Writes `data/status.json` with computed fields.
- `resetAllData()`: Recreates `data/` with default settings/status/log header.
- `clearLogs()`: Resets `data/log.csv` to just its header.
- `attemptSerialConnection()`: Opens the serial port, parses JSON lines, and dispatches mode commands.
- `clamp(x, a, b)`: Numeric clamp utility used by the simulator.
- `generateData()`: Produces simulated telemetry values and writes status + logs.
- `startSimulator()`: Starts the 1 Hz simulator loop.
- `stopSimulator()`: Stops the simulator loop.
- `syncSimulatorFallback()`: Enables simulator based on settings and serial availability.

### Frontend (`scripts/write.js`)
- `applyStatusLevel(dotEl, level)`: Updates LED classnames and parent classes.
- `normalizeStatus(raw)`: Coerces/validates raw JSON into a safe status object.
- `stepStatus(dt)`: Interpolates `status` toward `targetStatus` over time.
- `roundRect(x, y, w, h, r)`: Draws rounded rectangles on the canvas.
- `resizeCanvas()`: Resizes the main canvas for device pixel ratio.
- `resizeLogChart()`: Resizes the log chart canvas for device pixel ratio.
- `applySettings(next)`: Merges and validates settings and precomputes thresholds.
- `getPackVoltageRange()`: Returns full/empty pack values from settings.
- `fillSettingsForm()`: Populates the settings modal inputs.
- `updateOverrideSwitch()`: Syncs the override switch UI to settings.
- `parseNum(value, fallback)`: Parses floats with a fallback value.
- `writeSettingsToFile()`: Sends settings to `POST /api/settings`.
- `loadSettings()`: Loads `data/settings.json` and updates UI state.
- `openSettingsModal()`: Opens the settings modal.
- `closeSettingsModal()`: Closes the settings modal.
- `openLogsModal()`: Opens the logs modal.
- `closeLogsModal()`: Closes the logs modal and stops auto-refresh.
- `renderLogTable(rows)`: Renders CSV rows into the logs table.
- `renderLogChart(rows)`: Draws the voltage chart from CSV rows.
- `loadLogTable()`: Fetches `data/log.csv` and refreshes table/chart.
- `updateData()`: Fetches `data/status.json` and updates LEDs/tooltips.
- `draw()`: Renders the live canvas cards and positions the turbine.
- `renderLoop()`: Runs the animation loop and keeps the chart updated.
- `openConfirm()`: Opens the reset-settings confirmation modal.
- `closeConfirm()`: Closes the reset-settings confirmation modal.
- `openConfirmClearLogs()`: Opens the clear-logs confirmation modal.
- `closeConfirmClearLogs()`: Closes the clear-logs confirmation modal.
- `openConfirmResetAll()`: Opens the reset-all confirmation modal.
- `closeConfirmResetAll()`: Closes the reset-all confirmation modal.
- `openConfirmSim()`: Opens the simulator warning modal.
- `closeConfirmSim()`: Closes the simulator warning modal.
- `postAction(path)`: Helper for POSTing to API endpoints.
- `startPolling()`: Starts the 1 Hz status poll loop.

Notes on inline helpers:
- `movePill(mode)`: Local helper used inside the override switch handler to animate the slider pill.

## Raspberry Pi Setup
Use the provided setup script to configure nginx, the systemd service, and `.local` access:

```bash
chmod +x setup.sh
sudo ./setup.sh
```

See `setup.txt` for full instructions.
