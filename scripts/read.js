const fs = require("fs");
const path = require("path");

const statusFile = path.join(__dirname, "../data/status.json");
const settingsFile = path.join(__dirname, "../data/settings.json");

// Default settings if missing
const defaultSettings = {
    target_buck_voltage: 9,
    batt_full_voltage: 12.6,
    batt_empty_voltage: 10.8,
    on_percent: 80,
    off_percent: 60
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

function clamp(x, a, b) {
    return Math.max(a, Math.min(b, x));
}

function generateData() {

    const settings = JSON.parse(fs.readFileSync(settingsFile));

    const fullV = settings.batt_full_voltage;
    const emptyV = settings.batt_empty_voltage;
    const onPercent = settings.on_percent;
    const offPercent = settings.off_percent;
    const targetBuck = settings.target_buck_voltage;

    // Fake voltages
    const battV = 10.8 + Math.random() * 2;
    const sourceV = Math.random() < 0.2 ? 0 : 10 + Math.random() * 6;

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

    const buckV = targetBuck;

    const data = {
        batt_voltage: battV,
        source_voltage: sourceV,
        buck_voltage: buckV,
        batt_percent: percent,
        use_source: useSource,
        system_on: systemOn,
        time: Date.now()
    };

    fs.writeFileSync(statusFile, JSON.stringify(data, null, 2));
}

setInterval(generateData, 1000);
console.log("System simulator running...");