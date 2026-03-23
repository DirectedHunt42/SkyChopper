const fs = require("fs");
const path = require("path");

const statusFile = path.join(__dirname, "../data/status.json");
const settingsFile = path.join(__dirname, "../data/settings.json");

// Default settings if missing
const defaultSettings = {
    target_buck_voltage: 9,
    source_expected_min_v: 8.5,
    source_expected_max_v: 9.5,
    batt_full_voltage: 12.6,
    batt_empty_voltage: 9.0,
    batt_on_percent: 80,
    batt_off_percent: 60
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

// Ensure data folder exists
const dataFolder = path.join(__dirname, "../data");
if (!fs.existsSync(dataFolder)) fs.mkdirSync(dataFolder);

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

// State memory for hysteresis
let systemOn = defaultStatus.system_on;
let useSource = defaultStatus.use_source;
let battV = defaultStatus.batt_voltage;
let sourceV = defaultStatus.source_voltage;
let buckV = defaultStatus.buck_voltage;
let sourcePresent = true;

function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
}

function generateData() {

    const settings = JSON.parse(fs.readFileSync(settingsFile));

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

    // Occasionally toggle source presence for realism
    if (Math.random() < 0.02) {
        sourcePresent = !sourcePresent;
    }

    // Source voltage around target with slight noise, sometimes off or slightly out of range
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

    // Battery voltage drift based on load/source
    const dischargeRate = systemOn && !useSource ? -0.015 : -0.003;
    const chargeRate = useSource ? 0.01 : 0.0;
    battV = clamp(battV + dischargeRate + chargeRate + (Math.random() - 0.5) * 0.01, emptyV, fullV);

    // Calculate battery %
    let percent = ((battV - emptyV) / (fullV - emptyV)) * 100;
    percent = clamp(percent, 0, 100);

    // Hysteresis ON/OFF
    if (!systemOn && percent >= onPercent) systemOn = true;
    if (systemOn && percent <= offPercent) systemOn = false;

    // Source logic
    if (sourceV <= 0.1) {
        useSource = false;
    } else {
        useSource = systemOn;
    }

    // Buck voltage around target with gentle noise
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

    fs.writeFileSync(statusFile, JSON.stringify(data, null, 2));
}

setInterval(generateData, 1000);
console.log("System simulator running...");
