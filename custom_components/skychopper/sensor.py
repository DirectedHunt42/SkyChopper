from homeassistant.config_entries import ConfigEntry
from homeassistant.components.sensor import (
    SensorDeviceClass,
    SensorEntity,
    SensorEntityDescription,
    SensorStateClass,
)
from homeassistant.const import (
    PERCENTAGE,
    UnitOfInformation,
    UnitOfTemperature,
    UnitOfTime,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import DOMAIN
from .coordinator import SkyChopperCoordinator


SENSORS = (
    SensorEntityDescription(
        key="temperatureC",
        name="Temperature",
        native_unit_of_measurement=UnitOfTemperature.CELSIUS,
        device_class=SensorDeviceClass.TEMPERATURE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:thermometer",
    ),
    SensorEntityDescription(
        key="cpuUsagePercent",
        name="CPU Usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:cpu-64-bit",
    ),
    SensorEntityDescription(
        key="memory_used_percent",
        name="Memory Usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:memory",
    ),
    SensorEntityDescription(
        key="memory_used_bytes",
        name="Memory Used",
        native_unit_of_measurement=UnitOfInformation.BYTES,
        device_class=SensorDeviceClass.DATA_SIZE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:memory",
    ),
    SensorEntityDescription(
        key="disk_used_percent",
        name="Disk Usage",
        native_unit_of_measurement=PERCENTAGE,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:harddisk",
    ),
    SensorEntityDescription(
        key="uptimeSeconds",
        name="Uptime",
        native_unit_of_measurement=UnitOfTime.SECONDS,
        device_class=SensorDeviceClass.DURATION,
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:timer-outline",
    ),
    SensorEntityDescription(
        key="load_1m",
        name="Load Average (1m)",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:gauge",
    ),
    SensorEntityDescription(
        key="load_5m",
        name="Load Average (5m)",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:gauge",
    ),
    SensorEntityDescription(
        key="load_15m",
        name="Load Average (15m)",
        state_class=SensorStateClass.MEASUREMENT,
        icon="mdi:gauge",
    ),
)

ENTITY_IDS = {
    "temperatureC": "temperature",
    "cpuUsagePercent": "cpu_usage",
    "memory_used_percent": "memory_usage",
    "memory_used_bytes": "memory_used",
    "disk_used_percent": "disk_usage",
    "uptimeSeconds": "uptime",
    "load_1m": "load_average_1m",
    "load_5m": "load_average_5m",
    "load_15m": "load_average_15m",
}


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    coordinator: SkyChopperCoordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities(
        SkyChopperSensor(coordinator, entry, description) for description in SENSORS
    )


class SkyChopperSensor(CoordinatorEntity[SkyChopperCoordinator], SensorEntity):
    entity_description: SensorEntityDescription

    def __init__(
        self,
        coordinator: SkyChopperCoordinator,
        entry: ConfigEntry,
        description: SensorEntityDescription,
    ) -> None:
        super().__init__(coordinator)
        self.entity_description = description
        self._entry = entry
        self._attr_unique_id = f"{entry.entry_id}_{description.key}"
        self._attr_has_entity_name = True
        self._attr_name = description.name
        self._attr_suggested_object_id = f"skychopper_{ENTITY_IDS[description.key]}"
        self._attr_native_unit_of_measurement = description.native_unit_of_measurement
        self._attr_device_class = description.device_class
        self._attr_state_class = description.state_class
        self._attr_icon = description.icon

    @property
    def device_info(self) -> DeviceInfo:
        hostname = self.coordinator.data.get("hostname", "Raspberry Pi")
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry.entry_id)},
            name=f"SkyChopper ({hostname})",
            manufacturer="SkyChopper",
            model=self.coordinator.data.get("platform", "Raspberry Pi"),
        )

    @property
    def native_value(self) -> int | float | None:
        data = self.coordinator.data
        key = self.entity_description.key
        if key == "memory_used_percent":
            value = (data.get("memory") or {}).get("usedPercent")
        elif key == "memory_used_bytes":
            value = (data.get("memory") or {}).get("usedBytes")
        elif key == "disk_used_percent":
            value = (data.get("disk") or {}).get("usedPercent")
        elif key.startswith("load_"):
            index = {"load_1m": 0, "load_5m": 1, "load_15m": 2}[key]
            values = data.get("loadAverage") or []
            value = values[index] if len(values) > index else None
        else:
            value = data.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return value
        return None
