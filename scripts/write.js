const canvas = document.getElementById('monitorCanvas');
const ctx = canvas ? canvas.getContext('2d') : null;
const turbine = document.getElementById('turbine');
const dashboardTitle = document.getElementById('dashboard-title');
const statusSource = document.getElementById('status-source');
const statusBattery = document.getElementById('status-battery');
const statusArduino = document.getElementById('status-arduino');
const turbineLabel = document.getElementById('turbine-label');
const openSettings = document.getElementById('open-settings');
const openLogs = document.getElementById('open-logs');
const rebootButton = document.getElementById('reboot-pi');
const actionMessage = document.getElementById('action-message');
const clearLogs = document.getElementById('clear-logs');
const settingsBackdrop = document.getElementById('settings-backdrop');
const statusBuck = document.getElementById('status-buck');
const closeSettings = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const resetSettingsBtn = document.getElementById('reset-settings');
const resetAllBtn = document.getElementById('reset-all');
const logsBackdrop = document.getElementById('logs-backdrop');
const closeLogs = document.getElementById('close-logs');
const serialMonitorBackdrop = document.getElementById('serial-monitor-backdrop');
const closeSerialMonitor = document.getElementById('close-serial-monitor');
const downloadFileList = document.getElementById('download-file-list');
const downloadFileStatus = document.getElementById('download-file-status');
const logLinesCount = document.getElementById('log-lines-count');
const serialMonitorPanel = document.getElementById('serial-monitor-panel');
const toggleSerialMonitorBtn = document.getElementById('toggle-serial-monitor');
const serialMonitorFeed = document.getElementById('serial-monitor-feed');
const refreshLogBtn = document.getElementById('refresh-log');
const recentLogBody = document.getElementById('recent-log-body');
const readerLog = document.getElementById('reader-log');
const refreshSerialBtn = document.getElementById('refresh-serial');
const settingsVersion = document.getElementById('settings-version');
const appVersionLabel = document.getElementById('app-version');
const liveClock = document.getElementById('live-clock');
const documentBackdrop = document.getElementById('document-backdrop');
const documentTitle = document.getElementById('document-title');
const documentContent = document.getElementById('document-content');
const repoFileStatus = document.getElementById('repo-file-status');
const repoTree = document.getElementById('repo-tree');
const repoAssociations = document.getElementById('repo-associations');
const updateBackdrop = document.getElementById('update-backdrop');
const updateStatus = document.getElementById('update-status');
const updateOutput = document.getElementById('update-output');
const aptUpgradeDialog = document.getElementById('apt-upgrade-dialog-backdrop');
const aptUpgradeMessage = document.getElementById('apt-upgrade-message');
let updatePollTimer = null;
let updateRunning = false;
let updateAutoCloseTimer = null;
let updateUpgradePromptShown = false;
let documentRequestId = 0;
let pageScrollLock = null;
const networkState = document.getElementById('network-wifi-state');
let logAutoRefreshTimer = null;
let serialMonitorTimer = null;
const confirmBackdrop = document.getElementById('confirm-backdrop');
const confirmCancel = document.getElementById('confirm-cancel');
const confirmReset = document.getElementById('confirm-reset');
const confirmClearLogs = document.getElementById('confirm-clear-logs');
const confirmClearLogsCancel = document.getElementById('confirm-clear-logs-cancel');
const confirmClearLogsOk = document.getElementById('confirm-clear-logs-ok');
const confirmResetAll = document.getElementById('confirm-reset-all');
const confirmResetAllCancel = document.getElementById('confirm-reset-all-cancel');
const confirmResetAllOk = document.getElementById('confirm-reset-all-ok');
const inputPackFull = document.getElementById('setting-pack-full');
const inputPackEmpty = document.getElementById('setting-pack-empty');
const inputOnPercent = document.getElementById('setting-on-percent');
const inputOffPercent = document.getElementById('setting-off-percent');
const inputSimFallback = document.getElementById('setting-sim-fallback');
const inputForceSimulation = document.getElementById('setting-force-simulation');
const inputSourceVoltageOnly = document.getElementById('setting-source-voltage-only');
const logChart = document.getElementById('logChart');
const logChartCtx = logChart ? logChart.getContext('2d') : null;
const logChartTooltip = document.getElementById('log-chart-tooltip');
let logRowsCache = [];
let logHeaderCache = [];
let logChartPoints = [];
let serialMonitorEntries = [];
let serialMonitorLatestId = 0;
let serialMonitorOpenedAt = 0;
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const APP_VERSION = "1.3.20";
const LOG_WINDOW_MS = 10 * 60 * 1000;
const LOG_WINDOW_PAD_MS = 10000;
const LOG_DISPLAY_LAG_MS = 5000;
const LOG_LEFT_HIDE_MS = 10000;
const MAX_LOG_ROWS = 2500;
const LOG_CHART_ROWS = 2400;
const LOG_REFRESH_MS = 15000;
const confirmSim = document.getElementById('confirm-sim');
const confirmSimCancel = document.getElementById('confirm-sim-cancel');
const confirmSimOk = document.getElementById('confirm-sim-ok');

const titleModes = {
    1: {
        productName: "SkyChopper",
        dashboardName: "SKYCHOPPER // WIND POWER",
        isVerticalAxis: false
    },
    2: {
        productName: "SkySlicer",
        dashboardName: "SKYSLICER // WIND POWER",
        isVerticalAxis: true
    }
};

// NEW: Override switch element
const overrideSwitch = document.getElementById('override-switch');

const defaultStatus = {
    batt_voltage: 0,
    source_voltage: 0,
    buck_voltage: 0,
    batt_percent: 0,
    use_source: false,
    system_on: false,
    rpm: 100,
    current: 0,
    dump_load: false
};

let status = { ...defaultStatus };
let targetStatus = { ...defaultStatus };
let availableKeys = new Set();
let dpr = window.devicePixelRatio || 1;
let lastFrame = performance.now();

const palette =
    {
        bg: "#05080b",
        panel: "#111111",
        ink: "#d8e8f4",
        muted: "#7896ad",
        accent: "#57b6ef",
        good: "#48d5a0",
        warn: "#ffbd69",
        danger: "#ff737d",
        outline: "#252525"
    };

const settingsDefaults = {
    target_buck_voltage: 9,
    source_expected_min_v: 8.5,
    source_expected_max_v: 9.5,
    batt_full_voltage: 12.6,
    batt_empty_voltage: 9.0,
    batt_on_percent: 80,
    batt_off_percent: 60,
    sim_fallback_enabled: true,
    force_simulation_enabled: false,
    source_voltage_only: true,
    power_override: "auto",
    title: 1
};

let settingsState = { ...settingsDefaults };
let thresholds = {
    battStartV: 11.5,
    battStopV: 10.8,
    sourceExpectedMinV: settingsState.source_expected_min_v,
    sourceExpectedMaxV: settingsState.source_expected_max_v
};

function applyTitleMode() {
    const rawTitleMode = Number.parseInt(settingsState.title, 10);
    const titleConfig = titleModes[rawTitleMode] || titleModes[1];
    document.title = "SkyChopper Dashboard";
    if (dashboardTitle) {
        dashboardTitle.textContent = titleConfig.dashboardName;
    }
    if (turbine) {
        turbine.classList.toggle("vertical-axis", titleConfig.isVerticalAxis);
        turbine.setAttribute("aria-label", `${titleConfig.productName} turbine`);
    }
}

function applyStatusLevel(dotEl, level) {
    if (!dotEl) return;
    const cleaned = String(level || "").trim();
    const levelClasses = ["on", "warn", "danger"];
    dotEl.classList.remove(...levelClasses);
    if (cleaned) dotEl.classList.add(cleaned);
    const item = dotEl.closest(".status-item");
    if (item) {
        item.classList.remove(...levelClasses);
        if (cleaned) item.classList.add(cleaned);
    }
}

function normalizeStatus(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    return {
        ...defaultStatus,
        ...d,
        batt_voltage: Number.isFinite(d.batt_voltage) ? d.batt_voltage : defaultStatus.batt_voltage,
        source_voltage: Number.isFinite(d.source_voltage) ? d.source_voltage : defaultStatus.source_voltage,
        buck_voltage: Number.isFinite(d.buck_voltage) ? d.buck_voltage : defaultStatus.buck_voltage,
        batt_percent: Number.isFinite(d.batt_percent) ? d.batt_percent : defaultStatus.batt_percent,
        rpm: Number.isFinite(d.rpm) ? d.rpm : defaultStatus.rpm,
        current: Number.isFinite(d.current) ? d.current : defaultStatus.current,
        use_source: Boolean(d.use_source),
        system_on: Boolean(d.system_on),
        dump_load: Boolean(d.dump_load),
        arduino_connected: Boolean(d.arduino_connected)
    };
}

function stepStatus(dt) {
    const lerp = (a, b, t) => a + (b - a) * t;
    const t = Math.min(1, dt / 250);

    status = {
        ...status,
        ...targetStatus,
        batt_voltage: lerp(status.batt_voltage, targetStatus.batt_voltage, t),
        source_voltage: lerp(status.source_voltage, targetStatus.source_voltage, t),
        buck_voltage: lerp(status.buck_voltage, targetStatus.buck_voltage, t),
        batt_percent: lerp(status.batt_percent, targetStatus.batt_percent, t),
        rpm: lerp(status.rpm, targetStatus.rpm, t),
        current: lerp(status.current, targetStatus.current, t)
    };
}

function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

function resizeCanvas() {
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function resizeLogChart() {
    if (!logChart || !logChartCtx) return;
    const rect = logChart.getBoundingClientRect();
    const scale = window.devicePixelRatio || 1;
    logChart.width = Math.max(1, Math.floor(rect.width * scale));
    logChart.height = Math.max(1, Math.floor(rect.height * scale));
    logChartCtx.setTransform(scale, 0, 0, scale, 0, 0);
    if (logRowsCache.length) {
        renderLogChart(logRowsCache);
    }
}

function applySettings(next) {
    settingsState = { ...settingsState, ...next };
    if (typeof settingsState.source_voltage_only !== "boolean") settingsState.source_voltage_only = true;
    if (typeof settingsState.sim_fallback_enabled !== "boolean") {
        settingsState.sim_fallback_enabled = settingsDefaults.sim_fallback_enabled;
    }
    if (typeof settingsState.force_simulation_enabled !== "boolean") {
        settingsState.force_simulation_enabled = settingsDefaults.force_simulation_enabled;
    }
    if (settingsState.force_simulation_enabled) {
        settingsState.source_voltage_only = false;
        settingsState.sim_fallback_enabled = false;
    } else if (settingsState.source_voltage_only) {
        settingsState.sim_fallback_enabled = false;
    }
    document.body.classList.toggle("source-only-mode", settingsState.source_voltage_only);
    const normalizedTitle = Number.parseInt(settingsState.title, 10);
    settingsState.title = titleModes[normalizedTitle] ? normalizedTitle : settingsDefaults.title;
    const fullPack = Number.isFinite(settingsState.batt_full_voltage) ? settingsState.batt_full_voltage : settingsDefaults.batt_full_voltage;
    const emptyPack = Number.isFinite(settingsState.batt_empty_voltage) ? settingsState.batt_empty_voltage : settingsDefaults.batt_empty_voltage;
    const onPct = Number.isFinite(settingsState.batt_on_percent) ? settingsState.batt_on_percent : settingsDefaults.batt_on_percent;
    const offPct = Number.isFinite(settingsState.batt_off_percent) ? settingsState.batt_off_percent : settingsDefaults.batt_off_percent;
    const toVolt = (pct) => emptyPack + (fullPack - emptyPack) * (pct / 100);
    thresholds = {
        battStartV: toVolt(onPct),
        battStopV: toVolt(offPct),
        sourceExpectedMinV: Number.isFinite(settingsState.source_expected_min_v) ? settingsState.source_expected_min_v : thresholds.sourceExpectedMinV,
        sourceExpectedMaxV: Number.isFinite(settingsState.source_expected_max_v) ? settingsState.source_expected_max_v : thresholds.sourceExpectedMaxV
    };
    applyTitleMode();
}

function getPackVoltageRange() {
    return {
        full: Number.isFinite(settingsState.batt_full_voltage) ? settingsState.batt_full_voltage : settingsDefaults.batt_full_voltage,
        empty: Number.isFinite(settingsState.batt_empty_voltage) ? settingsState.batt_empty_voltage : settingsDefaults.batt_empty_voltage
    };
}

function fillSettingsForm() {
    if (!inputPackFull) return;
    inputPackFull.value = settingsState.batt_full_voltage;
    inputPackEmpty.value = settingsState.batt_empty_voltage;
    inputOnPercent.value = settingsState.batt_on_percent;
    inputOffPercent.value = settingsState.batt_off_percent;
    if (inputSimFallback) {
        inputSimFallback.checked = Boolean(settingsState.sim_fallback_enabled);
    }
    if (inputForceSimulation) inputForceSimulation.checked = Boolean(settingsState.force_simulation_enabled);
    if (inputSourceVoltageOnly) inputSourceVoltageOnly.checked = settingsState.source_voltage_only;
}

// NEW: Update the visual state of the three-switch
function movePill(mode) {
    if (!overrideSwitch) return;
    const buttons = overrideSwitch.querySelectorAll(".switch-btn");
    const pill = overrideSwitch.querySelector(".slider-pill");

    let targetBtn = null;

    buttons.forEach(btn => {
        if (btn.dataset.mode === mode) {
            targetBtn = btn;
        }
    });

    if (!targetBtn || !pill) return;

    const left = targetBtn.offsetLeft - 3;
    const width = targetBtn.offsetWidth;

    pill.style.transform = `translateX(${left}px)`;
    pill.style.width = width + "px";

    buttons.forEach(b => {
        b.classList.toggle("active", b === targetBtn);
    });
}

function updateOverrideSwitch() {
    if (!overrideSwitch) return;
    const mode = settingsState.power_override || "auto";
    overrideSwitch.querySelectorAll('.switch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    movePill(mode);
}

function parseNum(value, fallback) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

async function writeSettingsToFile() {
    const res = await fetch(`${API_BASE}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settingsState)
    });
    if (!res.ok) {
        throw new Error("Settings save failed");
    }
}

async function loadSettings() {
    let loaded = null;
    try {
        const res = await fetch("data/settings.json", { cache: "no-store" });
        loaded = await res.json();
    } catch {
        loaded = null;
    }

    if (loaded) {
        applySettings(loaded);
    }

    fillSettingsForm();
    updateOverrideSwitch();   // ← NEW
    if (settingsVersion) {
        settingsVersion.textContent = `Version ${APP_VERSION}`;
    }
    if (appVersionLabel) appVersionLabel.textContent = `v${APP_VERSION}`;
}

function openSettingsModal() {
    if (!settingsBackdrop) return;
    settingsBackdrop.classList.add("open");
    settingsBackdrop.setAttribute("aria-hidden", "false");
}

function closeSettingsModal() {
    if (!settingsBackdrop) return;
    settingsBackdrop.classList.remove("open");
    settingsBackdrop.setAttribute("aria-hidden", "true");
}

function lockPageScroll() {
    if (pageScrollLock) return;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const bodyPaddingRight = Number.parseFloat(getComputedStyle(document.body).paddingRight) || 0;
    pageScrollLock = {
        overflow: document.body.style.overflow,
        paddingRight: document.body.style.paddingRight
    };
    document.body.style.paddingRight = `${bodyPaddingRight + scrollbarWidth}px`;
    document.body.style.overflow = "hidden";
}

function unlockPageScroll() {
    if (!pageScrollLock) return;
    document.body.style.overflow = pageScrollLock.overflow;
    document.body.style.paddingRight = pageScrollLock.paddingRight;
    pageScrollLock = null;
}

function openLogsModal() {
    if (!logsBackdrop) return;
    if (!logsBackdrop.classList.contains("open")) lockPageScroll();
    logsBackdrop.classList.add("open");
    logsBackdrop.setAttribute("aria-hidden", "false");
    closeLogs?.focus();
    loadDownloadFiles();
    if (!logAutoRefreshTimer) logAutoRefreshTimer = setInterval(() => {
        loadDownloadFiles();
    }, LOG_REFRESH_MS);
}

function closeLogsModal() {
    if (!logsBackdrop) return;
    logsBackdrop.classList.remove("open");
    logsBackdrop.setAttribute("aria-hidden", "true");
    unlockPageScroll();
    if (logAutoRefreshTimer) {
        clearInterval(logAutoRefreshTimer);
        logAutoRefreshTimer = null;
    }
}

function parseCsvRows(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) {
        return { header: [], rows: [] };
    }

    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    const header = (lines[0] || "").split(",").map((cell) => cell.trim());
    const rows = lines.slice(1).map((line) => {
        const cells = line.split(",");
        return header.map((_, index) => cells[index] ?? "");
    });

    return { header, rows };
}

function getLogCell(row, headerMap, key, fallbackIndex = -1) {
    const index = headerMap.get(key);
    if (typeof index === "number") {
        return row[index] ?? "";
    }
    return fallbackIndex >= 0 ? (row[fallbackIndex] ?? "") : "";
}

function updateSerialMonitorVisibility() {
    const isOpen = serialMonitorBackdrop?.classList.contains("open");
    if (serialMonitorBackdrop) {
        serialMonitorBackdrop.setAttribute("aria-hidden", isOpen ? "false" : "true");
    }
    if (toggleSerialMonitorBtn) {
        toggleSerialMonitorBtn.textContent = isOpen ? "Serial Monitor Open" : "Open Serial Monitor";
    }
}

function resetSerialMonitorState() {
    serialMonitorEntries = [];
    serialMonitorLatestId = 0;
    serialMonitorOpenedAt = Date.now();
    renderSerialMonitor();
}

function openSerialMonitorModal() {
    if (!serialMonitorBackdrop) return;
    serialMonitorBackdrop.classList.add("open");
    serialMonitorBackdrop.setAttribute("aria-hidden", "false");
    resetSerialMonitorState();
    updateSerialMonitorVisibility();
    loadSerialMonitor();
    serialMonitorTimer = setInterval(() => loadSerialMonitor(true), 5000);
}

function closeSerialMonitorModal() {
    if (!serialMonitorBackdrop) return;
    serialMonitorBackdrop.classList.remove("open");
    serialMonitorBackdrop.setAttribute("aria-hidden", "true");
    if (serialMonitorTimer) {
        clearInterval(serialMonitorTimer);
        serialMonitorTimer = null;
    }
    serialMonitorEntries = [];
    serialMonitorLatestId = 0;
    serialMonitorOpenedAt = 0;
    renderSerialMonitor();
    updateSerialMonitorVisibility();
}

function renderSerialMonitor() {
    if (!serialMonitorFeed) return;
    serialMonitorFeed.innerHTML = "";

    if (!serialMonitorEntries.length) {
        const empty = document.createElement("div");
        empty.className = "serial-monitor-empty";
        empty.textContent = "Waiting for serial traffic...";
        serialMonitorFeed.appendChild(empty);
        return;
    }

    serialMonitorEntries.forEach((entry) => {
        const row = document.createElement("div");
        const outbound = entry.direction === "pi_to_arduino";
        row.className = `serial-monitor-row ${outbound ? "outbound" : "inbound"}`;

        const time = document.createElement("div");
        time.className = "serial-monitor-time";
        time.textContent = entry.time_iso || "";

        const dir = document.createElement("div");
        dir.className = "serial-monitor-dir";
        dir.textContent = outbound ? "Pi -> Arduino" : "Arduino -> Pi";

        const message = document.createElement("div");
        message.className = "serial-monitor-message";
        message.textContent = entry.message || "";

        row.appendChild(time);
        row.appendChild(dir);
        row.appendChild(message);
        serialMonitorFeed.appendChild(row);
    });

    requestAnimationFrame(() => {
        serialMonitorFeed.scrollTop = serialMonitorFeed.scrollHeight;
    });
}

async function loadSerialMonitor(isRefresh = false) {
    if (!serialMonitorFeed || !serialMonitorBackdrop?.classList.contains("open")) return;
    try {
        const params = new URLSearchParams();
        if (isRefresh) {
            params.set('limit', '10');
            params.set('since', '0');
        } else {
            params.set('since', serialMonitorLatestId.toString());
        }
        const res = await fetch(`${API_BASE}/api/serial-monitor?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error("serial monitor fetch failed");
        const payload = await res.json();
        const incoming = Array.isArray(payload.entries) ? payload.entries : [];
        serialMonitorLatestId = Number.isFinite(payload.latest_id) ? payload.latest_id : serialMonitorLatestId;

        if (incoming.length) {
            if (isRefresh) {
                // On refresh, keep the latest 10 entries without wiping the buffer.
                serialMonitorEntries = serialMonitorEntries.concat(incoming).slice(-10);
            } else {
                // For incremental, append and keep the newest 10.
                const filtered = incoming.filter((entry) => {
                    const entryTime = Date.parse(entry.time_iso);
                    return !Number.isFinite(entryTime) || entryTime >= serialMonitorOpenedAt;
                });
                serialMonitorEntries = serialMonitorEntries.concat(filtered).slice(-10);
            }
            renderSerialMonitor();
        }
    } catch {
        if (!serialMonitorEntries.length) {
            renderSerialMonitor();
        }
    }
}

function formatNetworkDuration(seconds) {
    if (seconds === null || seconds === undefined || seconds === "") return "—";
    const duration = Number(seconds);
    if (!Number.isFinite(duration)) return "—";
    let remaining = Math.max(0, Math.floor(duration));
    const days = Math.floor(remaining / 86400);
    remaining %= 86400;
    const hours = Math.floor(remaining / 3600);
    remaining %= 3600;
    const minutes = Math.floor(remaining / 60);
    const secs = remaining % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours || days) parts.push(`${hours}h`);
    if (minutes || hours || days) parts.push(`${minutes}m`);
    parts.push(`${secs}s`);
    return parts.join(" ");
}

function formatNetworkTimestamp(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "Never";
}

function renderNetworkHistory(events) {
    const list = document.getElementById("network-event-history");
    if (!list) return;
    list.replaceChildren();
    if (!Array.isArray(events) || !events.length) {
        const empty = document.createElement("li");
        empty.textContent = "No network events recorded.";
        list.appendChild(empty);
        return;
    }
    for (const event of events) {
        const item = document.createElement("li");
        const timestamp = formatNetworkTimestamp(event.time_iso);
        item.textContent = event.event === "reconnect"
            ? `Reconnected · ${timestamp} · outage ${formatNetworkDuration(event.duration_seconds)}`
            : `Disconnected · ${timestamp}`;
        list.appendChild(item);
    }
}

async function loadDownloadFiles() {
    if (!downloadFileList || !downloadFileStatus) return;
    downloadFileStatus.textContent = "";
    try {
        const response = await fetch(`${API_BASE}/api/files`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not list files");
        renderDownloadFiles(result.files || []);
    } catch (error) {
        downloadFileList.textContent = "Files could not be loaded.";
        downloadFileStatus.textContent = error.message;
    }
}

function renderDownloadFiles(files) {
    downloadFileList.replaceChildren();
    if (!files.length) {
        downloadFileList.textContent = "No log or configuration files are available.";
        return;
    }
    const categories = new Map();
    for (const file of files) {
        if (!categories.has(file.category)) categories.set(file.category, []);
        categories.get(file.category).push(file);
    }
    for (const [category, categoryFiles] of categories) {
        const heading = document.createElement("h3");
        heading.className = "file-category";
        heading.textContent = category;
        downloadFileList.appendChild(heading);
        for (const file of categoryFiles) {
            const row = document.createElement("div");
            row.className = "download-file-item";
            const details = document.createElement("div");
            details.className = "download-file-details";
            const name = document.createElement("strong");
            name.textContent = file.name;
            const description = document.createElement("span");
            const size = Number.isFinite(Number(file.size)) ? ` · ${formatFileSize(Number(file.size))}` : "";
            description.textContent = `${file.description} · ${file.filename}${size}`;
            details.append(name, description);
            const button = document.createElement("button");
            button.type = "button";
            button.className = "ghost-btn download-file-button";
            button.innerHTML = '<img src="assets/icons/download.svg" alt="" aria-hidden="true"><span>Download</span>';
            button.setAttribute("aria-label", `Download ${file.filename}`);
            button.addEventListener("click", () => downloadDataFile(file, button));
            row.append(details, button);
            downloadFileList.appendChild(row);
        }
    }
}

function formatFileSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function downloadDataFile(file, button) {
    downloadFileStatus.textContent = `Preparing ${file.filename}…`;
    button.disabled = true;
    try {
        const response = await fetch(`${API_BASE}/api/files/${encodeURIComponent(file.id)}`, { cache: "no-store" });
        if (!response.ok) {
            let message = `Could not download ${file.filename}`;
            try {
                const result = await response.json();
                message = result.error || message;
            } catch {}
            throw new Error(message);
        }
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = file.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        downloadFileStatus.textContent = `Downloaded ${file.filename}.`;
    } catch (error) {
        downloadFileStatus.textContent = error.message;
    } finally {
        button.disabled = false;
    }
}

function renderRecentLogPreview(rows, header = []) {
    if (!recentLogBody) return;
    const sourceOnly = document.body.classList.contains("source-only-mode");
    const headerMap = new Map(header.map((name, index) => [name, index]));
    const recentHead = document.getElementById("recent-log-head");
    if (recentHead) {
        recentHead.innerHTML = "";
        (sourceOnly ? ["Time (ISO)", "Source (V)"] : ["Time (ISO)", "Battery (V)", "Source (V)", "Buck (V)", "Relay mode"]).forEach((label) => {
            const th = document.createElement("th"); th.textContent = label; recentHead.appendChild(th);
        });
    }
    recentLogBody.innerHTML = "";
    const previewRows = rows.slice(-8).reverse();
    previewRows.forEach((row) => {
        const tr = document.createElement("tr");
        const values = sourceOnly
            ? [getLogCell(row, headerMap, "time_iso", 0), getLogCell(row, headerMap, "source_voltage", 2)]
            : [getLogCell(row, headerMap, "time_iso", 0), getLogCell(row, headerMap, "batt_voltage", 1), getLogCell(row, headerMap, "source_voltage", 2), getLogCell(row, headerMap, "buck_voltage", 3), getLogCell(row, headerMap, "relay_mode", 4)];
        values.forEach((value) => {
            const td = document.createElement("td"); td.textContent = value; tr.appendChild(td);
        });
        recentLogBody.appendChild(tr);
    });
    if (!previewRows.length) recentLogBody.innerHTML = `<tr><td colspan="${sourceOnly ? 2 : 5}">No log data yet.</td></tr>`;
}

function renderLogChart(rows) {
    if (!logChart || !logChartCtx) return;
    logChartPoints = [];
    const chartTitle = document.querySelector(".log-chart-title");
    if (chartTitle) chartTitle.textContent = document.body.classList.contains("source-only-mode") ? "Source Voltage Trend" : "Voltage Trend";
    const ctx2d = logChartCtx;
    const scale = window.devicePixelRatio || 1;
    const width = logChart.width / scale;
    const height = logChart.height / scale;
    ctx2d.clearRect(0, 0, width, height);

    if (!rows.length) {
        ctx2d.fillStyle = palette.muted;
        ctx2d.font = "11px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText("No log data yet.", width / 2, height / 2);
        return;
    }

    const now = Date.now();
    const displayNow = now - LOG_DISPLAY_LAG_MS;
    const windowMs = LOG_WINDOW_MS + LOG_WINDOW_PAD_MS;

    const headerMap = new Map(logHeaderCache.map((name, index) => [name, index]));
    const parsed = rows.map((row) => ({
        t: Date.parse(getLogCell(row, headerMap, "time_iso", 0)),
        batt: Number.parseFloat(getLogCell(row, headerMap, "batt_voltage", 1)),
        source: Number.parseFloat(getLogCell(row, headerMap, "source_voltage", 2)),
        buck: Number.parseFloat(getLogCell(row, headerMap, "buck_voltage", 3))
    })).filter((d) => Number.isFinite(d.t));

    const rowsToChart = parsed.slice(-LOG_CHART_ROWS).filter((d) => d.t >= displayNow - windowMs && d.t <= displayNow);
    const chartSlice = rowsToChart;

    let minV = Infinity;
    let maxV = -Infinity;
    chartSlice.forEach((d) => {
        (document.body.classList.contains("source-only-mode") ? [d.source] : [d.batt, d.source, d.buck]).forEach((v) => {
            if (Number.isFinite(v)) {
                minV = Math.min(minV, v);
                maxV = Math.max(maxV, v);
            }
        });
    });

    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
        ctx2d.fillStyle = palette.muted;
        ctx2d.font = "11px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
        ctx2d.textAlign = "center";
        ctx2d.textBaseline = "middle";
        ctx2d.fillText("No voltage data yet.", width / 2, height / 2);
        return;
    }

    if (minV === maxV) {
        minV -= 0.5;
        maxV += 0.5;
    }

    const range = maxV - minV;
    const pad = range * 0.12;
    const yMin = 0;
    const yMax = Math.max(maxV + pad, 1);

    const left = 62;
    const right = 16;
    const top = 16;
    const bottom = 48;
    const plotW = Math.max(1, width - left - right);
    const plotH = Math.max(1, height - top - bottom);
    const ticks = 4;

    ctx2d.strokeStyle = palette.outline;
    ctx2d.lineWidth = 1;
    ctx2d.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    ctx2d.fillStyle = palette.muted;
    ctx2d.textAlign = "right";
    ctx2d.textBaseline = "middle";

    for (let i = 0; i < ticks; i++) {
        const t = i / (ticks - 1);
        const y = top + plotH * t;
        ctx2d.beginPath();
        ctx2d.moveTo(left, y);
        ctx2d.lineTo(width - right, y);
        ctx2d.stroke();
        const value = yMax - (yMax - yMin) * t;
        ctx2d.fillText(value.toFixed(3), left - 8, y);
    }

    ctx2d.save();
    ctx2d.translate(12, top + plotH / 2);
    ctx2d.rotate(-Math.PI / 2);
    ctx2d.fillStyle = palette.muted;
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "middle";
    ctx2d.fillText("Voltage (V)", 0, 0);
    ctx2d.restore();

    const visibleStart = displayNow - windowMs + LOG_LEFT_HIDE_MS;
    const visibleWindow = windowMs - LOG_LEFT_HIDE_MS;
    const toX = (t) => {
        const clamped = Math.max(visibleStart, Math.min(displayNow, t));
        return left + ((clamped - visibleStart) / visibleWindow) * plotW;
    };
    const toY = (v) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const tickY = top + plotH;
    ctx2d.strokeStyle = palette.outline;
    ctx2d.lineWidth = 1.2;
    ctx2d.fillStyle = palette.muted;
    ctx2d.font = "10px 'JetBrains Mono', ui-monospace, monospace";
    ctx2d.textBaseline = "top";
    const xTickCount = 5;
    for (let i = 0; i <= xTickCount; i++) {
        const ageMs = LOG_WINDOW_MS * (1 - i / xTickCount);
        const t = displayNow - ageMs;
        const x = toX(t);
        ctx2d.beginPath();
        ctx2d.moveTo(x, tickY);
        ctx2d.lineTo(x, tickY + 4);
        ctx2d.stroke();
        ctx2d.textAlign = i === 0 ? "left" : i === xTickCount ? "right" : "center";
        ctx2d.fillText(i === xTickCount ? "Now" : `${Math.round(ageMs / 60000)}m ago`, x, tickY + 7);
    }
    ctx2d.textAlign = "center";
    ctx2d.textBaseline = "bottom";
    ctx2d.fillText(`Time (last ${LOG_WINDOW_MS / 60000} minutes)`, left + plotW / 2, height - 3);

    if (0 >= yMin && 0 <= yMax) {
        const zeroY = toY(0);
        ctx2d.strokeStyle = palette.ink;
        ctx2d.lineWidth = 1.6;
        ctx2d.beginPath();
        ctx2d.moveTo(left, zeroY);
        ctx2d.lineTo(width - right, zeroY);
        ctx2d.stroke();
    }

    const noiseFloorY = toY(0.25);
    ctx2d.save();
    ctx2d.globalAlpha = 0.65;
    ctx2d.strokeStyle = palette.muted;
    ctx2d.lineWidth = 1;
    ctx2d.setLineDash([5, 4]);
    ctx2d.beginPath();
    ctx2d.moveTo(left, noiseFloorY);
    ctx2d.lineTo(width - right, noiseFloorY);
    ctx2d.stroke();
    ctx2d.setLineDash([]);
    ctx2d.fillStyle = palette.muted;
    ctx2d.font = "9px 'JetBrains Mono', ui-monospace, monospace";
    ctx2d.textAlign = "right";
    ctx2d.textBaseline = "bottom";
    ctx2d.fillText("0.25 V noise floor", width - right - 4, noiseFloorY - 3);
    ctx2d.restore();

    const drawSeries = (key, color) => {
        const points = chartSlice
            .filter((d) => Number.isFinite(d[key]))
            .map((d) => {
                const point = { x: toX(d.t), y: toY(d[key]), voltage: d[key], time: d.t, series: key };
                logChartPoints.push(point);
                return point;
            });
        if (!points.length) return;

        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 2;
        ctx2d.lineJoin = "round";
        ctx2d.lineCap = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length; i++) ctx2d.lineTo(points[i].x, points[i].y);
        ctx2d.stroke();
    };

    if (!document.body.classList.contains("source-only-mode")) drawSeries("batt", palette.warn);
    drawSeries("source", palette.accent);
    if (!document.body.classList.contains("source-only-mode")) drawSeries("buck", palette.good);

    ctx2d.strokeStyle = palette.ink;
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    ctx2d.moveTo(left, top);
    ctx2d.lineTo(left, top + plotH);
    ctx2d.stroke();
}

function updateLogChartTooltip(event) {
    if (!logChart || !logChartTooltip || !logChartPoints.length) return;
    const rect = logChart.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let nearest = null;
    let nearestDistance = 14;

    for (const point of logChartPoints) {
        const distance = Math.hypot(point.x - pointerX, point.y - pointerY);
        if (distance < nearestDistance) {
            nearest = point;
            nearestDistance = distance;
        }
    }

    if (!nearest) {
        logChartTooltip.classList.remove("visible");
        logChartTooltip.setAttribute("aria-hidden", "true");
        return;
    }

    const seriesNames = { batt: "Battery", source: "Source", buck: "Buck output" };
    const wrapRect = logChart.parentElement.getBoundingClientRect();
    const pointX = rect.left - wrapRect.left + nearest.x;
    const pointY = rect.top - wrapRect.top + nearest.y;
    logChartTooltip.textContent = `${seriesNames[nearest.series]}: ${nearest.voltage.toFixed(3)} V`;
    logChartTooltip.style.left = `${pointX}px`;
    logChartTooltip.style.top = `${pointY}px`;
    logChartTooltip.classList.toggle("below", pointY < 44);
    logChartTooltip.classList.add("visible");
    logChartTooltip.setAttribute("aria-hidden", "false");
}

async function loadLogTable() {
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        const res = await fetch(`${API_BASE}/api/logs?limit=${MAX_LOG_ROWS}`, { 
            cache: "no-store", 
            signal: controller.signal 
        });
        clearTimeout(timeoutId);
        if (!res.ok) throw new Error("log fetch failed");
        const payload = await res.json();
        const rows = Array.isArray(payload.rows) ? payload.rows.slice(-MAX_LOG_ROWS) : [];
        const header = Array.isArray(payload.header) ? payload.header : [];
        logHeaderCache = header;

        if (logLinesCount) {
            const count = Number.isFinite(payload.total_lines) ? payload.total_lines : rows.length;
            logLinesCount.textContent = `${count.toLocaleString()} / 1 000 000 log lines used`;
        }

        renderRecentLogPreview(rows, logHeaderCache);
        logRowsCache = rows;
        renderLogChart(rows);
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Log fetch timed out after 10 seconds');
        } else {
            console.log('Log fetch error:', err.message);
        }
        // Preserve the last successful log view when the fetch fails.
        renderRecentLogPreview(logRowsCache, logHeaderCache);
        renderLogChart(logRowsCache);

        if (logLinesCount) {
            logLinesCount.textContent = 'Error loading logs';
        }
    }
}

async function updateData() {
    try {
        const res = await fetch("data/status.json", { cache: "no-store" });
        const d = await res.json();
        targetStatus = normalizeStatus(d);
        availableKeys = new Set(Object.keys(d || {}));
        const sourceOnlyMode = !settingsState.force_simulation_enabled
            && (settingsState.source_voltage_only || d.telemetry_mode === "source_only");
        document.body.classList.toggle("source-only-mode", sourceOnlyMode);
        const displayMetric = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = Number.isFinite(Number(value)) ? `${Number(value).toFixed(2)} V` : "--.-- V"; };
        displayMetric("source-voltage", d.source_voltage);
        displayMetric("battery-voltage", d.batt_voltage);
        displayMetric("buck-voltage", d.buck_voltage);
        const sourceRange = document.getElementById("source-range");
        if (sourceRange) {
            const min = Number.isFinite(d.source_expected_min_v) ? d.source_expected_min_v : thresholds.sourceExpectedMinV;
            const max = Number.isFinite(d.source_expected_max_v) ? d.source_expected_max_v : thresholds.sourceExpectedMaxV;
            sourceRange.textContent = `Expected ${min.toFixed(1)}–${max.toFixed(1)} V`;
        }
        const modeLabel = document.getElementById("telemetry-mode-label");
        if (modeLabel) modeLabel.textContent = settingsState.force_simulation_enabled
            ? "Forced simulation"
            : sourceOnlyMode ? "Source only" : "Full telemetry";
        const telemetryTime = document.getElementById("telemetry-time");
        if (telemetryTime) telemetryTime.textContent = d.time ? new Date(d.time).toLocaleString() : "Waiting for reader";

        if (statusSource) {
            const srcV = Number.isFinite(d.source_voltage) ? d.source_voltage : status.source_voltage;
            const expMin = Number.isFinite(d.source_expected_min_v) ? d.source_expected_min_v : thresholds.sourceExpectedMinV;
            const expMax = Number.isFinite(d.source_expected_max_v) ? d.source_expected_max_v : thresholds.sourceExpectedMaxV;
            let level = " danger";
            if (Number.isFinite(srcV) && srcV > 0.1) {
                if (srcV > expMax) {
                    level = " warn";
                } else if (srcV >= expMin) {
                    level = " on";
                } else {
                    level = " danger";
                }
            }
            applyStatusLevel(statusSource, level);
            const sourceTip = `Source ${srcV.toFixed(2)} V (target ${expMin.toFixed(1)}-${expMax.toFixed(1)} V)`;
            const sourceItem = statusSource.closest(".status-item");
            if (sourceItem) {
                sourceItem.setAttribute("data-tooltip", sourceTip);
                sourceItem.setAttribute("aria-label", sourceTip);
            }
        }
        if (statusBattery) {
            const battV = Number.isFinite(d.batt_voltage) ? d.batt_voltage : status.batt_voltage;
            const startV = Number.isFinite(d.batt_start_v) ? d.batt_start_v : thresholds.battStartV;
            const stopV = Number.isFinite(d.batt_stop_v) ? d.batt_stop_v : thresholds.battStopV;
            let level = " danger";
            if (Number.isFinite(battV)) {
                level = battV >= startV ? " on" : battV >= stopV ? " warn" : " danger";
            }
            applyStatusLevel(statusBattery, level);
            const battTip = `Battery ${battV.toFixed(2)} V (start ${startV.toFixed(1)} V, stop ${stopV.toFixed(1)} V)`;
            const battItem = statusBattery.closest(".status-item");
            if (battItem) {
                battItem.setAttribute("data-tooltip", battTip);
                battItem.setAttribute("aria-label", battTip);
            }
        }
        if (statusArduino) {
            const isConnected = Boolean(d.arduino_connected);
            const level = isConnected ? " on" : " danger";
            applyStatusLevel(statusArduino, level);
            const tip = isConnected ? "Arduino connected (serial)" : "Simulator mode";
            const arduinoItem = statusArduino.closest(".status-item");
            if (arduinoItem) {
                arduinoItem.setAttribute("data-tooltip", tip);
                arduinoItem.setAttribute("aria-label", tip);
            }
        }
        if (statusBuck) {
            const buckV = Number.isFinite(d.buck_voltage) ? d.buck_voltage : status.buck_voltage;
            const expMin = Number.isFinite(d.source_expected_min_v) ? d.source_expected_min_v : thresholds.sourceExpectedMinV;
            const expMax = Number.isFinite(d.source_expected_max_v) ? d.source_expected_max_v : thresholds.sourceExpectedMaxV;
            let level = " danger";
            if (Number.isFinite(buckV) && buckV > 0.1) {
                if (buckV > expMax) {
                    level = " warn";
                } else if (buckV >= expMin) {
                    level = " on";
                } else {
                    level = " danger";
                }
            }
            applyStatusLevel(statusBuck, level);
            const buckTip = `Buck ${buckV.toFixed(2)} V (target ${expMin.toFixed(1)}-${expMax.toFixed(1)} V)`;
            const buckItem = statusBuck.closest(".status-item");
            if (buckItem) {
                buckItem.setAttribute("data-tooltip", buckTip);
                buckItem.setAttribute("aria-label", buckTip);
            }
        }
    } catch (err) {
        // keep previous status if fetch fails
    }
}

function draw() {
    if (!canvas || !ctx) return;
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, width, height);

    const isNarrow = width < 520;
    const pad = isNarrow ? 16 : 24;
    const gap = isNarrow ? 10 : 14;
    const cardH = isNarrow ? 58 : 64;

    const getSourceLevel = () => {
        if (!Number.isFinite(status.source_voltage) || status.source_voltage <= 0.1) {
            return "danger";
        }
        if (status.source_voltage > thresholds.sourceExpectedMaxV) {
            return "warn";
        }
        if (status.source_voltage >= thresholds.sourceExpectedMinV) {
            return "good";
        }
        return "danger";
    };

    const getBatteryLevel = () => {
        if (!Number.isFinite(status.batt_voltage)) {
            return "danger";
        }
        if (status.batt_voltage >= thresholds.battStartV) {
            return "good";
        }
        if (status.batt_voltage >= thresholds.battStopV) {
            return "warn";
        }
        return "danger";
    };

    const levelToColor = (level) => {
        if (level === "good") return palette.good;
        if (level === "warn") return palette.warn;
        if (level === "danger") return palette.danger;
        return palette.ink;
    };

    const blocks = [];
    const sourceOnlyMode = document.body.classList.contains("source-only-mode");
    if (!sourceOnlyMode && (availableKeys.has("batt_voltage") || availableKeys.has("batt_percent"))) {
        blocks.push({
            label: "Battery",
            value: `${status.batt_voltage.toFixed(2)} V\n${status.batt_percent.toFixed(1)} %`,
            level: getBatteryLevel()
        });
    }
    if (availableKeys.has("source_voltage")) {
        blocks.push({
            label: "Source",
            value: `${status.source_voltage.toFixed(2)} V`,
            level: getSourceLevel()
        });
    }
    if (!sourceOnlyMode && availableKeys.has("buck_voltage")) {
        const targetBuck = Number.isFinite(settingsState.target_buck_voltage)
            ? settingsState.target_buck_voltage
            : settingsDefaults.target_buck_voltage;
        const buckDelta = Math.abs(status.buck_voltage - targetBuck);
        blocks.push({
            label: "Buck Output",
            value: `${status.buck_voltage.toFixed(2)} V`,
            level: buckDelta <= 0.5 ? "good" : "danger"
        });
    }
    if (!sourceOnlyMode && (availableKeys.has("use_source") || availableKeys.has("system_on"))) {
        const isUsingSource = Boolean(status.use_source);
        blocks.push({
            label: "Power Mode",
            value: `${isUsingSource ? "SOURCE" : "BATT"}`,
            level: isUsingSource ? "warn" : "good"
        });
    }
    if (!sourceOnlyMode && availableKeys.has("rpm")) {
        blocks.push({
            label: "RPM",
            value: `${Math.round(status.rpm)}`,
            level: "good"
        });
    }
    if (!sourceOnlyMode && availableKeys.has("current")) {
        blocks.push({
            label: "Current",
            value: `${status.current.toFixed(2)} A`,
            level: status.current < 10 ? "good" : "danger"
        });
    }
    if (!sourceOnlyMode && availableKeys.has("dump_load")) {
        blocks.push({
            label: "Dump Load",
            value: `${status.dump_load ? "ON" : "OFF"}`,
            level: status.dump_load ? "danger" : "good"
        });
    }

    let centerX = width / 2;
    let centerY = height * (isNarrow ? 0.28 : 0.45);

    const positions = [];
    if (blocks.length > 0) {
        if (isNarrow) {
            const cols = 2;
            const cardW = Math.min(160, Math.floor((width - pad * 2 - gap) / cols));
            const rows = Math.ceil(blocks.length / cols);
            const totalH = rows * cardH + (rows - 1) * gap;
            let startY = Math.max(height * 0.45, height - totalH - pad);
            if (startY + totalH + pad > height) {
                startY = height - totalH - pad;
            }
            startY = Math.max(startY, pad);
            const totalW = cols * cardW + (cols - 1) * gap;
            const startX = (width - totalW) / 2;
            for (let i = 0; i < blocks.length; i++) {
                const row = Math.floor(i / cols);
                const col = i % cols;
                positions.push({
                    ...blocks[i],
                    x: startX + col * (cardW + gap),
                    y: startY + row * (cardH + gap),
                    w: cardW,
                    h: cardH
                });
            }
            const topOfCards = startY - 50;
            centerY = Math.max(120, Math.min(height * 0.28, topOfCards));
        } else {
            const topCount = Math.ceil(blocks.length / 2);
            const bottomCount = blocks.length - topCount;

            const layoutRow = (count, y) => {
                if (count === 0) return [];
                const maxCardW = 180;
                const cardW = Math.min(maxCardW, Math.floor((width - pad * 2 - gap * (count - 1)) / count));
                const rowW = count * cardW + (count - 1) * gap;
                const startX = (width - rowW) / 2;
                return Array.from({ length: count }, (_, i) => ({
                    x: startX + i * (cardW + gap),
                    y,
                    w: cardW,
                    h: cardH
                }));
            };

            const topY = pad;
            const bottomY = height - pad - cardH;
            const topPos = layoutRow(topCount, topY);
            const bottomPos = layoutRow(bottomCount, bottomY);

            topPos.forEach((pos, i) => positions.push({ ...blocks[i], ...pos }));
            bottomPos.forEach((pos, i) => positions.push({ ...blocks[topCount + i], ...pos }));

            const minY = topY + cardH + 50;
            const maxY = bottomY - 50;
            centerY = Math.min(Math.max(height * 0.45, minY), maxY);
        }
    }

    ctx.font = "600 12px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    positions.forEach(b => {
        const cardX = b.x;
        const cardY = b.y;
        const cardW = b.w;
        const cardHeight = b.h;
        ctx.fillStyle = palette.panel;
        roundRect(cardX, cardY, cardW, cardHeight, 12);
        ctx.fill();
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const lines = b.value.split("\n");
        ctx.font = `600 ${isNarrow ? 12 : 13}px 'JetBrains Mono', ui-monospace, monospace`;
        lines.forEach((line, i) => {
            ctx.fillStyle = levelToColor(b.level);
            ctx.fillText(line, cardX + cardW / 2, cardY + cardHeight / 2 + 6 + i * 15 - (lines.length - 1) * 8);
        });
        ctx.font = `600 ${isNarrow ? 10 : 11}px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif`;
        ctx.fillStyle = palette.muted;
        ctx.fillText(b.label, cardX + cardW / 2, cardY + 14);
    });
}

function renderLoop() {
    const now = performance.now();
    stepStatus(now - lastFrame);
    lastFrame = now;
    if (turbine) {
        const isSimulatorEnabled = Boolean(settingsState.sim_fallback_enabled || settingsState.force_simulation_enabled);
        const seconds = 1.25;
        turbine.style.setProperty("--spin", `${seconds}s`);
        if (turbineLabel) {
            turbineLabel.classList.toggle("show", isSimulatorEnabled);
        }
    }
    draw();
    requestAnimationFrame(renderLoop);
}

// Event listeners
if (logChart) {
    logChart.addEventListener("pointermove", updateLogChartTooltip);
    logChart.addEventListener("pointerleave", () => {
        logChartTooltip?.classList.remove("visible");
        logChartTooltip?.setAttribute("aria-hidden", "true");
    });
}
if (openSettings) openSettings.addEventListener("click", () => { fillSettingsForm(); openSettingsModal(); });
if (openLogs) {
    openLogs.addEventListener("click", openLogsModal);
}
document.getElementById("open-logs-card")?.addEventListener("click", openLogsModal);
if (closeLogs) closeLogs.addEventListener("click", closeLogsModal);
if (logsBackdrop) logsBackdrop.addEventListener("click", (e) => { if (e.target === logsBackdrop) closeLogsModal(); });
if (toggleSerialMonitorBtn) {
    toggleSerialMonitorBtn.addEventListener("click", () => {
        if (serialMonitorBackdrop?.classList.contains("open")) return;
        openSerialMonitorModal();
    });
}
if (closeSerialMonitor) closeSerialMonitor.addEventListener("click", closeSerialMonitorModal);
if (serialMonitorBackdrop) serialMonitorBackdrop.addEventListener("click", (e) => { if (e.target === serialMonitorBackdrop) closeSerialMonitorModal(); });
if (refreshLogBtn) refreshLogBtn.addEventListener("click", () => {
    loadLogTable();
});
if (refreshSerialBtn) refreshSerialBtn.addEventListener("click", () => {
    loadSerialMonitor(true);
});
if (closeSettings) closeSettings.addEventListener("click", closeSettingsModal);
if (settingsBackdrop) settingsBackdrop.addEventListener("click", (e) => { if (e.target === settingsBackdrop) closeSettingsModal(); });

if (inputSimFallback) {
    inputSimFallback.addEventListener("change", () => {
        if (inputSimFallback.checked) {
            if (inputSourceVoltageOnly) inputSourceVoltageOnly.checked = false;
            if (inputForceSimulation) inputForceSimulation.checked = false;
        }
    });
}
if (inputForceSimulation) {
    inputForceSimulation.addEventListener("change", () => {
        if (inputForceSimulation.checked) {
            if (inputSourceVoltageOnly) inputSourceVoltageOnly.checked = false;
            if (inputSimFallback) inputSimFallback.checked = false;
        }
    });
}
if (inputSourceVoltageOnly) {
    inputSourceVoltageOnly.addEventListener("change", () => {
        if (inputSourceVoltageOnly.checked) {
            if (inputSimFallback) inputSimFallback.checked = false;
            if (inputForceSimulation) inputForceSimulation.checked = false;
        }
    });
}

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {

        const next = {
            source_voltage_only: Boolean(inputSourceVoltageOnly?.checked),
            batt_full_voltage: parseNum(inputPackFull?.value, settingsState.batt_full_voltage),
            batt_empty_voltage: parseNum(inputPackEmpty?.value, settingsState.batt_empty_voltage),
            batt_on_percent: parseNum(inputOnPercent?.value, settingsState.batt_on_percent),
            batt_off_percent: parseNum(inputOffPercent?.value, settingsState.batt_off_percent),
            sim_fallback_enabled: Boolean(inputSimFallback?.checked),
            force_simulation_enabled: Boolean(inputForceSimulation?.checked)
        };

        const enablingSim = (next.sim_fallback_enabled && !settingsState.sim_fallback_enabled)
            || (next.force_simulation_enabled && !settingsState.force_simulation_enabled);

        if (enablingSim) {
            window._pendingSettings = next;
            openConfirmSim();
            return;
        }

        applySettings(next);
        writeSettingsToFile()
            .then(() => { updateData(); closeSettingsModal(); })
            .catch(() => alert("Unable to save settings."));
    });
}

function openConfirm() { if (confirmBackdrop) { confirmBackdrop.classList.add("open"); confirmBackdrop.setAttribute("aria-hidden", "false"); } }
function closeConfirm() { if (confirmBackdrop) { confirmBackdrop.classList.remove("open"); confirmBackdrop.setAttribute("aria-hidden", "true"); } }
function openConfirmClearLogs() { if (confirmClearLogs) { confirmClearLogs.classList.add("open"); confirmClearLogs.setAttribute("aria-hidden", "false"); } }
function closeConfirmClearLogs() { if (confirmClearLogs) { confirmClearLogs.classList.remove("open"); confirmClearLogs.setAttribute("aria-hidden", "true"); } }
function openConfirmResetAll() { if (confirmResetAll) { confirmResetAll.classList.add("open"); confirmResetAll.setAttribute("aria-hidden", "false"); } }
function closeConfirmResetAll() { if (confirmResetAll) { confirmResetAll.classList.remove("open"); confirmResetAll.setAttribute("aria-hidden", "true"); } }
function openConfirmSim() {
    if (confirmSim) {
        confirmSim.classList.add("open");
        confirmSim.setAttribute("aria-hidden", "false");
    }
}

function closeConfirmSim() {
    if (confirmSim) {
        confirmSim.classList.remove("open");
        confirmSim.setAttribute("aria-hidden", "true");
    }
}

if (resetSettingsBtn) resetSettingsBtn.addEventListener("click", openConfirm);
if (resetAllBtn) resetAllBtn.addEventListener("click", openConfirmResetAll);
if (clearLogs) clearLogs.addEventListener("click", openConfirmClearLogs);
if (confirmCancel) confirmCancel.addEventListener("click", closeConfirm);
if (confirmBackdrop) confirmBackdrop.addEventListener("click", (e) => { if (e.target === confirmBackdrop) closeConfirm(); });
if (confirmClearLogs) confirmClearLogs.addEventListener("click", (e) => { if (e.target === confirmClearLogs) closeConfirmClearLogs(); });
if (confirmResetAll) confirmResetAll.addEventListener("click", (e) => { if (e.target === confirmResetAll) closeConfirmResetAll(); });

if (confirmReset) {
    confirmReset.addEventListener("click", () => {
        applySettings(settingsDefaults);
        fillSettingsForm();
        writeSettingsToFile().then(() => { updateData(); closeConfirm(); closeSettingsModal(); }).catch(() => alert("Unable to reset settings."));
    });
}

async function postAction(path) {
    const res = await fetch(`${API_BASE}${path}`, { method: "POST" });
    if (!res.ok) throw new Error("Request failed");
}

if (rebootButton) {
    rebootButton.addEventListener("click", async () => {
        if (!window.confirm("Reboot the Raspberry Pi now? The dashboard will be unavailable briefly.")) return;
        rebootButton.disabled = true;
        if (actionMessage) {
            actionMessage.hidden = false;
            actionMessage.removeAttribute("title");
            actionMessage.textContent = "Sending reboot command...";
        }
        try {
            const response = await fetch(`${API_BASE}/api/reboot`, { method: "POST" });
            const result = await response.json();
            if (!response.ok || !result.ok) throw new Error(result.error || "Reboot failed.");
            if (actionMessage) actionMessage.textContent = "Rebooting Pi...";
        } catch (error) {
            if (actionMessage) {
                actionMessage.textContent = "Reboot failed.";
                actionMessage.title = error.message;
            }
            rebootButton.disabled = false;
        }
    });
}

function closeUpdateModal() {
    if (updateRunning) return;
    document.body.classList.remove("update-open");
    if (updateBackdrop) {
        updateBackdrop.classList.remove("open");
        updateBackdrop.setAttribute("aria-hidden", "true");
    }
    if (updatePollTimer) clearInterval(updatePollTimer);
    updatePollTimer = null;
    if (updateAutoCloseTimer) clearTimeout(updateAutoCloseTimer);
    updateAutoCloseTimer = null;
}

async function respondToAptUpgrade(approve) {
    const buttons = document.querySelectorAll(".apt-upgrade-actions button");
    buttons.forEach((button) => { button.disabled = true; });
    try {
        const response = await fetch(`${API_BASE}/api/update/apt-upgrade`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ approve })
        });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not submit the system upgrade choice");
        aptUpgradeDialog.hidden = true;
        updateStatus.textContent = approve
            ? "Starting system package upgrade..."
            : "Continuing without system package upgrades...";
    } catch (error) {
        aptUpgradeMessage.textContent = error.message;
    } finally {
        buttons.forEach((button) => { button.disabled = false; });
    }
}

function closeDocumentModal() {
    documentRequestId += 1;
    documentBackdrop?.classList.remove("open");
    documentBackdrop?.setAttribute("aria-hidden", "true");
    unlockPageScroll();
}

function appendMarkdownInline(parent, source) {
    const tokenPattern = /(!?\[[^\]]*\]\([^)]*\)|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g;
    let cursor = 0;
    for (const match of source.matchAll(tokenPattern)) {
        const token = match[0];
        const index = match.index;
        if (index > cursor) parent.append(document.createTextNode(source.slice(cursor, index)));

        const imageMatch = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        const linkMatch = token.match(/^\[([^\]]*)\]\(([^)]+)\)$/);
        if (imageMatch) {
            if (!/^(javascript|data|vbscript):/i.test(imageMatch[2].trim())) {
                const image = document.createElement("img");
                image.alt = imageMatch[1];
                image.src = imageMatch[2];
                parent.append(image);
            } else {
                parent.append(document.createTextNode(imageMatch[1]));
            }
        } else if (linkMatch) {
            const destination = linkMatch[2].trim();
            if (!/^(javascript|data|vbscript|file):/i.test(destination) && !destination.startsWith("//")) {
                const link = document.createElement("a");
                link.href = destination;
                link.textContent = linkMatch[1];
                if (/^https?:/i.test(link.href)) {
                    link.target = "_blank";
                    link.rel = "noopener noreferrer";
                }
                parent.append(link);
            } else {
                parent.append(document.createTextNode(linkMatch[1]));
            }
        } else if (token.startsWith("**")) {
            const strong = document.createElement("strong");
            strong.textContent = token.slice(2, -2);
            parent.append(strong);
        } else if (token.startsWith("`")) {
            const code = document.createElement("code");
            code.textContent = token.slice(1, -1);
            parent.append(code);
        } else {
            const emphasis = document.createElement("em");
            emphasis.textContent = token.slice(1, -1);
            parent.append(emphasis);
        }
        cursor = index + token.length;
    }
    if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function appendSafeHtmlBlock(parent, source) {
    const parsed = new DOMParser().parseFromString(source, "text/html");
    const allowed = new Set(["P", "H1", "IMG", "BR", "STRONG", "EM"]);
    const copyNode = (node) => {
        if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || "");
        if (node.nodeType !== Node.ELEMENT_NODE || !allowed.has(node.tagName)) return null;
        const copy = document.createElement(node.tagName.toLowerCase());
        if (["P", "H1"].includes(node.tagName) && node.getAttribute("align") === "center") {
            copy.style.textAlign = "center";
        }
        if (node.tagName === "IMG") {
            const src = node.getAttribute("src") || "";
            if (/^(https?:|assets\/)/i.test(src)) copy.setAttribute("src", src);
            for (const name of ["alt", "width", "height"]) {
                const value = node.getAttribute(name);
                if (value) copy.setAttribute(name, value);
            }
        }
        for (const child of node.childNodes) {
            const safeChild = copyNode(child);
            if (safeChild) copy.append(safeChild);
        }
        return copy;
    };
    for (const node of parsed.body.childNodes) {
        const safeNode = copyNode(node);
        if (safeNode) parent.append(safeNode);
    }
}

function renderMarkdown(source) {
    documentContent.replaceChildren();
    const lines = source.replace(/\r/g, "").split("\n");
    const isTableSeparator = (line) => /^\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?$/.test(line.trim());
    const isBlockStart = (line, next = "") => /^(#{1,6}\s|\s*```|\s*[-*+]\s|\s*\d+\.\s|\s*([-*_]\s*){3,}$|\s*<\/?(p|h1)\b)/.test(line)
        || (line.includes("|") && isTableSeparator(next));
    const splitCells = (line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());

    for (let index = 0; index < lines.length;) {
        const line = lines[index];
        const trimmed = line.trim();
        if (!trimmed) { index += 1; continue; }

        if (/^<(p|h1)\b/i.test(trimmed)) {
            const tag = trimmed.startsWith("<p") ? "p" : "h1";
            const htmlLines = [line];
            index += 1;
            while (index < lines.length && !htmlLines.join("\n").toLowerCase().includes(`</${tag}>`)) {
                htmlLines.push(lines[index++]);
            }
            appendSafeHtmlBlock(documentContent, htmlLines.join("\n"));
            continue;
        }

        const fence = trimmed.match(/^```\s*([\w+-]*)/);
        if (fence) {
            const codeLines = [];
            index += 1;
            while (index < lines.length && !/^\s*```/.test(lines[index])) codeLines.push(lines[index++]);
            if (index < lines.length) index += 1;
            const pre = document.createElement("pre");
            const code = document.createElement("code");
            if (fence[1]) code.className = `language-${fence[1]}`;
            code.textContent = codeLines.join("\n");
            pre.append(code);
            documentContent.append(pre);
            continue;
        }

        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            const element = document.createElement(`h${heading[1].length}`);
            appendMarkdownInline(element, heading[2]);
            documentContent.append(element);
            index += 1;
            continue;
        }

        if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
            const table = document.createElement("table");
            const head = document.createElement("thead");
            const headerRow = document.createElement("tr");
            for (const cellText of splitCells(line)) {
                const cell = document.createElement("th");
                appendMarkdownInline(cell, cellText);
                headerRow.append(cell);
            }
            head.append(headerRow);
            table.append(head);
            const body = document.createElement("tbody");
            index += 2;
            while (index < lines.length && lines[index].includes("|")) {
                const row = document.createElement("tr");
                for (const cellText of splitCells(lines[index])) {
                    const cell = document.createElement("td");
                    appendMarkdownInline(cell, cellText);
                    row.append(cell);
                }
                body.append(row);
                index += 1;
            }
            table.append(body);
            documentContent.append(table);
            continue;
        }

        const listMatch = trimmed.match(/^([-*+]|\d+\.)\s+(.*)$/);
        if (listMatch) {
            const ordered = /^\d/.test(listMatch[1]);
            const list = document.createElement(ordered ? "ol" : "ul");
            while (index < lines.length) {
                const itemMatch = lines[index].trim().match(/^([-*+]|\d+\.)\s+(.*)$/);
                if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;
                const item = document.createElement("li");
                appendMarkdownInline(item, itemMatch[2]);
                list.append(item);
                index += 1;
            }
            documentContent.append(list);
            continue;
        }

        if (/^([-*_]\s*){3,}$/.test(trimmed)) {
            documentContent.append(document.createElement("hr"));
            index += 1;
            continue;
        }

        const paragraph = document.createElement("p");
        const paragraphLines = [];
        while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index].trim(), lines[index + 1] || "")) {
            paragraphLines.push(lines[index++].trim());
        }
        appendMarkdownInline(paragraph, paragraphLines.join(" "));
        documentContent.append(paragraph);
    }
}

async function openDocumentModal(fileName, title, intro) {
    const documentIntro = document.getElementById("document-intro");
    if (!documentBackdrop || !documentTitle || !documentContent) return;
    const requestId = ++documentRequestId;
    documentTitle.textContent = title;
    if (documentIntro) documentIntro.textContent = intro;
    documentContent.textContent = "Loading document…";
    if (!documentBackdrop.classList.contains("open")) lockPageScroll();
    documentBackdrop.classList.add("open");
    documentBackdrop.setAttribute("aria-hidden", "false");
    document.getElementById("close-document")?.focus();
    try {
        const response = await fetch(fileName, { cache: "no-store" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const contents = await response.text();
        if (requestId === documentRequestId) renderMarkdown(contents);
    } catch (error) {
        if (requestId === documentRequestId) {
            documentContent.textContent = `Unable to load ${title}: ${error.message}`;
        }
    }
}

async function loadRepoFiles() {
    if (!repoFileStatus || !repoTree || !repoAssociations) return;
    repoFileStatus.textContent = "Reading repository tree…";
    try {
        const response = await fetch(`${API_BASE}/api/repo-files`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error(result.error || "Could not read repository files");

        repoTree.textContent = result.tree || "(Repository is empty)";
        repoAssociations.replaceChildren();
        for (const item of result.associations || []) {
            const row = document.createElement("div");
            row.className = "repo-association";
            const source = document.createElement("strong");
            source.textContent = item.source;
            const state = item.generated ? "generated" : item.installed ? "installed" : "not installed";
            row.append(source, document.createTextNode(` → ${item.target} (${state})`));
            repoAssociations.append(row);
        }
        repoFileStatus.textContent = `${result.file_count} files · ${result.root}`;
    } catch (error) {
        repoTree.textContent = "Repository tree is unavailable.";
        repoAssociations.replaceChildren();
        repoFileStatus.textContent = error.message;
    }
}

async function refreshUpdateStatus() {
    try {
        const response = await fetch(`${API_BASE}/api/update`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Unable to read update status");
        const wasRunning = updateRunning;
        updateRunning = data.status === "Starting SkyChopper update..."
            || data.status === "Updating SkyChopper..."
            || data.status.startsWith("APT upgrade available:")
            || data.status === "Upgrading system packages...";
        const closeUpdateButton = document.getElementById("close-update");
        const openUpdateButton = document.getElementById("open-update");
        if (closeUpdateButton) closeUpdateButton.disabled = updateRunning;
        if (openUpdateButton) openUpdateButton.disabled = updateRunning;
        updateStatus.textContent = data.status;
        updateOutput.textContent = data.output || "No updater output yet.";
        updateOutput.scrollTop = updateOutput.scrollHeight;
        if (actionMessage) {
            actionMessage.hidden = false;
            actionMessage.removeAttribute("title");
            actionMessage.textContent = data.status;
        }
        if (updateRunning && !updatePollTimer) updatePollTimer = setInterval(refreshUpdateStatus, 2000);
        if (data.status.startsWith("APT upgrade available:") && !updateUpgradePromptShown) {
            updateUpgradePromptShown = true;
            const packageCount = data.status.match(/APT upgrade available: (\d+)/)?.[1] || "some";
            aptUpgradeMessage.textContent = `${packageCount} system package(s) can be upgraded. Upgrade output will appear in this progress terminal.`;
            aptUpgradeDialog.hidden = false;
        }
        if (data.done) {
            updateRunning = false;
            if (closeUpdateButton) closeUpdateButton.disabled = false;
            if (openUpdateButton) openUpdateButton.disabled = false;
            if (updatePollTimer) clearInterval(updatePollTimer);
            updatePollTimer = null;
            if (wasRunning && !updateAutoCloseTimer) {
                const updateSucceeded = data.status === "Update complete.";
                if (updateSucceeded) updateStatus.textContent = "Update complete. Reloading the dashboard…";
                updateAutoCloseTimer = setTimeout(() => {
                    updateAutoCloseTimer = null;
                    if (updateSucceeded) window.location.reload();
                    else closeUpdateModal();
                }, 3000);
            }
        }
    } catch (error) {
        updateStatus.textContent = "Waiting for SkyChopper to reconnect...";
        if (actionMessage) {
            actionMessage.hidden = false;
            actionMessage.textContent = "Update status unavailable.";
            actionMessage.title = error.message;
        }
    }
}

function setNetworkText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || "Unavailable";
}

async function refreshNetworkStats() {
    try {
        const response = await fetch(`${API_BASE}/api/network`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Network request failed");

        const wifi = data.wifi || {};
        const quality = Number.isFinite(Number(wifi.quality)) ? Number(wifi.quality) : 0;
        const connected = wifi.state === "Connected";
        const dbm = Number(wifi.dbm);
        const hasDbm = wifi.dbm !== null && Number.isFinite(dbm);
        const dbmThresholds = [-30, -60, -70, -80];
        const activeBars = !connected
            ? 0
            : hasDbm
                ? dbmThresholds.filter((threshold) => dbm >= threshold).length
                : Math.ceil(Math.max(0, Math.min(100, quality)) / 25);
        const signalClass = activeBars === 0 ? "signal-none"
            : activeBars === 1 ? "signal-weak"
                : activeBars === 2 ? "signal-fair"
                    : activeBars === 3 ? "signal-good" : "signal-strong";
        if (networkState) {
            networkState.classList.remove("signal-none", "signal-weak", "signal-fair", "signal-good", "signal-strong");
            networkState.classList.add(signalClass);
        }
        const wifiIcon = document.querySelector(".wifi-status-icon");
        if (wifiIcon) {
            wifiIcon.classList.remove("signal-none", "signal-weak", "signal-fair", "signal-good", "signal-strong");
            wifiIcon.classList.add(signalClass);
        }
        document.querySelectorAll(".wifi-status-icon .wifi-segment").forEach((segment, index) => {
            const active = connected && (hasDbm
                ? dbm >= dbmThresholds[index]
                : index >= 4 - activeBars);
            segment.classList.toggle("active", active);
        });

        const ethernetInterfaces = (data.interfaces || []).filter((item) => /^(?:eth|en)/i.test(item.name));
        const ethernetStatus = ethernetInterfaces.length
            ? `Connected · ${ethernetInterfaces.map((item) => item.name).join(", ")}`
            : "No active Ethernet connection";
        setNetworkText("network-ethernet-status", ethernetStatus);
        document.querySelector(".ethernet-icon")?.classList.toggle("active", ethernetInterfaces.length > 0);
        setNetworkText("network-wifi-state", wifi.state);
        setNetworkText("network-ssid", wifi.ssid);
        setNetworkText("network-signal", connected && quality > 0 ? `${wifi.signal} (${Math.round(quality)}%)` : wifi.signal);
        setNetworkText("network-wifi-interface", wifi.interface);
        setNetworkText("network-wifi-link", wifi.state);
        setNetworkText("network-frequency", wifi.frequency);
        setNetworkText("network-tx-rate", wifi.txRate);
        setNetworkText("system-primary-ip", data.primaryIp);
        setNetworkText("system-local-hostname", data.localHostname);
        setNetworkText("network-traffic", data.networkTraffic);
        const monitoring = data.monitoring || {};
        setNetworkText("network-monitor-state", monitoring.connected ? "Connected (IPv4)" : "Disconnected");
        setNetworkText("network-disconnect-count", String(monitoring.disconnectCount ?? 0));
        setNetworkText("network-last-disconnect", formatNetworkTimestamp(monitoring.lastDisconnectAt));
        setNetworkText("network-last-reconnect", formatNetworkTimestamp(monitoring.lastReconnectAt));
        const outageSeconds = monitoring.currentDowntimeSeconds ?? monitoring.lastDowntimeSeconds;
        setNetworkText("network-current-downtime", formatNetworkDuration(outageSeconds));
        setNetworkText("network-average-downtime", formatNetworkDuration(monitoring.averageDowntimeSeconds));
        setNetworkText("network-average-interval", formatNetworkDuration(monitoring.averageDisconnectIntervalSeconds));
        renderNetworkHistory(monitoring.recentEvents);
        setNetworkText("network-refreshed", `Updated ${new Date().toLocaleTimeString()}`);
    } catch (error) {
        if (networkState) {
            networkState.classList.remove("signal-weak", "signal-fair", "signal-good", "signal-strong");
            networkState.classList.add("signal-none");
        }
        document.querySelector(".ethernet-icon")?.classList.remove("active");
        setNetworkText("network-wifi-state", "Unavailable");
        ["network-ethernet-status", "network-ssid", "network-signal", "network-wifi-interface", "network-wifi-link",
            "network-frequency", "network-tx-rate", "network-traffic", "system-primary-ip",
            "system-local-hostname"].forEach((id) => setNetworkText(id, "Unavailable"));
        setNetworkText("network-monitor-state", "Unavailable");
        setNetworkText("network-refreshed", `Network details unavailable: ${error.message}`);
    }
}
refreshNetworkStats();
setInterval(refreshNetworkStats, 10000);
if (window.location.protocol === "http:" || window.location.protocol === "https:") refreshUpdateStatus();

document.getElementById("open-update")?.addEventListener("click", async () => {
    if (updateRunning) return;
    if (!window.confirm("Update SkyChopper now? Tracked local changes will be discarded, then the latest repository version will be pulled and setup rerun.")) return;
    document.body.classList.add("update-open");
    updateBackdrop.classList.add("open");
    updateBackdrop.setAttribute("aria-hidden", "false");
    if (updateAutoCloseTimer) clearTimeout(updateAutoCloseTimer);
    updateAutoCloseTimer = null;
    updateRunning = true;
    const closeUpdateButton = document.getElementById("close-update");
    const openUpdateButton = document.getElementById("open-update");
    if (closeUpdateButton) closeUpdateButton.disabled = true;
    if (openUpdateButton) openUpdateButton.disabled = true;
    updateStatus.textContent = "Starting SkyChopper update...";
    if (actionMessage) {
        actionMessage.hidden = false;
        actionMessage.removeAttribute("title");
        actionMessage.textContent = "Starting SkyChopper update...";
    }
    updateOutput.textContent = "";
    updateUpgradePromptShown = false;
    aptUpgradeDialog.hidden = true;
    try {
        const response = await fetch(`${API_BASE}/api/update`, { method: "POST" });
        const data = await response.json();
        if (!response.ok || !data.ok) throw new Error(data.error || "Could not start update");
        if (!updatePollTimer) updatePollTimer = setInterval(refreshUpdateStatus, 2000);
        refreshUpdateStatus();
    } catch (error) {
        updateRunning = false;
        if (closeUpdateButton) closeUpdateButton.disabled = false;
        if (openUpdateButton) openUpdateButton.disabled = false;
        updateStatus.textContent = `Update failed to start: ${error.message}`;
        if (actionMessage) {
            actionMessage.textContent = "Update failed to start.";
            actionMessage.title = error.message;
        }
    }
});
document.getElementById("apt-upgrade-cancel")?.addEventListener("click", () => respondToAptUpgrade(false));
document.getElementById("apt-upgrade-confirm")?.addEventListener("click", () => respondToAptUpgrade(true));
document.getElementById("open-readme")?.addEventListener("click", () => openDocumentModal("README.md", "SkyChopper README", "Project setup, features, and troubleshooting."));
document.getElementById("open-license")?.addEventListener("click", () => openDocumentModal("LICENSE.txt", "SkyChopper Licence", "Project licence and usage terms."));
document.getElementById("close-document")?.addEventListener("click", closeDocumentModal);
documentBackdrop?.addEventListener("click", (event) => {
    if (event.target === documentBackdrop) closeDocumentModal();
});
document.getElementById("close-update")?.addEventListener("click", closeUpdateModal);
updateBackdrop?.addEventListener("click", (event) => { if (event.target === updateBackdrop) closeUpdateModal(); });

if (confirmClearLogsOk) {
    confirmClearLogsOk.addEventListener("click", async () => {
        try { await postAction("/api/clear-logs"); closeConfirmClearLogs(); closeLogsModal(); loadLogTable(); }
        catch { alert("Unable to clear logs."); }
    });
}
if (confirmClearLogsCancel) confirmClearLogsCancel.addEventListener("click", closeConfirmClearLogs);
if (confirmResetAllOk) {
    confirmResetAllOk.addEventListener("click", async () => {
        try { await postAction("/api/reset-all"); closeConfirmResetAll(); closeSettingsModal(); }
        catch { alert("Unable to reset all data."); }
    });
}

if (confirmSimCancel) {
    confirmSimCancel.addEventListener("click", () => {
        closeConfirmSim();
        window._pendingSettings = null;
    });
}

if (confirmSimOk) {
    confirmSimOk.addEventListener("click", () => {
        if (!window._pendingSettings) return;

        applySettings(window._pendingSettings);

        writeSettingsToFile()
            .then(() => {
                updateData();
                closeConfirmSim();
                closeSettingsModal();
            })
            .catch(() => alert("Unable to save settings."));

        window._pendingSettings = null;
    });
}

if (confirmSim) {
    confirmSim.addEventListener("click", (e) => {
        if (e.target === confirmSim) {
            closeConfirmSim();
            window._pendingSettings = null;
        }
    });
}

if (confirmResetAllCancel) confirmResetAllCancel.addEventListener("click", closeConfirmResetAll);

if (overrideSwitch) {

    overrideSwitch.addEventListener("click", async (event) => {

        const btn = event.target.closest("button");
        if (!btn || !btn.dataset.mode) return;

        const newMode = btn.dataset.mode;

        movePill(newMode);

        const next = {
            ...settingsState,
            power_override: newMode
        };

        applySettings(next);

        try {
            await writeSettingsToFile();
            updateData();
        } catch {
            alert("Unable to save power override.");
        }

    });
}

function formatBytes(value) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "Unavailable";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = Number(value), index = 0;
    while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
    return `${amount.toFixed(index ? 1 : 0)} ${units[index]}`;
}

function setPanelCollapsed(panel, toggle, collapsed) {
    panel.classList.toggle("collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    const title = panel.dataset.collapseKey.replace(/-/g, " ");
    toggle.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} ${title} panel`);
    try {
        localStorage.setItem(`skychopper-panel:${panel.dataset.collapseKey}`, collapsed ? "closed" : "open");
    } catch {}
}

function setupCollapsiblePanels() {
    document.querySelectorAll(".dashboard-grid > .card[data-collapse-key]").forEach((panel) => {
        const header = panel.querySelector(":scope > h2");
        if (!header) return;
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "panel-toggle";
        header.insertBefore(toggle, header.firstChild);

        let collapsed = false;
        try { collapsed = localStorage.getItem(`skychopper-panel:${panel.dataset.collapseKey}`) === "closed"; } catch {}
        setPanelCollapsed(panel, toggle, collapsed);

        toggle.addEventListener("click", () => setPanelCollapsed(panel, toggle, !panel.classList.contains("collapsed")));
        header.addEventListener("click", (event) => {
            if (event.target.closest("button")) return;
            setPanelCollapsed(panel, toggle, !panel.classList.contains("collapsed"));
        });
    });
}

function formatUptime(seconds) {
    if (!Number.isFinite(Number(seconds))) return "Unavailable";
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
}

async function refreshSystemStats() {
    try {
        const response = await fetch(`${API_BASE}/api/system`, { cache: "no-store" });
        if (!response.ok) throw new Error("System stats unavailable");
        const data = await response.json();
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value ?? "Unavailable"; };
        const bar = (id, percent) => { const el = document.getElementById(id); if (el) el.style.width = `${Math.max(0, Math.min(100, Number(percent) || 0))}%`; };
        set("system-version", `v${APP_VERSION}`);
        set("system-hostname", data.hostname);
        set("system-uptime", formatUptime(data.uptimeSeconds));
        set("system-temp", Number.isFinite(data.temperatureC) ? `${data.temperatureC.toFixed(1)} °C` : "Unavailable");
        set("cpu-label", Number.isFinite(data.cpuUsagePercent) ? `${data.cpuUsagePercent.toFixed(1)}%` : "—");
        bar("cpu-bar", data.cpuUsagePercent);
        set("memory-label", `${formatBytes(data.memory?.usedBytes)} / ${formatBytes(data.memory?.totalBytes)} (${data.memory?.usedPercent ?? "--"}%)`);
        bar("memory-bar", data.memory?.usedPercent);
        set("disk-label", `${formatBytes(data.disk?.usedBytes)} / ${formatBytes(data.disk?.totalBytes)} (${data.disk?.usedPercent ?? "--"}%)`);
        bar("disk-bar", data.disk?.usedPercent);
        set("load-label", Array.isArray(data.loadAverage) ? data.loadAverage.join(" / ") : "Unavailable");
    } catch {}
}

async function refreshDeviceStats() {
    try {
        const response = await fetch(`${API_BASE}/api/devices`, { cache: "no-store" });
        if (!response.ok) throw new Error("Device stats unavailable");
        const data = await response.json();
        const set = (id, value) => { const el = document.getElementById(id); if (el) el.textContent = value ?? "Unavailable"; };
        set("serial-port", data.configuredPort);
        set("serial-baud", data.baudRate);
        set("serial-connection", data.connected ? "Connected" : "Disconnected");
        set("serial-device-list", (data.serialDevices || []).map((device) => device.path === device.resolvedPath ? device.path : `${device.path} → ${device.resolvedPath}`).join(", ") || "No UART device found");
        const state = document.getElementById("reader-state");
        if (state) { state.textContent = data.connected ? "Serial connected" : "Waiting for serial"; state.className = `status-pill ${data.connected ? "ok" : "warn"}`; }
    } catch {}
}

async function refreshReaderLog() {
    if (!readerLog) return;
    try {
        const response = await fetch(`${API_BASE}/api/reader-log?limit=80`, { cache: "no-store" });
        if (!response.ok) throw new Error("Reader output unavailable");
        const data = await response.json();
        readerLog.textContent = (data.entries || []).map((entry) => `${entry.time_iso}  ${entry.message}`).join("\n") || "Waiting for read.js output";
        readerLog.scrollTop = readerLog.scrollHeight;
    } catch { readerLog.textContent = "Reader output unavailable"; }
}

function startPolling() {
    updateData();
    setInterval(updateData, 1000);
}

function updateLiveClock() {
    if (!liveClock) return;
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    liveClock.textContent = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}

updateLiveClock();
setInterval(updateLiveClock, 1000);
startPolling();
loadSettings();
setupCollapsiblePanels();
refreshSystemStats();
refreshDeviceStats();
refreshReaderLog();
loadRepoFiles();
loadLogTable();
setInterval(refreshSystemStats, 5000);
setInterval(refreshDeviceStats, 3000);
setInterval(refreshReaderLog, 2000);
setInterval(loadLogTable, LOG_REFRESH_MS);
resizeCanvas();
resizeLogChart();
renderLoop();

let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { resizeCanvas(); resizeLogChart(); }, 80);
});

window.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (key === "escape" && documentBackdrop?.classList.contains("open")) {
        closeDocumentModal();
    }
    if (key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r")) {
        event.preventDefault();
    }
});
