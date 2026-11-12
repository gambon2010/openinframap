"""Fork: satellite imagery. Where offline maps come from: one file per source in
this folder (SOURCE, see source.py), read here into SOURCES, and the few
values every source shares."""

from __future__ import annotations

import importlib
import pkgutil

from .source import FETCH_KINDS as FETCH_KINDS
from .source import LAYERS as LAYERS
from .source import Source

GDAL_IMAGE = "ghcr.io/osgeo/gdal:alpine-small-3.10.3"
USER_AGENT = (
    "openinframap-local (offline satellite cache; github.com/gambon2010/openinframap)"
)


def _load() -> dict[str, Source]:
    found = {}
    for module in pkgutil.iter_modules(__path__):
        if module.name != "source":
            found[module.name] = importlib.import_module(
                f"{__name__}.{module.name}"
            ).SOURCE
    return found


# Every source, by id (its file's name): Blue Marble, Sentinel-2, the aerial
# photos by country, the background map.
SOURCES: dict[str, Source] = _load()
BLUE_MARBLE = SOURCES["blue_marble"]
SENTINEL2 = SOURCES["sentinel2"]
# High-resolution aerial photos, by country: open data from national or regional
# mapping agencies, each checked to answer tile requests and to allow reuse. Left
# out: Switzerland (offline copies must come from its file download service, not
# the tile server), Denmark (needs a key), Norway (no open imagery tiles).
AERIAL: dict[str, Source] = {
    i: s for i, s in sorted(SOURCES.items()) if s.layer == "detailed"
}
# Aerial photos from zoom 12 (a town on screen): sharper and truer in colour than
# Sentinel-2's 10 m there already (every aerial source's first_zoom; a test checks).
AERIAL_FIRST_ZOOM = 12

WORLD_BBOX = (-180.0, -85.0511, 180.0, 85.0511)
# The 1° rows the Sentinel-2 composite has (no Antarctica; it stops near 84° N).
WORLDCOVER_LATITUDES = range(-60, 84)
EARTH_CIRCUMFERENCE_M = 40_075_016.686
# Below this a tile may be a server's blank "no data" tile (download_tiles).
SMALL_TILE = 8_000


def tile_url(source: Source, z: int, x: int, y: int) -> str:
    """A tile's URL from a source (a tile template, or a WMS GetMap for the tile)."""
    if source.fetch == "wms":
        size = EARTH_CIRCUMFERENCE_M / 2**z
        half = EARTH_CIRCUMFERENCE_M / 2
        west, north = -half + x * size, half - y * size
        return source.address.format(
            bbox=f"{west:.2f},{north - size:.2f},{west + size:.2f},{north:.2f}"
        )
    return source.address.format(z=z, x=x, y=y, ty=2**z - 1 - y)


def worldcover_url(cell: str) -> str:
    """A 1° cell of the Sentinel-2 composite ("N49E006")."""
    return SENTINEL2.address.format(lat_name=cell[:3], cell=cell)
