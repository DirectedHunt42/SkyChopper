async function updateData() {

    try {

        const res =
            await fetch("data/status.json");

        const d = await res.json();

        document.getElementById("batt")
            .innerText = d.batt_voltage.toFixed(2);

        document.getElementById("source")
            .innerText = d.source_voltage.toFixed(2);

        document.getElementById("buck")
            .innerText = d.buck_voltage.toFixed(2);

        document.getElementById("percent")
            .innerText = d.batt_percent.toFixed(1);

        document.getElementById("mode")
            .innerText =
            d.use_source ? "SOURCE" : "BATTERY";

        document.getElementById("on")
            .innerText =
            d.system_on ? "ON" : "OFF";

    } catch (err) {}

}

setInterval(updateData, 1000);