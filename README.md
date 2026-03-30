# SkyChopper Wind Dashboard

A technical, canvas-driven telemetry UI for a wind turbine power system. The front end renders real-time cards from `data/status.json`, drives status indicators for source/battery health, animates the turbine based on pack voltage, and exposes modals to manage settings and logs. The backend runs on a Raspberry Pi, reads serial telemetry from an Arduino (or a simulator fallback), computes power decisions, logs CSV data, and serves a lightweight API for settings and maintenance actions.

## Features
- HTML5 canvas rendering loop with layout that adapts to viewport width.
- 1 Hz polling of `data/status.json` with interpolation for smooth transitions.
- Status LEDs with voltage-range tooltips for source/battery/buck health.
- Settings modal with persisted JSON writes (`data/settings.json`) via the local API server.
- Logs modal with a live 2-minute voltage chart and CSV table.
- Serial bridge with auto-reconnect and simulator fallback.
- Power override (BATT/AUTO/SOURCE) switch synced to settings.

## Quick Start (Arduino + Raspberry Pi)
1. Flash the Arduino with the telemetry sketch and connect it to the Pi over USB serial.

2. On the Raspberry Pi, install dependencies:

```powershell
npm install
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

```powershell
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

## Settings
The settings modal edits battery thresholds and writes JSON to `data/settings.json` using the local API server on port `8000` (configurable by `PORT`). The API server is enabled by default.

### Settings fields (`data/settings.json`)
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

Missing values are gracefully ignored; cards only render for keys present in the JSON.

## API Endpoints
All endpoints are served from `http://localhost:8000` by default.
- `POST /api/settings`: Persist settings JSON. Body is merged over defaults.
- `POST /api/reset-all`: Delete all data files and recreate defaults.
- `POST /api/clear-logs`: Truncate `data/log.csv` to just the header.

## Runtime Behavior
- Polling: `fetch()` to `data/status.json` every 1000 ms (no cache) with graceful failure handling.
- Rendering: a requestAnimationFrame loop interpolates toward the latest telemetry for smooth UI changes.
- Turbine animation: spin rate derived from normalized battery voltage between `batt_empty_voltage` and `batt_full_voltage`.
- Status indicators: LED state is computed from live voltage vs. expected ranges, with tooltips updated per poll.
- Logging: CSV rows written every 5 seconds (trimmed to 1,000,000 lines).

## Project Structure
- `index.html`: Main dashboard shell and modal markup.
- `assets/dark.css`: Dark theme styling.
- `assets/light.css`: Light theme styling.
- `scripts/write.js`: Front-end rendering, settings, and UI logic.
- `scripts/read.js`: Telemetry reader, simulator fallback, API server.
- `data/settings.json`: User-configurable thresholds.
- `data/status.json`: Live status payload consumed by the UI.
- `data/log.csv`: Rolling telemetry log.

## Function Reference

### Backend (`scripts/read.js`)
- `ensureDataFolder()`: Creates the `data` directory if missing.
- `countLogLines()`: Counts existing CSV data lines to enforce the max log size.
- `trimLogIfNeeded()`: Trims the CSV log to the most recent `LOG_MAX_LINES`.
- `maybeLog(telemetry)`: Appends a CSV line at the configured interval.
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
