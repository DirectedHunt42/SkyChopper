const fs = require("fs");
const path = require("path");
const http = require("http");

const statusFile = path.join(__dirname, "../data/status.json");
const settingsFile = path.join(__dirname, "../data/settings.json");
const logFile = path.join(__dirname, "../data/log.csv");
const dataFolder = path.join(__dirname, "../data");
const LOG_HEADER = "time_iso,batt_voltage,source_voltage,buck_voltage,relay_mode";
const SERIAL_MONITOR_MAX_ENTRIES = 500;

// Default settings if missing
const defaultSettings = {
    target_buck_voltage: 9,
    source_expected_min_v: 8.5,
    source_expected_max_v: 9.5,
    batt_full_voltage: 12.6,
    batt_empty_voltage: 9.0,
    batt_on_percent: 80,
    batt_off_percent: 60,
    sim_fallback_enabled: false,
    power_override: "auto",
    title: 1
};

// Default status if missing
const defaultStatus = {
    batt_voltage: 12.0,
    source_voltage: 14.0,
    buck_voltage: 9.0,
    batt_percent: 85,
    use_source: false,
    system_on: false,
    time: Date.now()
};

function ensureDataFolder() {
    if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder, { recursive: true });
}

// Ensure data folder exists
ensureDataFolder();

// Create settings.json if missing
if (!fs.existsSync(settingsFile)) {
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, null, 2));
    console.log("Created default settings.json");
}

// Create status.json if missing
if (!fs.existsSync(statusFile)) {
    fs.writeFileSync(statusFile, JSON.stringify(defaultStatus, null, 2));
    console.log("Created default status.json");
}

// Create log.csv if missing
if (!fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, `${LOG_HEADER}\n`);
    console.log("Created log.csv");
}

ensureLogHeader();

// ===== CONFIG =====
const SERIAL_PORT = process.env.SERIAL_PORT || "";
const SERIAL_BAUD = Number.parseInt(process.env.SERIAL_BAUD || "115200", 10);
const HTTP_PORT = Number.parseInt(process.env.PORT || "8000", 10);
const ENABLE_API_SERVER = process.env.ENABLE_API_SERVER !== "0";

const LOG_INTERVAL_MS = 5000;
const LOG_MAX_LINES = 1000000;
let lastLogAt = 0;
let logLineCount = 0;
let pendingSettingsSync = null;
let serialMonitorSequence = 0;
const serialMonitorEntries = [];

// ===== SERIAL STATE =====
let serialPortInstance = null;
let lastDecision = {
    system_on: defaultStatus.system_on,
    use_source: defaultStatus.use_source,
    batt_voltage: defaultStatus.batt_voltage,
    source_voltage: defaultStatus.source_voltage
};

// ===== SIMULATOR STATE =====
let systemOn = defaultStatus.system_on;
let useSource = defaultStatus.use_source;
let battV = defaultStatus.batt_voltage;
let sourceV = defaultStatus.source_voltage;
let buckV = defaultStatus.buck_voltage;
let sourcePresent = true;
let simulatorTimer = null;

// ===== UTILS =====
function normalizeRelayMode(value, fallbackUseSource = null) {
    if (typeof value === "string") {
        const upper = value.trim().toUpperCase();
        if (upper === "BATT" || upper === "1" || upper === "CLOSED" || upper === "BATT_CLOSED") {
            return "BATT (closed)";
        }
        if (upper === "SOURCE" || upper === "0" || upper === "OPEN" || upper === "SOURCE_OPEN") {
            return "SOURCE (open)";
        }
    }

    if (typeof value === "number") {
        if (value === 1) return "BATT (closed)";
        if (value === 0) return "SOURCE (open)";
    }

    if (typeof value === "boolean") {
        return value ? "BATT (closed)" : "SOURCE (open)";
    }

    if (typeof fallbackUseSource === "boolean") {
        return fallbackUseSource ? "SOURCE (open)" : "BATT (closed)";
    }

    return "";
}

function recordSerialMonitor(direction, message) {
    const text = String(message ?? "").trim();
    if (!text) return;
    serialMonitorSequence += 1;
    serialMonitorEntries.push({
        id: serialMonitorSequence,
        time_iso: new Date().toISOString(),
        direction,
        message: text
    });
    if (serialMonitorEntries.length > SERIAL_MONITOR_MAX_ENTRIES) {
        serialMonitorEntries.splice(0, serialMonitorEntries.length - SERIAL_MONITOR_MAX_ENTRIES);
    }
}

function ensureLogHeader() {
    ensureDataFolder();

    if (!fs.existsSync(logFile)) {
        fs.writeFileSync(logFile, `${LOG_HEADER}\n`);
        console.log("Created log.csv");
        return;
    }

    const text = fs.readFileSync(logFile, "utf8");
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const header = (lines[0] || "").trim();
    const legacyHeader = "time_iso,batt_voltage,source_voltage,buck_voltage";

    if (header === LOG_HEADER) return;

    if (header === legacyHeader) {
        const upgradedLines = lines
            .filter((line, index) => index === 0 || line.length > 0)
            .map((line, index) => {
                if (index === 0) return LOG_HEADER;
                return `${line},`;
            });
        fs.writeFileSync(logFile, `${upgradedLines.join("\n")}\n`);
        console.log("Upgraded log.csv to include relay_mode column");
        return;
    }

    if (!header) {
        fs.writeFileSync(logFile, `${LOG_HEADER}\n`);
    }
}

function countLogLines() {
    try {
        const text = fs.readFileSync(logFile, "utf8");
        const lines = text.split(/\r?\n/).filter(Boolean);
        logLineCount = Math.max(0, lines.length - 1);
    } catch {
        logLineCount = 0;
    }
}

function readFileSegment(fd, start, length) {
    if (!Number.isFinite(length) || length <= 0) return "";
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, start);
    return buffer.toString("utf8", 0, bytesRead);
}

function readLastLogRows(limit = 120) {
    ensureDataFolder();
    ensureLogHeader();

    if (!fs.existsSync(logFile)) {
        return {
            header: LOG_HEADER.split(","),
            rows: [],
            total_lines: 0
        };
    }

    const stat = fs.statSync(logFile);
    if (stat.size <= 0) {
        return {
            header: LOG_HEADER.split(","),
            rows: [],
            total_lines: logLineCount
        };
    }

    const chunkSize = 64 * 1024;
    let position = stat.size;
    let remaining = "";
    const rows = [];
    let header = LOG_HEADER.split(",");
    const fd = fs.openSync(logFile, "r");

    try {
        const headerText = readFileSegment(fd, 0, Math.min(4096, stat.size));
        header = (headerText.split(/\r?\n/)[0] || LOG_HEADER).split(",");

        while (position > 0 && rows.length <= limit) {
            const readSize = Math.min(chunkSize, position);
            position -= readSize;
            const chunk = readFileSegment(fd, position, readSize);
            const text = chunk + remaining;
            const parts = text.split(/\r?\n/);
            remaining = parts.shift() || "";
            rows.unshift(...parts.filter(Boolean));
            if (rows.length > limit) {
                rows.splice(0, rows.length - limit);
            }
        }
    } finally {
        fs.closeSync(fd);
    }

    if (remaining && rows.length < limit && remaining !== header.join(",")) {
        rows.unshift(remaining);
    }

    return {
        header,
        rows: rows.slice(-limit).map((line) => line.split(',')),
        total_lines: logLineCount
    };
}

function trimLogIfNeeded() {
    if (logLineCount <= LOG_MAX_LINES) return;
    const text = fs.readFileSync(logFile, "utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);
    const header = lines[0] || LOG_HEADER;
    const dataLines = lines.slice(1);
    const keep = dataLines.slice(-LOG_MAX_LINES);
    const next = [header, ...keep].join("\n") + "\n";
    fs.writeFileSync(logFile, next);
    logLineCount = keep.length;
}

function maybeLog(telemetry) {
    const now = Date.now();
    if (now - lastLogAt < LOG_INTERVAL_MS) return;
    lastLogAt = now;
    ensureDataFolder();
    ensureLogHeader();
    const line = [
        new Date(now).toISOString(),
        Number.isFinite(telemetry.batt_voltage) ? telemetry.batt_voltage.toFixed(3) : "",
        Number.isFinite(telemetry.source_voltage) ? telemetry.source_voltage.toFixed(3) : "",
        Number.isFinite(telemetry.buck_voltage) ? telemetry.buck_voltage.toFixed(3) : "",
        normalizeRelayMode(telemetry.relay_state, telemetry.use_source)
    ].join(",") + "\n";
    fs.appendFileSync(logFile, line);
    logLineCount += 1;
    trimLogIfNeeded();
}

countLogLines();

function loadSettings() {
    try {
        const loaded = JSON.parse(fs.readFileSync(settingsFile));
        const merged = { ...defaultSettings, ...loaded };
        if (JSON.stringify(loaded) !== JSON.stringify(merged)) {
            fs.writeFileSync(settingsFile, JSON.stringify(merged, null, 2));
        }
        return merged;
    } catch {
        return { ...defaultSettings };
    }
}

// ===== DECISION LOGIC (exact spec you requested) =====
function computeDecision(telemetry, prev) {
    const settings = loadSettings();
    const fullV = settings.batt_full_voltage ?? defaultSettings.batt_full_voltage;
    const emptyV = settings.batt_empty_voltage ?? defaultSettings.batt_empty_voltage;
    const onPercent = settings.batt_on_percent ?? defaultSettings.batt_on_percent;
    const offPercent = settings.batt_off_percent ?? defaultSettings.batt_off_percent;
    const sourceMin = settings.source_expected_min_v ?? defaultSettings.source_expected_min_v;
    const sourceMax = settings.source_expected_max_v ?? defaultSettings.source_expected_max_v;

    const battV = Number.isFinite(telemetry.batt_voltage) ? telemetry.batt_voltage : prev.batt_voltage;
    const sourceV = Number.isFinite(telemetry.source_voltage) ? telemetry.source_voltage : prev.source_voltage;
    const buckV = Number.isFinite(telemetry.buck_voltage) ? telemetry.buck_voltage : NaN;
    const battPercent = ((battV - emptyV) / (fullV - emptyV)) * 100;
    const clampedPercent = Math.max(0, Math.min(100, battPercent));

    let systemOn = prev.system_on;
    if (!systemOn && clampedPercent >= onPercent) systemOn = true;
    if (systemOn && clampedPercent <= offPercent) systemOn = false;

    const override = settings.power_override || "auto";
    let useSource;
    if (override === "off") {
        useSource = false;
    } else if (override === "on") {
        useSource = true;
    } else {
        // AUTO mode – exact logic
        if (Number.isFinite(buckV) && (buckV < 8.5 || buckV > 9.5)) {
            useSource = true;                                      // Buck out of safe range → force source
        } else if (clampedPercent <= 10) {
            useSource = true;                                      // Batt at 10% or below → always source
        } else if (clampedPercent >= onPercent) {
            useSource = false;                                     // Batt in range / above → use batt
        } else if (clampedPercent > offPercent) {
            useSource = false;                                     // Hysteresis band → still treat as good, use batt
        } else {
            // Batt below range (≤ offPercent and >10%)
            const sourceIsGood = (sourceV > 0.1 &&
                                  sourceV >= sourceMin &&
                                  sourceV <= sourceMax);
            useSource = sourceIsGood;                              // use source only if source in range, else batt
        }
    }

    return {
        settings,
        battStartV: emptyV + (fullV - emptyV) * (onPercent / 100),
        battStopV: emptyV + (fullV - emptyV) * (offPercent / 100),
        battPercent: clampedPercent,
        systemOn,
        useSource,
        sourceMin,
        sourceMax,
        arduinoConnected: true
    };
}

function writeStatus(telemetry, decision) {
    ensureDataFolder();
    const payload = {
        ...telemetry,
        batt_percent: decision.battPercent,
        use_source: decision.useSource,
        system_on: decision.systemOn,
        batt_start_v: decision.battStartV,
        batt_stop_v: decision.battStopV,
        source_expected_min_v: decision.sourceMin,
        source_expected_max_v: decision.sourceMax,
        arduino_connected: decision.arduinoConnected,
        time: Date.now()
    };
    fs.writeFileSync(statusFile, JSON.stringify(payload, null, 2));
}

// ===== RESET / CLEAR FUNCTIONS =====
function resetAllData() {
    if (fs.existsSync(dataFolder)) {
        fs.rmSync(dataFolder, { recursive: true, force: true });
    }
    ensureDataFolder();
    fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, null, 2));
    fs.writeFileSync(statusFile, JSON.stringify(defaultStatus, null, 2));
    fs.writeFileSync(logFile, `${LOG_HEADER}\n`);
    logLineCount = 0;
    lastLogAt = 0;
}

function clearLogs() {
    ensureDataFolder();
    fs.writeFileSync(logFile, `${LOG_HEADER}\n`);
    logLineCount = 0;
}

// ===== SERIAL BRIDGE WITH AUTO-RECONNECT =====
function attemptSerialConnection() {
    if (serialPortInstance || !SERIAL_PORT) return false;

    let SerialPort, ReadlineParser;
    try {
        ({ SerialPort, ReadlineParser } = require("serialport"));
    } catch (err) {
        console.log("serialport not installed; falling back to simulator only.");
        return false;
    }

    try {
        const port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD });
        const parser = port.pipe(new ReadlineParser({ delimiter: "\n" }));

        port.on("open", () => {
            console.log(`✅ Serial bridge connected on ${SERIAL_PORT} @ ${SERIAL_BAUD}`);
            serialPortInstance = port;
            stopSimulator();                 // serial always wins
        });

        parser.on("data", (line) => {
            const text = String(line).trim();
            if (!text) return;

            console.log(`📡 Raw serial data: ${text}`);
            recordSerialMonitor("arduino_to_pi", text);

            try {
                const data = JSON.parse(text);
                console.log(`✅ Parsed Arduino data → batt=${data.batt_voltage?.toFixed(2)}V source=${data.source_voltage?.toFixed(2)}V buck=${data.buck_voltage?.toFixed(2)}V relay=${data.relay_state}`);

                const decision = computeDecision(data, lastDecision);
                decision.arduinoConnected = true;
                writeStatus(data, decision);
                maybeLog(data);

                // Send mode command only if decision changed
                if (decision.useSource !== lastDecision.use_source) {
                    const cmd = decision.useSource ? "MODE SOURCE\n" : "MODE BATT\n";
                    recordSerialMonitor("pi_to_arduino", cmd);
                    port.write(cmd, (err) => { if (err) console.log("Serial write error:", err.message); });
                }

                lastDecision = {
                    system_on: decision.systemOn,
                    use_source: decision.useSource,
                    batt_voltage: data.batt_voltage,
                    source_voltage: data.source_voltage
                };
            } catch (e) {
                console.log(`❌ JSON parse error: ${e.message}\nRaw line was: ${text}`);
            }
        });

        port.on("close", () => {
            console.log("⚠️ Serial port closed – will retry in 2 s");
            serialPortInstance = null;
            setTimeout(attemptSerialConnection, 2000);
            syncSimulatorFallback();
        });

        port.on("error", (err) => {
            console.log(`⚠️ Serial error: ${err.message} – retrying in 2 s`);
            if (serialPortInstance === port) serialPortInstance = null;
            setTimeout(attemptSerialConnection, 2000);
            syncSimulatorFallback();
        });

        return true;
    } catch (err) {
        console.log("Failed to open serial port:", err.message);
        return false;
    }
}

// ===== SIMULATOR FALLBACK =====
function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
}

function generateData() {
    const settings = loadSettings();

    const fullV = settings.batt_full_voltage ?? defaultSettings.batt_full_voltage;
    const emptyV = settings.batt_empty_voltage ?? defaultSettings.batt_empty_voltage;
    const onPercent = settings.batt_on_percent ?? defaultSettings.batt_on_percent;
    const offPercent = settings.batt_off_percent ?? defaultSettings.batt_off_percent;
    const targetBuck = settings.target_buck_voltage;
    const sourceMin = settings.source_expected_min_v ?? defaultSettings.source_expected_min_v;
    const sourceMax = settings.source_expected_max_v ?? defaultSettings.source_expected_max_v;
    const sourceTarget = (sourceMin + sourceMax) / 2;
    const battStartV = emptyV + (fullV - emptyV) * (onPercent / 100);
    const battStopV = emptyV + (fullV - emptyV) * (offPercent / 100);

    if (Math.random() < 0.02) sourcePresent = !sourcePresent;

    if (!sourcePresent) {
        sourceV = 0;
    } else {
        const drift = (Math.random() - 0.5) * 0.08;
        sourceV = clamp(sourceV + drift, sourceMin - 0.3, sourceMax + 0.3);
        if (Math.random() < 0.05) {
            sourceV = clamp(sourceV + (Math.random() - 0.5) * 1.2, sourceMin - 0.8, sourceMax + 0.8);
        }
        sourceV = sourceV + (sourceTarget - sourceV) * 0.1;
    }

    const dischargeRate = systemOn && !useSource ? -0.015 : -0.003;
    const chargeRate = useSource ? 0.01 : 0.0;
    battV = clamp(battV + dischargeRate + chargeRate + (Math.random() - 0.5) * 0.01, emptyV, fullV);

    let percent = ((battV - emptyV) / (fullV - emptyV)) * 100;
    percent = clamp(percent, 0, 100);

    if (!systemOn && percent >= onPercent) systemOn = true;
    if (systemOn && percent <= offPercent) systemOn = false;

    // Same AUTO logic as computeDecision
    const override = settings.power_override || "auto";
    if (override === "off") {
        useSource = false;
    } else if (override === "on") {
        useSource = true;
    } else {
        if (Number.isFinite(buckV) && (buckV < 8.5 || buckV > 9.5)) {
            useSource = true;
        } else if (percent <= 10) {
            useSource = true;
        } else if (percent >= onPercent) {
            useSource = false;
        } else if (percent > offPercent) {
            useSource = false;
        } else {
            const sourceIsGood = (sourceV > 0.1 && sourceV >= sourceMin && sourceV <= sourceMax);
            useSource = sourceIsGood;
        }
    }

    const buckNoise = (Math.random() - 0.5) * 0.08;
    buckV = clamp(buckV + (targetBuck - buckV) * 0.2 + buckNoise, targetBuck - 0.4, targetBuck + 0.4);

    const data = {
        batt_voltage: battV,
        source_voltage: sourceV,
        buck_voltage: buckV,
        batt_percent: percent,
        use_source: useSource,
        system_on: systemOn,
        batt_start_v: battStartV,
        batt_stop_v: battStopV,
        source_expected_min_v: sourceMin,
        source_expected_max_v: sourceMax,
        time: Date.now()
    };

    const decision = {
        battPercent: percent,
        useSource: useSource,
        systemOn: systemOn,
        battStartV: battStartV,
        battStopV: battStopV,
        sourceMin: sourceMin,
        sourceMax: sourceMax,
        arduinoConnected: false
    };

    writeStatus(data, decision);
    maybeLog(data);
}

function startSimulator() {
    if (simulatorTimer) return;
    simulatorTimer = setInterval(generateData, 1000);
    console.log("System simulator running (fallback)");
}

function stopSimulator() {
    if (!simulatorTimer) return;
    clearInterval(simulatorTimer);
    simulatorTimer = null;
    console.log("Simulator stopped");
}

function syncSimulatorFallback() {
    if (serialPortInstance) {
        stopSimulator();
        return;
    }
    const settings = loadSettings();
    const simEnabled = typeof settings.sim_fallback_enabled === "boolean"
        ? settings.sim_fallback_enabled
        : defaultSettings.sim_fallback_enabled;
    if (simEnabled) startSimulator();
    else stopSimulator();
}

// ===== START EVERYTHING =====
console.log("🚀 SkyChopper reader starting...");

// Try serial immediately
attemptSerialConnection();

// Keep retrying every 5 seconds if Arduino is plugged in later
setInterval(() => {
    if (!serialPortInstance && SERIAL_PORT) {
        attemptSerialConnection();
    }
}, 5000);

// Initial simulator check
syncSimulatorFallback();

// Watch settings.json for sim_fallback_enabled changes
fs.watch(settingsFile, { persistent: true }, () => {
    if (pendingSettingsSync) clearTimeout(pendingSettingsSync);
    pendingSettingsSync = setTimeout(() => {
        pendingSettingsSync = null;
        syncSimulatorFallback();
    }, 150);
});

// ===== API SERVER =====
if (ENABLE_API_SERVER) {
    const server = http.createServer((req, res) => {
        const requestUrl = new URL(req.url || "/", `http://localhost:${HTTP_PORT}`);
        const pathname = requestUrl.pathname || "/";
        const origin = req.headers.origin || "*";
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (pathname === "/api/settings" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                try {
                    const payload = JSON.parse(body || "{}");
                    const nextSettings = { ...defaultSettings, ...payload };
                    ensureDataFolder();
                    fs.writeFileSync(settingsFile, JSON.stringify(nextSettings, null, 2));
                    res.writeHead(200, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                }
            });
            return;
        }

        if (pathname === "/api/reset-all" && req.method === "POST") {
            resetAllData();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (pathname === "/api/clear-logs" && req.method === "POST") {
            clearLogs();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            return;
        }

        if (pathname === "/api/logs" && req.method === "GET") {
            const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "120", 10);
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(500, limit) : 120;
            const payload = readLastLogRows(safeLimit);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...payload }));
            return;
        }

        if (pathname === "/api/serial-monitor" && req.method === "GET") {
            const since = Number.parseInt(requestUrl.searchParams.get("since") || "0", 10);
            const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "0", 10);
            const safeSince = Number.isFinite(since) ? since : 0;
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(500, limit) : 0;

            let entries;
            if (safeLimit > 0) {
                // Return the last 'limit' entries
                entries = serialMonitorEntries.slice(-safeLimit);
            } else {
                // Original behavior: entries since 'since'
                entries = serialMonitorEntries.filter((entry) => entry.id > safeSince);
            }

            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({
                ok: true,
                entries,
                latest_id: serialMonitorEntries.length ? serialMonitorEntries[serialMonitorEntries.length - 1].id : 0
            }));
            return;
        }

        res.writeHead(404);
        res.end("Not found");
    });

    server.on("error", (err) => {
        if (err && err.code === "EADDRINUSE") {
            console.log(`API server not started: port ${HTTP_PORT} is already in use. Reader will continue without binding a second server.`);
            return;
        }
        throw err;
    });

    server.listen(HTTP_PORT, () => {
        if (server.listening) {
            console.log(`API server running at http://localhost:${HTTP_PORT}`);
        }
    });
}

console.log("✅ Full updated read.js is now running - status.json should update every second.");
