"""Fork: satellite imagery. Where offline maps come from: one file per source in
this folder (SOURCE, see source.py), read here into SOURCES; and the names the
rest of satimagery used before (DETAILED_SOURCES, TIERS, sizes), made from them."""

from __future__ import annotations

import importlib
import pkgutil
from pathlib import Path

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

GIBS_URL = BLUE_MARBLE.address
WORLDCOVER_URL = SENTINEL2.address


def _old_form(s: Source) -> dict:
    """An aerial source as the older code reads it."""
    out = {
        "name": s.title,
        "regions": list(s.regions),
        "format": s.format,
        "maxzoom": s.last_zoom,
        "resolution": s.resolution,
        "attribution": s.credit,
        "bytes": s.tile_bytes,
        "per_second": s.per_second,
    }
    out[{"tiles": "url", "wms": "wms", "files": "files"}[s.fetch]] = s.address
    if s.bbox:
        out["bbox"] = s.bbox
    return out


# High-resolution aerial photos, by country (the "detailed" tier): open data from
# national or regional mapping agencies, each checked to answer tile requests and
# to allow reuse. "regions": the Geofabrik regions they cover (downloads are cut to
# them); "bbox": a tighter limit (Belgium's two regions); "wms": a WMS GetMap URL
# with {bbox} (EPSG:3857) instead of a tile template; "files": downloaded as the
# agency's files instead of tiles (bdortho.py: IGN's tile server blocks a computer
# asking for tiles by the million).
# Left out: Switzerland (offline copies must come from its file download service,
# not the tile server), Denmark (needs a key), Norway (no open imagery tiles).
DETAILED_SOURCES: dict[str, dict] = {
    i: _old_form(s) for i, s in sorted(SOURCES.items()) if s.layer == "detailed"
}
DETAILED_DEFAULTS = {"format": "jpg", "maxzoom": 17, "per_second": 10, "bytes": 22_000}


def detailed_source(source_id: str) -> dict:
    return {**DETAILED_DEFAULTS, **DETAILED_SOURCES[source_id], "id": source_id}


def attribution_for(name: str) -> str:
    """The credit line for an imagery file, from its name (<area>.sat-<tier>[-<source>]).
    The scripts pass it to the frontend with the file (VITE_SATELLITE_TIERS), so this
    is the only list of credits."""
    stem = Path(name).name.removesuffix(".pmtiles")
    tier = stem.rsplit(".sat-", 1)[-1]
    if tier.startswith("detailed-") and tier[len("detailed-") :] in DETAILED_SOURCES:
        return DETAILED_SOURCES[tier[len("detailed-") :]]["attribution"]
    if tier == "detailed":  # before there were several sources: IGN's
        return DETAILED_SOURCES["fr_ign"]["attribution"]
    return TIERS[tier][3] if tier in TIERS else ""


def tile_url(source: dict, z: int, x: int, y: int) -> str:
    """A tile's URL from a source (a tile template, or a WMS GetMap for the tile)."""
    if "wms" in source:
        size = EARTH_CIRCUMFERENCE_M / 2**z
        half = EARTH_CIRCUMFERENCE_M / 2
        west, north = -half + x * size, half - y * size
        return source["wms"].format(
            bbox=f"{west:.2f},{north - size:.2f},{west + size:.2f},{north:.2f}"
        )
    return source["url"].format(z=z, x=x, y=y, ty=2**z - 1 - y)


TIERS = {
    # name: (minzoom, maxzoom, tile format, attribution); the maxzoom is what the
    # older menus offered by default.
    "overview": (
        BLUE_MARBLE.first_zoom,
        BLUE_MARBLE.last_zoom,
        BLUE_MARBLE.format,
        BLUE_MARBLE.credit,
    ),
    "regional": (SENTINEL2.first_zoom, 12, SENTINEL2.format, SENTINEL2.credit),
    # Aerial photos from zoom 12 (a town on screen): sharper and truer in colour
    # than Sentinel-2's 10 m there already. The credit: files named before there
    # were several sources were IGN's.
    "detailed": (12, 16, "jpg", "IGN orthophotos (Licence Ouverte)"),
}
WORLD_OVERVIEW_ZOOM = BLUE_MARBLE.sizes["world_zoom"]
WORLD_OVERVIEW_BYTES = BLUE_MARBLE.sizes["world"]
WORLD_BBOX = (-180.0, -85.0511, 180.0, 85.0511)

AVERAGE_TILE_BYTES = {
    "overview": BLUE_MARBLE.tile_bytes,
    "regional": SENTINEL2.tile_bytes,
    "detailed": DETAILED_DEFAULTS["bytes"],
}
WORLDCOVER_BYTES_PER_KM2 = SENTINEL2.sizes["read_per_km2"]
REGIONAL_BYTES_PER_KM2 = SENTINEL2.sizes["kept_per_km2"]
WORLD_LAND_KM2 = SENTINEL2.sizes["world_land_km2"]
WORLDCOVER_LATITUDES = range(-60, 84)

EARTH_CIRCUMFERENCE_M = 40_075_016.686
# Below this a tile may be a server's blank "no data" tile (download_tiles).
SMALL_TILE = 8_000


def worldcover_url(cell: str) -> str:
    return WORLDCOVER_URL.format(lat_name=cell[:3], cell=cell)
