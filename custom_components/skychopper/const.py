from datetime import timedelta

from homeassistant.const import Platform

DOMAIN = "skychopper"
PLATFORMS = [Platform.SENSOR]
DEFAULT_URL = "http://skychopper.local:8000"
UPDATE_INTERVAL = timedelta(seconds=30)
