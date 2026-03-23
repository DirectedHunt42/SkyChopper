const canvas = document.getElementById('monitorCanvas');
const ctx = canvas.getContext('2d');

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
let availableKeys = new Set();

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

// Fetch JSON
async function updateData() {
    try {
        const res = await fetch("data/status.json", { cache: "no-store" });
        const d = await res.json();
        status = normalizeStatus(d);
        availableKeys = new Set(Object.keys(d || {}));
    } catch (err) {
        // keep previous status if fetch fails
    }
}

// Draw dashboard
function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = palette.bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const centerX = canvas.width / 2;
    const centerY = 210;

    // Draw battery arc
    const radius = 60;
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.strokeStyle = status.batt_percent > 20 ? palette.good : palette.danger; // red if low
    ctx.arc(centerX, centerY, radius, -Math.PI/2, -Math.PI/2 + 2*Math.PI*status.batt_percent/100);
    ctx.stroke();

    // Draw turbine hub
    ctx.fillStyle = palette.accent;
    ctx.beginPath();
    ctx.arc(centerX, centerY, 20, 0, Math.PI * 2);
    ctx.fill();

    // Draw spinning blades (speed ~ RPM)
    const time = Date.now() / 1000;
    const numBlades = 3;
    for (let i = 0; i < numBlades; i++) {
        const angle = time * 2 * Math.PI * (status.rpm / 60) + i * 2 * Math.PI / numBlades;
        const length = 60;
        const x = centerX + length * Math.cos(angle);
        const y = centerY + length * Math.sin(angle);
        ctx.strokeStyle = palette.accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(centerX, centerY);
        ctx.lineTo(x, y);
        ctx.stroke();
    }

    // Data blocks
    const blocks = [];
    if (availableKeys.has("batt_voltage") || availableKeys.has("batt_percent")) {
        blocks.push({
            x: 50,
            y: 60,
            label: "Battery",
            value: `${status.batt_voltage.toFixed(2)} V\n${status.batt_percent.toFixed(1)} %`,
            safe: status.batt_percent > 20
        });
    }
    if (availableKeys.has("source_voltage")) {
        blocks.push({
            x: 550,
            y: 60,
            label: "Source",
            value: `${status.source_voltage.toFixed(2)} V`,
            safe: status.source_voltage > 10
        });
    }
    if (availableKeys.has("buck_voltage")) {
        blocks.push({
            x: 50,
            y: 360,
            label: "Buck Output",
            value: `${status.buck_voltage.toFixed(2)} V`,
            safe: status.buck_voltage > 8
        });
    }
    if (availableKeys.has("use_source") || availableKeys.has("system_on")) {
        blocks.push({
            x: 550,
            y: 360,
            label: "Power Mode",
            value: `${status.use_source ? "SOURCE" : "BATTERY"}\n${status.system_on ? "ON" : "OFF"}`,
            safe: true
        });
    }
    if (availableKeys.has("rpm")) {
        blocks.push({
            x: 250,
            y: 60,
            label: "RPM",
            value: `${Math.round(status.rpm)}`,
            safe: true
        });
    }
    if (availableKeys.has("current")) {
        blocks.push({
            x: 250,
            y: 360,
            label: "Current",
            value: `${status.current.toFixed(2)} A`,
            safe: status.current < 10
        });
    }
    if (availableKeys.has("dump_load")) {
        blocks.push({
            x: 350,
            y: 420,
            label: "Dump Load",
            value: `${status.dump_load ? "ON" : "OFF"}`,
            safe: !status.dump_load
        });
    }

    ctx.font = "600 12px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    blocks.forEach(b => {
        const cardW = 140;
        const cardH = 64;
        const cardX = b.x;
        const cardY = b.y;
        ctx.fillStyle = palette.panel;
        roundRect(cardX, cardY, cardW, cardH, 12);
        ctx.fill();
        ctx.strokeStyle = palette.outline;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        const lines = b.value.split("\n");
        ctx.font = "600 13px 'JetBrains Mono', ui-monospace, monospace";
        lines.forEach((line, i) => {
            ctx.fillStyle = b.safe ? palette.ink : palette.danger;
            ctx.fillText(line, cardX + cardW / 2, cardY + 34 + i * 15 - (lines.length - 1) * 8);
        });
        ctx.font = "600 11px 'Space Grotesk', 'Segoe UI', system-ui, sans-serif";
        ctx.fillStyle = palette.muted;
        ctx.fillText(b.label, cardX + cardW / 2, cardY + 14);
    });
}

function renderLoop() {
    draw();
    requestAnimationFrame(renderLoop);
}

function startPolling() {
    updateData();
    setInterval(updateData, 1000);
}

startPolling();
renderLoop();
