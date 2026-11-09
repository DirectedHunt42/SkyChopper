from urllib.parse import urlparse

import aiohttp
import voluptuous as vol
from homeassistant import config_entries
from homeassistant.config_entries import ConfigFlowResult
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DEFAULT_URL, DOMAIN


def _validate_url(value: str) -> str:
    url = urlparse(value.strip())
    if (
        url.scheme not in ("http", "https")
        or not url.hostname
        or url.username
        or url.password
        or url.path not in ("", "/")
        or url.query
        or url.fragment
    ):
        raise ValueError("invalid_url")
    try:
        url.port
    except ValueError as err:
        raise ValueError("invalid_url") from err
    return url.geturl().rstrip("/")


async def _check_connection(hass: HomeAssistant, url: str) -> str:
    session = async_get_clientsession(hass)
    async with session.get(
        f"{url}/api/system", timeout=aiohttp.ClientTimeout(total=10)
    ) as response:
        response.raise_for_status()
        data = await response.json()
    if not isinstance(data, dict) or data.get("ok") is not True:
        raise ValueError("invalid_response")
    hostname = data.get("hostname")
    if not isinstance(hostname, str) or not hostname.strip():
        raise ValueError("invalid_response")
    return hostname.strip()


class SkyChopperConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(
        self, user_input: dict | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            try:
                url = _validate_url(user_input["url"])
                hostname = await _check_connection(self.hass, url)
            except ValueError as err:
                errors["base"] = str(err) if str(err) == "invalid_response" else "invalid_url"
            except (aiohttp.ClientError, TimeoutError):
                errors["base"] = "cannot_connect"
            else:
                port = urlparse(url).port or (443 if url.startswith("https:") else 80)
                await self.async_set_unique_id(f"{hostname.lower()}|{port}")
                self._abort_if_unique_id_configured()
                return self.async_create_entry(
                    title=f"SkyChopper ({hostname})",
                    data={"url": url},
                )

        schema = vol.Schema(
            {
                vol.Required("url", default=DEFAULT_URL): str,
            }
        )
        return self.async_show_form(
            step_id="user", data_schema=schema, errors=errors
        )
