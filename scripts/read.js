const fs = require("fs");
const path = require("path");
const http = require("http");
const os = require("os");
const { execFile } = require("child_process");

const READER_LOG_MAX_ENTRIES = 300;
const readerLogEntries = [];
for (const level of ["log", "warn", "error"]) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
        const message = args.map((value) => typeof value === "string" ? value : String(value instanceof Error ? value.stack || value.message : JSON.stringify(value))).join(" ");
        readerLogEntries.push({ time_iso: new Date().toISOString(), message: level === "log" ? message : `[${level.toUpperCase()}] ${message}` });
        if (readerLogEntries.length > READER_LOG_MAX_ENTRIES) readerLogEntries.shift();
        original(...args);
    };
}

const statusFile = path.join(__dirname, "../data/status.json");
const settingsFile = path.join(__dirname, "../data/settings.json");
const logFile = path.join(__dirname, "../data/log.csv");
const networkLogFile = path.join(__dirname, "../data/network.csv");
const dataFolder = path.join(__dirname, "../data");
const repoRoot = path.resolve(__dirname, "..");
const LOG_HEADER = "time_iso,batt_voltage,source_voltage,buck_voltage,relay_mode";
const NETWORK_LOG_HEADER = "time_iso,event,duration_seconds";
const SERIAL_MONITOR_MAX_ENTRIES = 500;
const DOWNLOADABLE_DATA_EXTENSIONS = new Set([".csv", ".log", ".json", ".conf", ".ini", ".yaml", ".yml", ".toml"]);
const REPO_ASSOCIATIONS = [
    { source: "index.html", target: path.join(repoRoot, "index.html") },
    { source: "assets/", target: path.join(repoRoot, "assets") },
    { source: "scripts/", target: path.join(repoRoot, "scripts") },
    { source: "scripts/update.sh", target: "/usr/local/sbin/skychopper-update" },
    { source: "arduino/", target: path.join(repoRoot, "arduino") },
    { source: "setup.sh", target: "/etc/systemd/system/skychopper.service", kind: "generated" },
    { source: "setup.sh", target: "/etc/nginx/sites-available/skychopper", kind: "generated" },
    { source: "setup.sh", target: "/etc/skychopper-update-repo", kind: "generated" },
    { source: "data/settings.json", target: path.join(repoRoot, "data", "settings.json"), kind: "generated" },
    { source: "data/status.json", target: path.join(repoRoot, "data", "status.json"), kind: "generated" },
    { source: "data/log.csv", target: path.join(repoRoot, "data", "log.csv"), kind: "generated" },
    { source: "data/network.csv", target: path.join(repoRoot, "data", "network.csv"), kind: "generated" }
];

function renderRepoTree(paths, associationMap) {
    const tree = {};
    for (const filePath of paths) {
        let node = tree;
        const parts = filePath.split("/");
        for (const part of parts.slice(0, -1)) node = node[part] ||= {};
        node[parts[parts.length - 1]] = null;
    }

    const lines = ["."];
    function renderNode(node, prefix = "", parent = "") {
        const entries = Object.entries(node).sort(([leftName, leftChild], [rightName, rightChild]) => {
            if ((leftChild === null) !== (rightChild === null)) return leftChild === null ? 1 : -1;
            return leftName.localeCompare(rightName, undefined, { sensitivity: "base" });
        });

        entries.forEach(([name, child], index) => {
            const last = index === entries.length - 1;
            const branch = last ? "└── " : "├── ";
            const entryPath = parent ? `${parent}/${name}` : name;
            const isDirectory = child !== null;
            const associations = !isDirectory && associationMap.get(entryPath);
            const label = `${name}${isDirectory ? "/" : ""}${associations?.length ? `  →  ${associations.join(" | ")}` : ""}`;
            lines.push(`${prefix}${branch}${label}`);
            if (isDirectory) renderNode(child, `${prefix}${last ? "    " : "│   "}`, entryPath);
        });
    }
    renderNode(tree);
    return lines.join("\n");
}

function runNetworkCommand(command, args) {
    return new Promise((resolve) => {
        execFile(command, args, { timeout: 1500, encoding: "utf8" }, (error, stdout) => {
            resolve(error ? "" : String(stdout || "").trim());
        });
    });
}

async function getNetworkStats() {
    const interfaces = Object.entries(os.networkInterfaces())
        .map(([name, addresses]) => ({
            name,
            addresses: (addresses || [])
                .filter((address) => !address.internal && (address.family === "IPv4" || address.family === 4))
                .map((address) => address.address)
        }))
        .filter((item) => item.addresses.length > 0);

    const routeText = process.platform === "win32"
        ? ""
        : await runNetworkCommand("ip", ["-4", "route", "show", "default"]);
    const defaultRoute = routeText.split(/\r?\n/).find((line) => line.startsWith("default")) || "";
    const routeParts = defaultRoute.split(/\s+/);
    const devIndex = routeParts.indexOf("dev");
    const viaIndex = routeParts.indexOf("via");
    const defaultInterface = devIndex >= 0 ? routeParts[devIndex + 1] : "";
    const defaultGateway = viaIndex >= 0 ? routeParts[viaIndex + 1] : "";
    const primaryIp = interfaces.find((item) => item.name === defaultInterface)?.addresses[0]
        || interfaces[0]?.addresses[0]
        || "Unavailable";
    let networkTraffic = "Unavailable";
    if (defaultInterface && process.platform === "linux") {
        try {
            const statsPath = path.join("/sys/class/net", defaultInterface, "statistics");
            const receivedBytes = Number(fs.readFileSync(path.join(statsPath, "rx_bytes"), "utf8").trim());
            const sentBytes = Number(fs.readFileSync(path.join(statsPath, "tx_bytes"), "utf8").trim());
            const formatBytes = (bytes) => {
                const units = ["B", "KB", "MB", "GB", "TB"];
                let value = bytes;
                let unit = 0;
                while (value >= 1024 && unit < units.length - 1) {
                    value /= 1024;
                    unit += 1;
                }
                return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
            };
            networkTraffic = `RX ${formatBytes(receivedBytes)} · TX ${formatBytes(sentBytes)}`;
        } catch {}
    }

    let wifi = {
        available: false,
        interface: "Unavailable",
        ssid: "Not connected",
        state: "Not connected",
        signal: "Unavailable",
        dbm: null,
        quality: 0,
        frequency: "Unavailable",
        txRate: "Unavailable"
    };

    if (process.platform === "win32") {
        const output = await runNetworkCommand("netsh", ["wlan", "show", "interfaces"]);
        const readField = (name) => output.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im"))?.[1]?.trim() || "";
        const state = readField("State");
        const ssid = readField("SSID");
        const signal = readField("Signal");
        const signalPercent = Number.parseFloat(signal);
        const connected = /connected/i.test(state) && Boolean(ssid);
        wifi = {
            available: Boolean(output),
            interface: readField("Name") || "Wi-Fi",
            ssid: ssid || "Not connected",
            state: connected ? "Connected" : state || "Not connected",
            signal: connected && signal ? signal : "Unavailable",
            dbm: null,
            quality: Number.isFinite(signalPercent) ? signalPercent : 0,
            frequency: readField("Channel") ? `Channel ${readField("Channel")}` : "Unavailable",
            txRate: readField("Transmit rate (Mbps)") || "Unavailable"
        };
    } else {
        const deviceText = await runNetworkCommand("iw", ["dev"]);
        const wifiInterfaces = [...deviceText.matchAll(/^\s*Interface\s+(\S+)/gm)].map((match) => match[1]);
        const selectedInterface = wifiInterfaces.includes(defaultInterface) ? defaultInterface : wifiInterfaces[0];
        if (selectedInterface) {
            const link = await runNetworkCommand("iw", ["dev", selectedInterface, "link"]);
            const connected = Boolean(link) && !link.startsWith("Not connected");
            const ssid = link.match(/^\s*SSID:\s*(.+)$/m)?.[1]?.trim() || "Not connected";
            const dbmValue = Number.parseFloat(link.match(/^\s*signal:\s*(-?[\d.]+)\s*dBm/m)?.[1]);
            const quality = Number.isFinite(dbmValue) ? Math.max(0, Math.min(100, Math.round((dbmValue + 100) * 2))) : 0;
            wifi = {
                available: true,
                interface: selectedInterface,
                ssid,
                state: connected ? "Connected" : "Not connected",
                signal: Number.isFinite(dbmValue) ? `${dbmValue.toFixed(0)} dBm` : "Unavailable",
                dbm: Number.isFinite(dbmValue) ? dbmValue : null,
                quality,
                frequency: link.match(/^\s*freq:\s*(.+)$/m)?.[1]?.trim() ? `${link.match(/^\s*freq:\s*(.+)$/m)[1].trim()} MHz` : "Unavailable",
                txRate: link.match(/^\s*tx bitrate:\s*(.+)$/m)?.[1]?.trim() || "Unavailable"
            };
        }
    }

    const hostname = os.hostname();
    return {
        hostname,
        localHostname: hostname.toLowerCase().endsWith(".local") ? hostname : `${hostname}.local`,
        primaryIp,
        defaultInterface: defaultInterface || "Unavailable",
        defaultGateway: defaultGateway || "Unavailable",
        networkTraffic,
        interfaces,
        wifi
    };
}

async function getSystemStats() {
    const cpuTimes = os.cpus().reduce((total, cpu) => {
        const cpuTotal = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
        return { idle: total.idle + cpu.times.idle, total: total.total + cpuTotal };
    }, { idle: 0, total: 0 });
    const previousSample = previousCpuTimes;
    previousCpuTimes = cpuTimes;
    const totalDelta = previousSample ? cpuTimes.total - previousSample.total : 0;
    const idleDelta = previousSample ? cpuTimes.idle - previousSample.idle : 0;
    const cpuUsagePercent = totalDelta > 0
        ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100))
        : null;

    let temperatureC = null;
    if (process.platform === "linux") {
        try {
            const rawTemperature = Number(fs.readFileSync("/sys/class/thermal/thermal_zone0/temp", "utf8").trim());
            if (Number.isFinite(rawTemperature)) temperatureC = rawTemperature > 1000 ? rawTemperature / 1000 : rawTemperature;
        } catch {}
    }

    let disk = { totalBytes: null, usedBytes: null, usedPercent: null };
    if (process.platform === "linux") {
        const diskOutput = await runNetworkCommand("df", ["-Pk", "/"]);
        const diskLine = diskOutput.split(/\r?\n/).slice(1).find((line) => line.trim());
        if (diskLine) {
            const fields = diskLine.trim().split(/\s+/);
            const totalKb = Number(fields[1]);
            const usedKb = Number(fields[2]);
            const usedPercent = Number.parseFloat(fields[4]);
            if (Number.isFinite(totalKb) && Number.isFinite(usedKb)) {
                disk = { totalBytes: totalKb * 1024, usedBytes: usedKb * 1024, usedPercent: Number.isFinite(usedPercent) ? usedPercent : null };
            }
        }
    }

    const totalMemory = os.totalmem();
    const freeMemory = os.freemem();
    return {
        hostname: os.hostname(),
        uptimeSeconds: Math.floor(os.uptime()),
        platform: `${os.type()} ${os.release()} (${os.arch()})`,
        cpuCount: os.cpus().length,
        cpuUsagePercent: Number.isFinite(cpuUsagePercent) ? Number(cpuUsagePercent.toFixed(1)) : null,
        loadAverage: os.loadavg().map((value) => Number(value.toFixed(2))),
        temperatureC: Number.isFinite(temperatureC) ? Number(temperatureC.toFixed(1)) : null,
        memory: {
            totalBytes: totalMemory,
            usedBytes: Math.max(0, totalMemory - freeMemory),
            usedPercent: totalMemory > 0 ? Math.round(((totalMemory - freeMemory) / totalMemory) * 100) : 0
        },
        disk
    };
}

function getDeviceStats() {
    let serialDevices = [];
    if (process.platform === "linux") {
        try {
            serialDevices = fs.readdirSync("/dev")
                .filter((name) => /^(tty(ACM|USB|S|AMA)\d+|serial0)$/.test(name))
                .map((name) => {
                    const devicePath = path.join("/dev", name);
                    let resolvedPath = devicePath;
                    try { resolvedPath = fs.realpathSync(devicePath); } catch {}
                    return { path: devicePath, resolvedPath };
                });
        } catch {}
    }
    return {
        configuredPort: SERIAL_PORT || "Not configured",
        baudRate: SERIAL_BAUD,
        connected: Boolean(serialPortInstance && serialPortInstance.isOpen),
        serialDevices
    };
}

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
    force_simulation_enabled: false,
    source_voltage_only: true,
    power_override: "auto",
    title: 1
};

// Default status if missing
const defaultStatus = {
    batt_voltage: 12.0,
    source_voltage: 0,
    buck_voltage: 9.0,
    batt_percent: 85,
    use_source: false,
    system_on: false,
    telemetry_mode: "source_only",
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

if (!fs.existsSync(networkLogFile)) {
    fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n`);
    console.log("Created network.csv");
}

ensureLogHeader();
ensureNetworkLogHeader();

// ===== CONFIG =====
const SERIAL_PORT = process.env.SERIAL_PORT || "";
const SERIAL_BAUD = Number.parseInt(process.env.SERIAL_BAUD || "115200", 10);
const HTTP_PORT = Number.parseInt(process.env.PORT || "8000", 10);
const ENABLE_API_SERVER = process.env.ENABLE_API_SERVER !== "0";

const LOG_INTERVAL_MS = 5000;
const LOG_MAX_LINES = 1000000;
const NETWORK_LOG_MAX_LINES = LOG_MAX_LINES;
const NETWORK_SAMPLE_INTERVAL_MS = 10000;
let previousCpuTimes = null;
let lastLogAt = 0;
let logLineCount = 0;
let networkLineCount = 0;
let networkDisconnected = null;
let networkDisconnectedAt = null;
let networkLastDisconnectAt = null;
let networkLastReconnectAt = null;
let networkLastDowntimeSeconds = null;
let networkDisconnectCount = 0;
let networkReconnectCount = 0;
let networkDowntimeTotalMs = 0;
let networkDowntimeCount = 0;
let networkDisconnectIntervalTotalMs = 0;
let networkDisconnectIntervalCount = 0;
let networkPreviousDisconnectAt = null;
const networkRecentEvents = [];
let networkSampleInFlight = null;
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

function ensureNetworkLogHeader() {
    ensureDataFolder();
    if (!fs.existsSync(networkLogFile)) {
        fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n`);
        return;
    }

    const header = fs.readFileSync(networkLogFile, "utf8").split(/\r?\n/, 1)[0].trim();
    if (header !== NETWORK_LOG_HEADER) {
        console.warn("Resetting network.csv because its header is invalid");
        fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n`);
    }
}

function loadNetworkLogState() {
    ensureNetworkLogHeader();
    const lines = fs.readFileSync(networkLogFile, "utf8").split(/\r?\n/).filter(Boolean).slice(1);
    networkLineCount = lines.length;
    if (networkLineCount > NETWORK_LOG_MAX_LINES) {
        const retained = lines.slice(-NETWORK_LOG_MAX_LINES);
        fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n${retained.join("\n")}\n`);
        networkLineCount = retained.length;
    }

    for (const line of lines.slice(-NETWORK_LOG_MAX_LINES)) {
        const [timeIso, event, durationText] = line.split(",");
        const eventTime = Date.parse(timeIso);
        if (!Number.isFinite(eventTime) || (event !== "disconnect" && event !== "reconnect")) continue;

        const entry = { time_iso: timeIso, event, duration_seconds: null };
        if (event === "disconnect") {
            networkDisconnectCount += 1;
            networkLastDisconnectAt = timeIso;
            networkDisconnectedAt = eventTime;
            if (networkPreviousDisconnectAt !== null) {
                networkDisconnectIntervalTotalMs += eventTime - networkPreviousDisconnectAt;
                networkDisconnectIntervalCount += 1;
            }
            networkPreviousDisconnectAt = eventTime;
            networkDisconnected = true;
        } else {
            const durationSeconds = Number(durationText);
            networkReconnectCount += 1;
            networkLastReconnectAt = timeIso;
            networkDisconnected = false;
            networkDisconnectedAt = null;
            if (Number.isFinite(durationSeconds) && durationSeconds >= 0) {
                entry.duration_seconds = durationSeconds;
                networkDowntimeTotalMs += durationSeconds * 1000;
                networkDowntimeCount += 1;
                networkLastDowntimeSeconds = durationSeconds;
            }
        }
        networkRecentEvents.push(entry);
        if (networkRecentEvents.length > 10) networkRecentEvents.shift();
    }
}

function trimNetworkLogIfNeeded() {
    if (networkLineCount <= NETWORK_LOG_MAX_LINES) return;
    const lines = fs.readFileSync(networkLogFile, "utf8").split(/\r?\n/).filter(Boolean);
    const retained = lines.slice(1).slice(-NETWORK_LOG_MAX_LINES);
    fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n${retained.join("\n")}\n`);
    networkLineCount = retained.length;
}

function appendNetworkEvent(event, time, durationMs = null) {
    ensureNetworkLogHeader();
    const durationSeconds = durationMs === null ? "" : (durationMs / 1000).toFixed(3);
    const line = `${new Date(time).toISOString()},${event},${durationSeconds}\n`;
    fs.appendFileSync(networkLogFile, line);
    networkLineCount += 1;
    trimNetworkLogIfNeeded();

    const entry = {
        time_iso: new Date(time).toISOString(),
        event,
        duration_seconds: durationMs === null ? null : Number(durationSeconds)
    };
    networkRecentEvents.push(entry);
    if (networkRecentEvents.length > 10) networkRecentEvents.shift();
    return entry;
}

function recordNetworkDisconnect(time) {
    const entry = appendNetworkEvent("disconnect", time);
    const disconnectTime = Date.parse(entry.time_iso);
    networkDisconnectCount += 1;
    networkLastDisconnectAt = entry.time_iso;
    if (networkPreviousDisconnectAt !== null) {
        networkDisconnectIntervalTotalMs += disconnectTime - networkPreviousDisconnectAt;
        networkDisconnectIntervalCount += 1;
    }
    networkPreviousDisconnectAt = disconnectTime;
    networkDisconnected = true;
    networkDisconnectedAt = disconnectTime;
}

function recordNetworkState(stats) {
    const connected = (stats.interfaces || []).length > 0;
    const now = Date.now();

    if (networkDisconnected === null) {
        networkDisconnected = !connected;
        if (!connected) {
            recordNetworkDisconnect(now);
            return;
        }
        return;
    }

    if (connected === !networkDisconnected) return;
    if (connected) {
        const durationMs = networkDisconnectedAt === null ? null : Math.max(0, now - networkDisconnectedAt);
        const entry = appendNetworkEvent("reconnect", now, durationMs);
        networkReconnectCount += 1;
        networkLastReconnectAt = entry.time_iso;
        if (durationMs !== null) {
            networkDowntimeTotalMs += durationMs;
            networkDowntimeCount += 1;
            networkLastDowntimeSeconds = durationMs / 1000;
        }
        networkDisconnected = false;
        networkDisconnectedAt = null;
        return;
    }

    recordNetworkDisconnect(now);
}

function getNetworkMonitoringSummary() {
    const now = Date.now();
    const currentDowntimeMs = networkDisconnected && networkDisconnectedAt !== null
        ? Math.max(0, now - networkDisconnectedAt)
        : null;
    return {
        connected: networkDisconnected === false,
        disconnectCount: networkDisconnectCount,
        reconnectCount: networkReconnectCount,
        lastDisconnectAt: networkLastDisconnectAt,
        lastReconnectAt: networkLastReconnectAt,
        currentDowntimeSeconds: currentDowntimeMs === null ? null : currentDowntimeMs / 1000,
        lastDowntimeSeconds: networkLastDowntimeSeconds,
        averageDowntimeSeconds: networkDowntimeCount ? networkDowntimeTotalMs / networkDowntimeCount / 1000 : null,
        averageDisconnectIntervalSeconds: networkDisconnectIntervalCount
            ? networkDisconnectIntervalTotalMs / networkDisconnectIntervalCount / 1000
            : null,
        recentEvents: networkRecentEvents.slice().reverse()
    };
}

function sampleNetworkStats() {
    if (networkSampleInFlight) return networkSampleInFlight;
    networkSampleInFlight = getNetworkStats()
        .then((stats) => {
            recordNetworkState(stats);
            return stats;
        })
        .finally(() => {
            networkSampleInFlight = null;
        });
    return networkSampleInFlight;
}

function listDownloadableFiles() {
    ensureDataFolder();
    return fs.readdirSync(dataFolder, { withFileTypes: true })
        .filter((entry) => entry.isFile() && DOWNLOADABLE_DATA_EXTENSIONS.has(path.extname(entry.name).toLowerCase()))
        .map((entry) => {
            const extension = path.extname(entry.name).toLowerCase();
            const category = extension === ".csv" || extension === ".log"
                ? "Logs"
                : entry.name === "settings.json" ? "Configuration" : "Runtime data";
            const descriptions = {
                "log.csv": "Voltage and telemetry history",
                "network.csv": "Network disconnect and reconnect history",
                "settings.json": "Dashboard configuration",
                "status.json": "Current telemetry status"
            };
            return {
                id: entry.name,
                name: entry.name === "log.csv" ? "Voltage log"
                    : entry.name === "network.csv" ? "Network connection log"
                        : entry.name,
                category,
                description: descriptions[entry.name] || "SkyChopper data file",
                filename: entry.name,
                size: fs.statSync(path.join(dataFolder, entry.name)).size
            };
        })
        .sort((left, right) => left.category.localeCompare(right.category) || left.filename.localeCompare(right.filename));
}

function getDownloadableFile(id) {
    if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null;
    const item = listDownloadableFiles().find((file) => file.id === id);
    if (!item) return null;

    const dataRoot = fs.realpathSync(dataFolder);
    const resolvedPath = fs.realpathSync(path.join(dataRoot, item.filename));
    if (!resolvedPath.startsWith(`${dataRoot}${path.sep}`) || !fs.statSync(resolvedPath).isFile()) return null;
    return { ...item, path: resolvedPath };
}

function resetNetworkLogState() {
    fs.writeFileSync(networkLogFile, `${NETWORK_LOG_HEADER}\n`);
    networkLineCount = 0;
    networkDisconnected = null;
    networkDisconnectedAt = null;
    networkLastDisconnectAt = null;
    networkLastReconnectAt = null;
    networkLastDowntimeSeconds = null;
    networkDisconnectCount = 0;
    networkReconnectCount = 0;
    networkDowntimeTotalMs = 0;
    networkDowntimeCount = 0;
    networkDisconnectIntervalTotalMs = 0;
    networkDisconnectIntervalCount = 0;
    networkPreviousDisconnectAt = null;
    networkRecentEvents.length = 0;
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

function writeSourceOnlyStatus(sourceVoltage) {
    const payload = {
        source_voltage: sourceVoltage,
        telemetry_mode: "source_only",
        arduino_connected: true,
        time: Date.now()
    };
    fs.writeFileSync(statusFile, JSON.stringify(payload, null, 2));
    maybeLog({ source_voltage: sourceVoltage });
}

countLogLines();
loadNetworkLogState();

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
        telemetry_mode: "full",
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
    resetNetworkLogState();
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
            syncSimulatorFallback();
        });

        parser.on("data", (line) => {
            const text = String(line).trim();
            if (!text) return;

            console.log(`📡 Raw serial data: ${text}`);
            recordSerialMonitor("arduino_to_pi", text);
            if (loadSettings().force_simulation_enabled === true) {
                console.log("Forced simulation is enabled; received serial telemetry was ignored.");
                return;
            }

            try {
                const data = JSON.parse(text);
                console.log(`✅ Parsed Arduino data → batt=${data.batt_voltage?.toFixed(2)}V source=${data.source_voltage?.toFixed(2)}V buck=${data.buck_voltage?.toFixed(2)}V relay=${data.relay_state}`);

                const sourceOnlyMode = loadSettings().source_voltage_only === true;
                const sourceOnlyPacket = Number.isFinite(data.source_voltage)
                    && !Number.isFinite(data.batt_voltage)
                    && !Number.isFinite(data.buck_voltage);
                if (sourceOnlyMode) {
                    if (Number.isFinite(data.source_voltage)) writeSourceOnlyStatus(data.source_voltage);
                    return;
                }
                if (sourceOnlyPacket && Number.isFinite(data.source_voltage)) {
                    writeSourceOnlyStatus(data.source_voltage);
                    return;
                }

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
    console.log("System simulator running");
}

function stopSimulator() {
    if (!simulatorTimer) return;
    clearInterval(simulatorTimer);
    simulatorTimer = null;
    console.log("Simulator stopped");
}

function syncSimulatorFallback() {
    const settings = loadSettings();
    if (settings.force_simulation_enabled === true) {
        startSimulator();
        return;
    }
    if (serialPortInstance) {
        stopSimulator();
        return;
    }
    if (settings.source_voltage_only === true) {
        stopSimulator();
        return;
    }
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

// Watch simulation and telemetry mode changes.
fs.watch(settingsFile, { persistent: true }, () => {
    if (pendingSettingsSync) clearTimeout(pendingSettingsSync);
    pendingSettingsSync = setTimeout(() => {
        pendingSettingsSync = null;
        syncSimulatorFallback();
    }, 150);
});

// ===== API SERVER =====
if (ENABLE_API_SERVER) {
    const sampleNetwork = () => {
        sampleNetworkStats().catch((error) => console.error("Unable to sample network status:", error));
    };
    sampleNetwork();
    setInterval(sampleNetwork, NETWORK_SAMPLE_INTERVAL_MS);

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

        if (pathname === "/api/repo-files" && req.method === "GET") {
            const gitArgs = ["-c", `safe.directory=${repoRoot}`, "-C", repoRoot, "ls-files", "--cached", "--others", "--exclude-standard", "-z"];
            execFile("git", gitArgs, { encoding: "buffer", timeout: 5000 }, (error, stdout) => {
                if (error) {
                    console.error("Unable to list repository files:", error);
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Could not list repository files" }));
                    return;
                }

                const filePaths = stdout.toString("utf8").split("\0").filter(Boolean);
                const associations = REPO_ASSOCIATIONS.map((entry) => ({
                    ...entry,
                    generated: entry.kind === "generated",
                    installed: fs.existsSync(entry.target)
                }));
                const associationMap = new Map();
                for (const association of associations) {
                    const targets = associationMap.get(association.source) || [];
                    targets.push(association.target);
                    associationMap.set(association.source, targets);
                }
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({
                    ok: true,
                    root: path.basename(repoRoot),
                    file_count: filePaths.length,
                    tree: renderRepoTree(filePaths, associationMap),
                    associations
                }));
            });
            return;
        }

        if (pathname === "/api/files" && req.method === "GET") {
            try {
                res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
                res.end(JSON.stringify({ ok: true, files: listDownloadableFiles() }));
            } catch (error) {
                console.error("Unable to list downloadable files:", error);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Could not list downloadable files" }));
            }
            return;
        }

        if (pathname.startsWith("/api/files/") && req.method === "GET") {
            let id;
            try {
                id = decodeURIComponent(pathname.slice("/api/files/".length));
            } catch {
                res.writeHead(400, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Invalid file identifier" }));
                return;
            }
            let file;
            try {
                file = getDownloadableFile(id);
                if (!file) {
                    res.writeHead(404, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Unknown or unavailable file" }));
                    return;
                }
                const contents = fs.readFileSync(file.path);
                res.writeHead(200, {
                    "Content-Type": "application/octet-stream",
                    "Content-Disposition": `attachment; filename="${file.filename}"`,
                    "Content-Length": contents.length,
                    "X-Content-Type-Options": "nosniff",
                    "Cache-Control": "no-store"
                });
                res.end(contents);
            } catch (error) {
                console.error(`Unable to download ${id}:`, error);
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: "Could not download the requested file" }));
            }
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

        if (pathname === "/api/network" && req.method === "GET") {
            sampleNetworkStats().then((stats) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, ...stats, monitoring: getNetworkMonitoringSummary() }));
            }).catch((error) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: error.message }));
            });
            return;
        }

        if (pathname === "/api/system" && req.method === "GET") {
            getSystemStats().then((stats) => {
                res.writeHead(200, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, ...stats }));
            }).catch((error) => {
                res.writeHead(500, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: false, error: error.message }));
            });
            return;
        }

        if (pathname === "/api/devices" && req.method === "GET") {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, ...getDeviceStats() }));
            return;
        }

        if (pathname === "/api/reader-log" && req.method === "GET") {
            const limit = Number.parseInt(requestUrl.searchParams.get("limit") || "80", 10);
            const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(200, limit) : 80;
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, entries: readerLogEntries.slice(-safeLimit) }));
            return;
        }

        if (pathname === "/api/reboot" && req.method === "POST") {
            execFile("/usr/bin/systemctl", ["--no-block", "reboot"], { timeout: 5000 }, (error) => {
                if (error) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: `Unable to reboot Raspberry Pi: ${error.message}` }));
                    return;
                }
                res.writeHead(202, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true, status: "rebooting" }));
            });
            return;
        }

        if (pathname === "/api/update" && req.method === "POST") {
            const updater = "/usr/local/sbin/skychopper-update";
            execFile(updater, [], (error) => {
                if (error) {
                    res.writeHead(500, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: error.message }));
                    return;
                }
                res.writeHead(202, { "Content-Type": "application/json" });
                res.end(JSON.stringify({ ok: true }));
            });
            return;
        }

        if (pathname === "/api/update/apt-upgrade" && req.method === "POST") {
            let body = "";
            req.on("data", (chunk) => { body += chunk; });
            req.on("end", () => {
                let approve;
                try {
                    approve = JSON.parse(body || "{}").approve;
                } catch {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Invalid upgrade decision" }));
                    return;
                }
                if (typeof approve !== "boolean") {
                    res.writeHead(400, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: false, error: "Upgrade decision must be a boolean" }));
                    return;
                }
                const decision = approve ? "--approve-apt-upgrade" : "--decline-apt-upgrade";
                execFile("/usr/local/sbin/skychopper-update", [decision], (error) => {
                    if (error) {
                        res.writeHead(409, { "Content-Type": "application/json" });
                        res.end(JSON.stringify({ ok: false, error: error.message }));
                        return;
                    }
                    res.writeHead(202, { "Content-Type": "application/json" });
                    res.end(JSON.stringify({ ok: true }));
                });
            });
            return;
        }

        if (pathname === "/api/update" && req.method === "GET") {
            const statusPath = "/var/lib/skychopper/update-status";
            const updateLogPath = "/var/log/skychopper-update.log";
            const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, "utf8").trim() : "Updater is not installed.";
            let output = "";
            try {
                const lines = fs.readFileSync(updateLogPath, "utf8").split(/\r?\n/);
                output = lines.slice(-100).join("\n");
            } catch {}
            const done = status === "Update complete." || status.startsWith("Update failed");
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true, status, output, done }));
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
