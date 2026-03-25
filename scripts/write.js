const canvas = document.getElementById('monitorCanvas');
const ctx = canvas.getContext('2d');
const turbine = document.getElementById('turbine');
const statusSource = document.getElementById('status-source');
const statusBattery = document.getElementById('status-battery');
const statusArduino = document.getElementById('status-arduino');
const turbineLabel = document.getElementById('turbine-label');
const openSettings = document.getElementById('open-settings');
const openLogs = document.getElementById('open-logs');
const downloadLog = document.getElementById('download-log');
const clearLogs = document.getElementById('clear-logs');
const settingsBackdrop = document.getElementById('settings-backdrop');
const closeSettings = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const resetSettingsBtn = document.getElementById('reset-settings');
const resetAllBtn = document.getElementById('reset-all');
const logsBackdrop = document.getElementById('logs-backdrop');
const closeLogs = document.getElementById('close-logs');
const logTableWrap = document.getElementById('log-table-wrap');
const logTableBody = document.getElementById('log-table-body');
const logLinesCount = document.getElementById('log-lines-count');
let logAutoRefreshTimer = null;
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
const logChart = document.getElementById('logChart');
const logChartCtx = logChart ? logChart.getContext('2d') : null;
let logRowsCache = [];
const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`;
const LOG_WINDOW_MS = 2 * 60 * 1000;
const LOG_WINDOW_PAD_MS = 10000;
const LOG_DISPLAY_LAG_MS = 5000;
const LOG_LEFT_HIDE_MS = 10000;

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

const prefersLight = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
const palette = prefersLight
    ? {
        bg: "#f8fafc",
        panel: "#ffffff",
        ink: "#0f172a",
        muted: "#64748b",
        accent: "#0ea5e9",
        good: "#22c55e",
        warn: "#f97316",
        danger: "#ef4444",
        outline: "#e2e8f0"
    }
    : {
        bg: "#0b1120",
        panel: "#111827",
        ink: "#e2e8f0",
        muted: "#94a3b8",
        accent: "#38bdf8",
        good: "#22c55e",
        warn: "#f59e0b",
        danger: "#ef4444",
        outline: "#1f2937"
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
    power_override: "auto"          // ← NEW
};

let settingsState = { ...settingsDefaults };
let thresholds = {
    battStartV: 11.5,
    battStopV: 10.8,
    sourceExpectedMinV: settingsState.source_expected_min_v,
    sourceExpectedMaxV: settingsState.source_expected_max_v
};

function applyStatusLevel(dotEl, level) {
    if (!dotEl) return;
    dotEl.className = "status-dot" + level;
    const item = dotEl.closest(".status-item");
    if (item) {
        item.className = "status-item" + level;
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
}

function applySettings(next) {
    settingsState = { ...settingsState, ...next };
    if (typeof settingsState.sim_fallback_enabled !== "boolean") {
        settingsState.sim_fallback_enabled = settingsDefaults.sim_fallback_enabled;
    }
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
}

// NEW: Update the visual state of the three-switch
function updateOverrideSwitch() {
    if (!overrideSwitch) return;
    const mode = settingsState.power_override || "auto";
    overrideSwitch.querySelectorAll('.switch-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
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

function openLogsModal() {
    if (!logsBackdrop) return;
    logsBackdrop.classList.add("open");
    logsBackdrop.setAttribute("aria-hidden", "false");
}

function closeLogsModal() {
    if (!logsBackdrop) return;
    logsBackdrop.classList.remove("open");
    logsBackdrop.setAttribute("aria-hidden", "true");
    if (logAutoRefreshTimer) {
        clearInterval(logAutoRefreshTimer);
        logAutoRefreshTimer = null;
    }
}

function renderLogTable(rows) {
    if (!logTableBody) return;
    logTableBody.innerHTML = "";
    if (!rows.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 4;
        td.textContent = "No log data yet.";
        tr.appendChild(td);
        logTableBody.appendChild(tr);
        return;
    }
    rows.forEach((row) => {
        const tr = document.createElement("tr");
        for (let i = 0; i < 4; i++) {
            const td = document.createElement("td");
            td.textContent = row[i] ?? "";
            tr.appendChild(td);
        }
        logTableBody.appendChild(tr);
    });
}

function renderLogChart(rows) {
    if (!logChart || !logChartCtx) return;
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

    const parsed = rows.map((row) => ({
        t: Date.parse(row[0]),
        batt: Number.parseFloat(row[1]),
        source: Number.parseFloat(row[2]),
        buck: Number.parseFloat(row[3])
    })).filter((d) => Number.isFinite(d.t));

    const slice = parsed.filter((d) => d.t >= displayNow - windowMs && d.t <= displayNow);

    const lastPoint = slice[slice.length - 1];
    if (lastPoint && lastPoint.t < displayNow) {
        slice.push({
            t: displayNow,
            batt: lastPoint.batt,
            source: lastPoint.source,
            buck: lastPoint.buck
        });
    }

    let minV = Infinity;
    let maxV = -Infinity;
    slice.forEach((d) => {
        [d.batt, d.source, d.buck].forEach((v) => {
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
    const yMin = minV - pad;
    const yMax = maxV + pad;

    const left = 38;
    const right = 12;
    const top = 12;
    const bottom = 30;
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
        ctx2d.fillText(value.toFixed(1), left - 6, y);
    }

    const visibleStart = displayNow - windowMs + LOG_LEFT_HIDE_MS;
    const visibleWindow = windowMs - LOG_LEFT_HIDE_MS;
    const toX = (t) => {
        const clamped = Math.max(visibleStart, Math.min(displayNow, t));
        return left + ((clamped - visibleStart) / visibleWindow) * plotW;
    };
    const toY = (v) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

    const tickStart = visibleStart;
    const tickStep = 5000;
    const tickEnd = displayNow;
    const tickY = top + plotH;
    ctx2d.strokeStyle = palette.outline;
    ctx2d.lineWidth = 1.2;
    for (let t = Math.ceil(tickStart / tickStep) * tickStep; t <= tickEnd; t += tickStep) {
        const x = toX(t);
        ctx2d.beginPath();
        ctx2d.moveTo(x, tickY);
        ctx2d.lineTo(x, tickY + 6);
        ctx2d.stroke();
    }

    if (0 >= yMin && 0 <= yMax) {
        const zeroY = toY(0);
        ctx2d.strokeStyle = palette.ink;
        ctx2d.lineWidth = 1.6;
        ctx2d.beginPath();
        ctx2d.moveTo(left, zeroY);
        ctx2d.lineTo(width - right, zeroY);
        ctx2d.stroke();
    }

    const drawSmoothSeries = (key, color) => {
        const points = slice
            .filter((d) => Number.isFinite(d[key]))
            .map((d) => ({ x: toX(d.t), y: toY(d[key]) }));
        if (!points.length) return;

        ctx2d.strokeStyle = color;
        ctx2d.lineWidth = 2;
        ctx2d.lineJoin = "round";
        ctx2d.lineCap = "round";
        ctx2d.beginPath();
        ctx2d.moveTo(points[0].x, points[0].y);

        for (let i = 1; i < points.length - 1; i++) {
            const midX = (points[i].x + points[i + 1].x) / 2;
            const midY = (points[i].y + points[i + 1].y) / 2;
            ctx2d.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
        }

        if (points.length > 1) {
            const last = points[points.length - 1];
            ctx2d.lineTo(last.x, last.y);
        }
        ctx2d.stroke();
    };

    drawSmoothSeries("batt", palette.good);
    drawSmoothSeries("source", palette.warn);
    drawSmoothSeries("buck", palette.accent);

    ctx2d.strokeStyle = palette.ink;
    ctx2d.lineWidth = 1.6;
    ctx2d.beginPath();
    ctx2d.moveTo(left, top);
    ctx2d.lineTo(left, top + plotH);
    ctx2d.stroke();
}

async function loadLogTable() {
    if (!logTableBody) return;
    try {
        const res = await fetch("data/log.csv", { cache: "no-store" });
        if (!res.ok) throw new Error("log fetch failed");
        const text = await res.text();
        const lines = text.trim().split(/\r?\n/);
        const rows = lines.length > 1
            ? lines.slice(1).map((line) => line.split(","))
            : [];

        if (logLinesCount) {
            const count = rows.length;
            logLinesCount.textContent = `${count.toLocaleString()} / 1 000 000 log lines used`;
        }

        const shouldStickToBottom = logTableWrap
            ? (logTableWrap.scrollHeight - logTableWrap.scrollTop - logTableWrap.clientHeight) < 24
            : true;

        renderLogTable(rows);
        logRowsCache = rows;
        renderLogChart(rows);

        if (logTableWrap) {
            requestAnimationFrame(() => {
                if (shouldStickToBottom) {
                    logTableWrap.scrollTop = logTableWrap.scrollHeight;
                }
            });
        }
    } catch {
        renderLogTable([]);
        renderLogChart([]);

        if (logLinesCount) {
            logLinesCount.textContent = `0 / 1 000 000 000 log lines used`;
        }
    }
}

async function updateData() {
    try {
        const res = await fetch("data/status.json", { cache: "no-store" });
        const d = await res.json();
        targetStatus = normalizeStatus(d);
        availableKeys = new Set(Object.keys(d || {}));

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
    } catch (err) {
        // keep previous status if fetch fails
    }
}

function draw() {
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
    if (availableKeys.has("batt_voltage") || availableKeys.has("batt_percent")) {
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
    if (availableKeys.has("buck_voltage")) {
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
    if (availableKeys.has("use_source") || availableKeys.has("system_on")) {
        const isUsingSource = Boolean(status.use_source);
        blocks.push({
            label: "Power Mode",
            value: `${isUsingSource ? "SOURCE" : "BATT"}`,
            level: isUsingSource ? "warn" : "good"
        });
    }
    if (availableKeys.has("rpm")) {
        blocks.push({
            label: "RPM",
            value: `${Math.round(status.rpm)}`,
            level: "good"
        });
    }
    if (availableKeys.has("current")) {
        blocks.push({
            label: "Current",
            value: `${status.current.toFixed(2)} A`,
            level: status.current < 10 ? "good" : "danger"
        });
    }
    if (availableKeys.has("dump_load")) {
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
        const isSimulatorEnabled = Boolean(settingsState.sim_fallback_enabled);
        const seconds = 1.25;
        turbine.style.setProperty("--spin", `${seconds}s`);
        if (turbineLabel) {
            turbineLabel.classList.toggle("show", isSimulatorEnabled);
        }
    }
    draw();
    if (logChart && logChartCtx) {
        renderLogChart(logRowsCache);
    }
    requestAnimationFrame(renderLoop);
}

// Event listeners (existing + new override switch)
if (openSettings) openSettings.addEventListener("click", () => { fillSettingsForm(); openSettingsModal(); });
if (openLogs) {
    openLogs.addEventListener("click", () => {
        openLogsModal();
        resizeLogChart();
        loadLogTable();
        if (!logAutoRefreshTimer) logAutoRefreshTimer = setInterval(loadLogTable, 5000);
    });
}
if (closeLogs) closeLogs.addEventListener("click", closeLogsModal);
if (logsBackdrop) logsBackdrop.addEventListener("click", (e) => { if (e.target === logsBackdrop) closeLogsModal(); });
if (downloadLog) {
    downloadLog.addEventListener("click", async () => {
        try {
            const res = await fetch("data/log.csv", { cache: "no-store" });
            if (!res.ok) throw new Error("download failed");
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = "log.csv";
            document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
        } catch { alert("Unable to download log.csv."); }
    });
}
if (closeSettings) closeSettings.addEventListener("click", closeSettingsModal);
if (settingsBackdrop) settingsBackdrop.addEventListener("click", (e) => { if (e.target === settingsBackdrop) closeSettingsModal(); });

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
        const next = {
            batt_full_voltage: parseNum(inputPackFull?.value, settingsState.batt_full_voltage),
            batt_empty_voltage: parseNum(inputPackEmpty?.value, settingsState.batt_empty_voltage),
            batt_on_percent: parseNum(inputOnPercent?.value, settingsState.batt_on_percent),
            batt_off_percent: parseNum(inputOffPercent?.value, settingsState.batt_off_percent),
            sim_fallback_enabled: Boolean(inputSimFallback?.checked)
        };
        applySettings(next);
        writeSettingsToFile().then(() => { updateData(); closeSettingsModal(); }).catch(() => alert("Unable to save settings."));
    });
}

function openConfirm() { if (confirmBackdrop) { confirmBackdrop.classList.add("open"); confirmBackdrop.setAttribute("aria-hidden", "false"); } }
function closeConfirm() { if (confirmBackdrop) { confirmBackdrop.classList.remove("open"); confirmBackdrop.setAttribute("aria-hidden", "true"); } }
function openConfirmClearLogs() { if (confirmClearLogs) { confirmClearLogs.classList.add("open"); confirmClearLogs.setAttribute("aria-hidden", "false"); } }
function closeConfirmClearLogs() { if (confirmClearLogs) { confirmClearLogs.classList.remove("open"); confirmClearLogs.setAttribute("aria-hidden", "true"); } }
function openConfirmResetAll() { if (confirmResetAll) { confirmResetAll.classList.add("open"); confirmResetAll.setAttribute("aria-hidden", "false"); } }
function closeConfirmResetAll() { if (confirmResetAll) { confirmResetAll.classList.remove("open"); confirmResetAll.setAttribute("aria-hidden", "true"); } }

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
if (confirmResetAllCancel) confirmResetAllCancel.addEventListener("click", closeConfirmResetAll);

// NEW: Override switch click handler
if (overrideSwitch) {
    overrideSwitch.addEventListener("click", async (event) => {
        const btn = event.target.closest("button");
        if (!btn || !btn.dataset.mode) return;

        const newMode = btn.dataset.mode;

        // Optimistic UI
        overrideSwitch.querySelectorAll('.switch-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === newMode);
        });

        const next = { ...settingsState, power_override: newMode };
        applySettings(next);

        try {
            await writeSettingsToFile();
            updateData();
        } catch {
            alert("Unable to save power override.");
        }
    });
}

function startPolling() {
    updateData();
    setInterval(updateData, 1000);
}

startPolling();
loadSettings();
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
    if (key === "f5" || ((event.ctrlKey || event.metaKey) && key === "r")) {
        event.preventDefault();
    }
});