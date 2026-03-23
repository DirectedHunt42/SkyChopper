const canvas = document.getElementById('monitorCanvas');
const ctx = canvas.getContext('2d');
const turbine = document.getElementById('turbine');
const statusSource = document.getElementById('status-source');
const statusBattery = document.getElementById('status-battery');
const openSettings = document.getElementById('open-settings');
const settingsBackdrop = document.getElementById('settings-backdrop');
const closeSettings = document.getElementById('close-settings');
const saveSettingsBtn = document.getElementById('save-settings');
const downloadSettingsBtn = document.getElementById('download-settings');
const inputSourceMin = document.getElementById('setting-source-min');
const inputSourceMax = document.getElementById('setting-source-max');
const inputBattStart = document.getElementById('setting-batt-start');
const inputBattStop = document.getElementById('setting-batt-stop');
const inputTargetBuck = document.getElementById('setting-target-buck');
const inputBattFull = document.getElementById('setting-batt-full');
const inputBattEmpty = document.getElementById('setting-batt-empty');
const inputOnPercent = document.getElementById('setting-on-percent');
const inputOffPercent = document.getElementById('setting-off-percent');

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
    batt_start_v: 11.5,
    batt_stop_v: 10.8,
    batt_full_voltage: 12.6,
    batt_empty_voltage: 10.8,
    on_percent: 80,
    off_percent: 60
};

let settingsState = { ...settingsDefaults };
let thresholds = {
    battStartV: settingsState.batt_start_v,
    battStopV: settingsState.batt_stop_v,
    sourceExpectedMinV: settingsState.source_expected_min_v,
    sourceExpectedMaxV: settingsState.source_expected_max_v
};

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
        dump_load: Boolean(d.dump_load)
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

function applySettings(next) {
    settingsState = { ...settingsState, ...next };
    thresholds = {
        battStartV: Number.isFinite(settingsState.batt_start_v) ? settingsState.batt_start_v : thresholds.battStartV,
        battStopV: Number.isFinite(settingsState.batt_stop_v) ? settingsState.batt_stop_v : thresholds.battStopV,
        sourceExpectedMinV: Number.isFinite(settingsState.source_expected_min_v) ? settingsState.source_expected_min_v : thresholds.sourceExpectedMinV,
        sourceExpectedMaxV: Number.isFinite(settingsState.source_expected_max_v) ? settingsState.source_expected_max_v : thresholds.sourceExpectedMaxV
    };
}

function fillSettingsForm() {
    if (!inputSourceMin) return;
    inputSourceMin.value = settingsState.source_expected_min_v;
    inputSourceMax.value = settingsState.source_expected_max_v;
    inputBattStart.value = settingsState.batt_start_v;
    inputBattStop.value = settingsState.batt_stop_v;
    inputTargetBuck.value = settingsState.target_buck_voltage;
    inputBattFull.value = settingsState.batt_full_voltage;
    inputBattEmpty.value = settingsState.batt_empty_voltage;
    inputOnPercent.value = settingsState.on_percent;
    inputOffPercent.value = settingsState.off_percent;
}

function parseNum(value, fallback) {
    const n = Number.parseFloat(value);
    return Number.isFinite(n) ? n : fallback;
}

async function loadSettings() {
    let loaded = null;
    try {
        const stored = localStorage.getItem("sky_settings");
        if (stored) {
            loaded = JSON.parse(stored);
        }
    } catch {
        loaded = null;
    }

    if (!loaded) {
        try {
            const res = await fetch("data/settings.json", { cache: "no-store" });
            loaded = await res.json();
        } catch {
            loaded = null;
        }
    }

    if (loaded) {
        applySettings(loaded);
    }

    fillSettingsForm();
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

function downloadSettings() {
    const blob = new Blob([JSON.stringify(settingsState, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "settings.json";
    link.click();
    URL.revokeObjectURL(link.href);
}

// Fetch JSON
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
                level = (srcV >= expMin && srcV <= expMax) ? " on" : " warn";
            }
            statusSource.className = "status-dot" + level;
            const sourceTip = `Source ${srcV.toFixed(2)} V (target ${expMin.toFixed(1)}–${expMax.toFixed(1)} V)`;
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
            statusBattery.className = "status-dot" + level;
            const battTip = `Battery ${battV.toFixed(2)} V (start ${startV.toFixed(1)} V, stop ${stopV.toFixed(1)} V)`;
            const battItem = statusBattery.closest(".status-item");
            if (battItem) {
                battItem.setAttribute("data-tooltip", battTip);
                battItem.setAttribute("aria-label", battTip);
            }
        }
    } catch (err) {
        // keep previous status if fetch fails
    }
}

// Draw dashboard
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

    // Data blocks
    const blocks = [];
    if (availableKeys.has("batt_voltage") || availableKeys.has("batt_percent")) {
        blocks.push({
            label: "Battery",
            value: `${status.batt_voltage.toFixed(2)} V\n${status.batt_percent.toFixed(1)} %`,
            safe: status.batt_percent > 20
        });
    }
    if (availableKeys.has("source_voltage")) {
        blocks.push({
            label: "Source",
            value: `${status.source_voltage.toFixed(2)} V`,
            safe: status.source_voltage > 10
        });
    }
    if (availableKeys.has("buck_voltage")) {
        blocks.push({
            label: "Buck Output",
            value: `${status.buck_voltage.toFixed(2)} V`,
            safe: status.buck_voltage > 8
        });
    }
    if (availableKeys.has("use_source") || availableKeys.has("system_on")) {
        blocks.push({
            label: "Power Mode",
            value: `${status.use_source ? "SOURCE" : "BATTERY"}`,
            safe: true
        });
    }
    if (availableKeys.has("rpm")) {
        blocks.push({
            label: "RPM",
            value: `${Math.round(status.rpm)}`,
            safe: true
        });
    }
    if (availableKeys.has("current")) {
        blocks.push({
            label: "Current",
            value: `${status.current.toFixed(2)} A`,
            safe: status.current < 10
        });
    }
    if (availableKeys.has("dump_load")) {
        blocks.push({
            label: "Dump Load",
            value: `${status.dump_load ? "ON" : "OFF"}`,
            safe: !status.dump_load
        });
    }

    let centerX = width / 2;
    let centerY = height * (isNarrow ? 0.28 : 0.45);

    // Layout cards and adjust turbine center to avoid overlap
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
                if (count === 0) {
                    return [];
                }
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
            ctx.fillStyle = b.safe ? palette.ink : palette.danger;
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
        const rpm = Math.max(20, Number.isFinite(status.rpm) ? status.rpm : 0);
        const seconds = Math.min(6, Math.max(0.6, 60 / rpm));
        turbine.style.setProperty("--spin", `${seconds}s`);
    }
    draw();
    requestAnimationFrame(renderLoop);
}

if (openSettings) {
    openSettings.addEventListener("click", () => {
        fillSettingsForm();
        openSettingsModal();
    });
}

if (closeSettings) {
    closeSettings.addEventListener("click", closeSettingsModal);
}

if (settingsBackdrop) {
    settingsBackdrop.addEventListener("click", (event) => {
        if (event.target === settingsBackdrop) {
            closeSettingsModal();
        }
    });
}

if (saveSettingsBtn) {
    saveSettingsBtn.addEventListener("click", () => {
        const next = {
            source_expected_min_v: parseNum(inputSourceMin?.value, settingsState.source_expected_min_v),
            source_expected_max_v: parseNum(inputSourceMax?.value, settingsState.source_expected_max_v),
            batt_start_v: parseNum(inputBattStart?.value, settingsState.batt_start_v),
            batt_stop_v: parseNum(inputBattStop?.value, settingsState.batt_stop_v),
            target_buck_voltage: parseNum(inputTargetBuck?.value, settingsState.target_buck_voltage),
            batt_full_voltage: parseNum(inputBattFull?.value, settingsState.batt_full_voltage),
            batt_empty_voltage: parseNum(inputBattEmpty?.value, settingsState.batt_empty_voltage),
            on_percent: parseNum(inputOnPercent?.value, settingsState.on_percent),
            off_percent: parseNum(inputOffPercent?.value, settingsState.off_percent)
        };
        applySettings(next);
        try {
            localStorage.setItem("sky_settings", JSON.stringify(settingsState));
        } catch {
            // ignore storage errors
        }
        updateData();
        closeSettingsModal();
    });
}

if (downloadSettingsBtn) {
    downloadSettingsBtn.addEventListener("click", downloadSettings);
}

function startPolling() {
    updateData();
    setInterval(updateData, 1000);
}

startPolling();
loadSettings();
resizeCanvas();
renderLoop();

let resizeTimer;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resizeCanvas, 80);
});
