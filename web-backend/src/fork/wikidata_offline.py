"""
Fork: Wikidata offline. Upstream's popups ask Wikidata and Wikimedia Commons for a
feature's details and picture; here they come from the cache scripts/fetch_images.py
fills (data/wikidata_json/, data/images/), and without a network the popup just
has less instead of an error. Upstream's files stay as they are: `install()` wraps
their functions, where they're defined (data.py) and where they're imported
(views/wikidata.py, views/area.py), when the fork's routes load.

- get_wikidata: the cached entity JSON first; no network: None.
- get_commons_thumbnail: the picture downloaded for the item being shown
  (/local-images/<id>.<ext>) first; no network: None.
"""

from __future__ import annotations

import contextvars
import json
import logging
from functools import wraps
from pathlib import Path
from typing import Any

import httpx

from .paths import IMAGES_DIR, WIKIDATA_JSON_DIR

logger = logging.getLogger(__name__)

# The Wikidata item whose details are being made (views/wikidata.wikidata_json),
# so its picture can be the one downloaded for it.
_current_item: contextvars.ContextVar[str | None] = contextvars.ContextVar("item", default=None)


def cached_entity(wikidata_id: str, folder: Path | None = None) -> dict | None:
    """The entity JSON fetch_images.py saved, None if it isn't there."""
    path = (folder or WIKIDATA_JSON_DIR) / f"{wikidata_id}.json"
    try:
        return json.loads(path.read_text())
    except (OSError, json.JSONDecodeError):
        return None


def local_image(wikidata_id: str, folder: Path | None = None) -> str | None:
    """The address of the picture fetch_images.py downloaded for an item, if any."""
    matches = sorted((folder or IMAGES_DIR).glob(f"{wikidata_id}.*"))
    return f"/local-images/{matches[0].name}" if matches else None


def offline_get_wikidata(original):
    @wraps(original)
    async def get_wikidata(wikidata_id: str, client: httpx.AsyncClient) -> dict | None:
        cached = cached_entity(wikidata_id)
        if cached is not None:
            return cached
        try:
            return await original(wikidata_id, client)
        except httpx.TransportError:
            logger.warning("No network: could not fetch wikidata entity %s", wikidata_id)
            return None

    return get_wikidata


def offline_get_commons_thumbnail(original):
    @wraps(original)
    async def get_commons_thumbnail(filename: str, client: httpx.AsyncClient, *args: Any, **kw: Any):
        item = _current_item.get()
        local = local_image(item) if item else None
        if local:
            return {"imageinfo": [{"thumburl": local}]}
        try:
            return await original(filename, client, *args, **kw)
        except httpx.TransportError:
            logger.warning("No network: could not fetch Commons thumbnail for %s", filename)
            return None

    return get_commons_thumbnail


def remembering_item(original):
    """views/wikidata.wikidata_json, telling the thumbnail which item it's for."""

    @wraps(original)
    async def wikidata_json(wikidata_id: str, http_client: httpx.AsyncClient):
        token = _current_item.set(wikidata_id)
        try:
            return await original(wikidata_id, http_client)
        finally:
            _current_item.reset(token)

    return wikidata_json


_installed = False


def install() -> None:
    """Wrap upstream's functions (once), in every module that holds them."""
    global _installed
    if _installed:
        return
    from .. import data
    from ..views import area, wikidata

    get_wikidata = offline_get_wikidata(data.get_wikidata)
    get_thumbnail = offline_get_commons_thumbnail(data.get_commons_thumbnail)
    for module in (data, wikidata, area):
        if hasattr(module, "get_wikidata"):
            module.get_wikidata = get_wikidata  # type: ignore[attr-defined]
        if hasattr(module, "get_commons_thumbnail"):
            module.get_commons_thumbnail = get_thumbnail  # type: ignore[attr-defined]
    wikidata.wikidata_json = remembering_item(wikidata.wikidata_json)  # type: ignore[method-assign]
    _installed = True
