# SkyChopper Wind Dashboard

A technical, canvas-driven telemetry UI for a wind turbine power system. The front end renders real-time cards from `data/status.json`, drives status indicators for source/battery health, and animates the turbine based on pack voltage. It also exposes a settings modal that persists thresholds to `data/settings.json` via the local API server.

## Features
- HTML5 canvas rendering loop with layout that adapts to viewport width.
- 1 Hz polling of `data/status.json` with interpolation for smooth transitions.
- Status LEDs with voltage-range tooltips for source/battery health.
- Settings modal with persisted JSON writes (`data/settings.json`) via the local API server.
- Logs modal with a live 2-minute voltage chart and CSV table.
- Light/dark theme swap driven by `prefers-color-scheme`.

## Quick Start
1. Run the backend (telemetry + logging + API):

```powershell
SERIAL_PORT=/dev/ttyUSB0 node scripts/read.js
```

2. Serve the UI with VS Code Live Server (or any static server).

3. If you want auto-restarts on settings changes, use nodemon:

```powershell
npm install
npm run read:watch
```

## Settings
The settings modal edits battery thresholds and writes the JSON to `data/settings.json` using the local API server on port 8000. The API server is enabled by default (set `ENABLE_API_SERVER=0` to disable).

### Settings fields (`data/settings.json`)
- `target_buck_voltage`: Target buck output voltage.
- `source_expected_min_v`: Expected minimum source voltage.
- `source_expected_max_v`: Expected maximum source voltage.
- `batt_full_voltage`: Battery pack full voltage.
- `batt_empty_voltage`: Battery pack empty voltage.
- `batt_on_percent`: Battery percentage to turn system on.
- `batt_off_percent`: Battery percentage to turn system off.
- `sim_fallback_enabled`: Enable/disable simulator fallback when serial is unavailable.

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

Missing values are gracefully ignored; cards only render for keys present in the JSON.

## Runtime Behavior
- Polling: `fetch()` to `data/status.json` every 1000 ms (no cache) with graceful failure handling.
- Rendering: a requestAnimationFrame loop interpolates toward the latest telemetry for smooth UI changes.
- Turbine animation: spin rate derived from normalized battery voltage between `batt_empty_voltage` and `batt_full_voltage`.
- Status indicators: LED state is computed from live voltage vs. expected ranges, with tooltips updated per poll.

## Project Structure
- `index.html`: Main dashboard shell.
- `assets/dark.css`: Dark theme styling.
- `assets/light.css`: Light theme styling.
- `scripts/write.js`: Front-end rendering + settings logic.
- `scripts/read.js`: Telemetry reader + simulator fallback + API server.
- `data/settings.json`: User-configurable thresholds.
- `data/status.json`: Live status payload consumed by the UI.

## Raspberry Pi Setup
Use the provided setup script to configure nginx, the systemd service, and `.local` access:

```bash
chmod +x setup.sh
sudo ./setup.sh
```

See `setup.txt` for full instructions.

## License
See `LICENSE.txt`.
