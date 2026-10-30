#!/usr/bin/env python3
"""
Offline satellite imagery for the built region, in three tiers (one PMTiles file
each, in data/basemap/, served by the `basemap` Compose service like the offline
background map). Run by scripts/build-region.sh; see docs/plans/satellite-imagery.md.

  overview   zoom 0-8   NASA Blue Marble Next Generation (NASA GIBS, 500 m):
                        the whole world to zoom 8 (--world, one file for every
                        region), or the world to zoom 5 and a region's box to 8.
  regional   zoom 9-12  Sentinel-2 10 m yearly composite (ESA WorldCover 2021,
             (or 13)    CC BY 4.0), read straight from the public COGs with GDAL
                        (only the needed parts are downloaded), cut to the region.
  detailed   zoom 14-17 IGN orthophotos, 20 cm (France only, Licence Ouverte),
                        from the Géoplateforme WMTS, cut to the region; throttled.

    python3 scripts/satellite.py estimate --outline AREA.geojson
    python3 scripts/satellite.py overview --outline AREA.geojson --out FILE.pmtiles
    python3 scripts/satellite.py overview --world --out FILE.pmtiles  (to zoom 8, ~330 MB)
    python3 scripts/satellite.py regional --outline AREA.geojson --out FILE.pmtiles [--maxzoom 13]
    python3 scripts/satellite.py detailed --outline AREA.geojson --out FILE.pmtiles [--maxzoom 16]

The outline is the region's GeoJSON (Geofabrik's, as for the background map). GDAL
and pmtiles run in Docker (GDAL_IMAGE, and the basemap service's image).
Standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Iterator
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

GDAL_IMAGE = "ghcr.io/osgeo/gdal:alpine-small-3.10.3"
USER_AGENT = (
    "openinframap-local (offline satellite cache; github.com/gambon2010/openinframap)"
)

GIBS_URL = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/"
    "GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"
)
WORLDCOVER_URL = (
    "https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/"
    "{lat_name}/ESA_WorldCover_10m_2021_v200_{cell}_S2RGBNIR.tif"
)
IGN_URL = (
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
    "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM"
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg"
)

# High-resolution aerial photos, by country (the "detailed" tier, zoom 14 and up):
# open data from national or regional mapping agencies, each checked to answer
# tile requests and to allow reuse. "regions": the Geofabrik regions they cover
# (downloads are cut to them); "bbox": a tighter limit (Belgium's two regions);
# "wms": a WMS GetMap URL with {bbox} (EPSG:3857) instead of a tile template.
# Left out: Switzerland (offline copies must come from its file download service,
# not the tile server), Denmark (needs a key), Norway (no open imagery tiles).
DETAILED_SOURCES: dict[str, dict] = {
    "fr_ign": {
        "name": "France (IGN)",
        "regions": ["france"],
        "url": IGN_URL,
        "resolution": "20 cm",
        "attribution": "© IGN (Licence Ouverte)",
        "per_second": 20,
    },
    "es_pnoa": {
        "name": "Spain (IGN, PNOA)",
        "regions": ["spain"],
        "url": "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        "&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible"
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© IGN España, PNOA (CC BY 4.0)",
    },
    "nl_pdok": {
        "name": "Netherlands (PDOK)",
        "regions": ["netherlands"],
        "url": "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
        "resolution": "8 cm",
        "attribution": "© Beeldmateriaal Nederland, PDOK (CC BY 4.0)",
    },
    "lu_geoportail": {
        "name": "Luxembourg (geoportail.lu)",
        "regions": ["luxembourg"],
        "url": "https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg",
        "resolution": "20 cm",
        "attribution": "© Geoportail Luxembourg (CC0)",
    },
    "at_basemap": {
        "name": "Austria (basemap.at)",
        "regions": ["austria"],
        "url": "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        "resolution": "30 cm",
        "attribution": "© basemap.at (CC BY 4.0)",
    },
    "be_flanders": {
        "name": "Belgium: Flanders",
        "regions": ["belgium"],
        "bbox": (2.53, 50.67, 5.93, 51.51),
        "url": "https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?SERVICE=WMTS&REQUEST=GetTile"
        "&VERSION=1.0.0&LAYER=omwrgbmrvl&STYLE=&TILEMATRIXSET=GoogleMapsVL"
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
        "format": "png",
        "bytes": 80_000,
        "resolution": "25 cm",
        "attribution": "© Digitaal Vlaanderen (Modellicentie Gratis Hergebruik)",
    },
    "be_wallonia": {
        "name": "Belgium: Wallonia",
        "regions": ["belgium"],
        "bbox": (2.83, 49.49, 6.41, 50.82),
        "wms": "https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer"
        "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857"
        "&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© SPW, Wallonie (CC BY 4.0)",
    },
    "de_nrw": {
        "name": "Germany: North Rhine-Westphalia",
        "regions": ["nordrhein-westfalen"],
        "wms": "https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=nw_dop_rgb&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "10 cm",
        "attribution": "© Geobasis NRW (dl-de/zero-2-0)",
    },
    "de_bayern": {
        "name": "Germany: Bavaria",
        "regions": ["bayern"],
        "wms": "https://geoservices.bayern.de/od/wms/dop/v1/dop40?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "40 cm",
        "maxzoom": 16,
        "attribution": "© Bayerische Vermessungsverwaltung (CC BY 4.0)",
    },
    "de_berlin": {
        "name": "Germany: Berlin",
        "regions": ["berlin"],
        "wms": "https://gdi.berlin.de/services/wms/truedop_2024?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=truedop_2024&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "20 cm",
        "attribution": "© Geoportal Berlin (dl-de/zero-2-0)",
    },
    "cz_cuzk": {
        "name": "Czechia (ČÚZK)",
        "regions": ["czech-republic"],
        "url": "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
        "resolution": "20 cm",
        "attribution": "© ČÚZK (CC BY 4.0)",
    },
    "pl_geoportal": {
        "name": "Poland (Geoportal)",
        "regions": ["poland"],
        "url": "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default"
        "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© GUGiK, Geoportal.gov.pl",
    },
    "ee_maaamet": {
        "name": "Estonia (Maa- ja Ruumiamet)",
        "regions": ["estonia"],
        "url": "https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/{z}/{x}/{ty}.jpg",
        "resolution": "25 cm",
        "attribution": "© Maa- ja Ruumiamet",
    },
    "us_usgs": {
        "name": "United States (USGS, NAIP)",
        "regions": ["us"],
        "url": "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        "resolution": "60 cm to 1 m",
        "maxzoom": 16,
        "attribution": "USDA NAIP, USGS The National Map (public domain)",
    },
}
DETAILED_DEFAULTS = {"format": "jpg", "maxzoom": 17, "per_second": 10, "bytes": 22_000}


def detailed_source(source_id: str) -> dict:
    return {**DETAILED_DEFAULTS, **DETAILED_SOURCES[source_id], "id": source_id}


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
    # name: (minzoom, maxzoom, tile format, attribution)
    "overview": (0, 8, "jpg", "NASA Blue Marble"),
    "regional": (
        9,
        12,
        "webp",
        "Contains modified Copernicus Sentinel data (2021), ESA WorldCover",
    ),
    "detailed": (14, 16, "jpg", "IGN orthophotos (Licence Ouverte)"),
}
WORLD_OVERVIEW_ZOOM = 5
# The whole world to zoom 8 (overview --world, shared by every region): 87,381
# tiles, measured at about 3.8 KB each (mostly ocean).
WORLD_OVERVIEW_BYTES = 330_000_000
WORLD_BBOX = (-180.0, -85.0511, 180.0, 85.0511)

# Average tile sizes measured on Luxembourg and Alsace (bytes), for estimates.
AVERAGE_TILE_BYTES = {"overview": 6_500, "regional": 9_000, "detailed": 22_000}
# Bytes read from the 10 m composite per km² (RGBN, deflate): full resolution for
# zoom 13, the 20 m overview for zoom 12 and below.
WORLDCOVER_BYTES_PER_KM2 = {13: 70_000, 12: 18_000, 11: 4_500, 10: 1_100, 9: 300}
# Size of the regional tier per km² of land, zoom 9 up to the key (France to 12:
# 195 MB for 551,000 km²; each zoom level more is four times as many tiles).
REGIONAL_BYTES_PER_KM2 = {9: 6, 10: 22, 11: 89, 12: 354, 13: 1_416}
# Land the composite covers (no Antarctica; it stops near 84° N).
WORLD_LAND_KM2 = 134_000_000
WORLDCOVER_LATITUDES = range(-60, 84)

EARTH_CIRCUMFERENCE_M = 40_075_016.686
# Below this a tile may be a server's blank "no data" tile (download_tiles).
SMALL_TILE = 8_000


# --- Tile maths ---------------------------------------------------------------


def tile_of(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    """The web-mercator tile (x, y) containing a point."""
    n = 2**zoom
    lat = max(min(lat, 85.0511), -85.0511)
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_bounds(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile, in degrees."""
    n = 2**zoom

    def lat(row: int) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))

    return x / n * 360.0 - 180.0, lat(y + 1), (x + 1) / n * 360.0 - 180.0, lat(y)


def tiles_in_bbox(
    bbox: tuple[float, float, float, float], zoom: int
) -> Iterator[tuple[int, int]]:
    west, south, east, north = bbox
    x0, y0 = tile_of(west, north, zoom)
    x1, y1 = tile_of(east, south, zoom)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


def tile_side_km(lat: float, zoom: int) -> float:
    """A tile's side on the ground at a latitude."""
    return EARTH_CIRCUMFERENCE_M * math.cos(math.radians(lat)) / 2**zoom / 1000


# --- Outlines -----------------------------------------------------------------

Ring = list[tuple[float, float]]


def outline_rings(geojson: dict) -> list[Ring]:
    """The outer rings of every polygon in a GeoJSON (holes ignored)."""
    rings: list[Ring] = []

    def add(geometry: dict) -> None:
        kind = geometry.get("type")
        if kind == "Polygon":
            rings.append([(c[0], c[1]) for c in geometry["coordinates"][0]])
        elif kind == "MultiPolygon":
            for polygon in geometry["coordinates"]:
                rings.append([(c[0], c[1]) for c in polygon[0]])
        elif kind == "GeometryCollection":
            for g in geometry["geometries"]:
                add(g)

    if geojson.get("type") == "FeatureCollection":
        for feature in geojson["features"]:
            add(feature["geometry"])
    elif geojson.get("type") == "Feature":
        add(geojson["geometry"])
    else:
        add(geojson)
    return rings


def rings_bbox(rings: list[Ring]) -> tuple[float, float, float, float]:
    lons = [p[0] for r in rings for p in r]
    lats = [p[1] for r in rings for p in r]
    return min(lons), min(lats), max(lons), max(lats)


def point_in_rings(lon: float, lat: float, rings: list[Ring]) -> bool:
    """Ray casting over every ring (holes ignored)."""
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (
                yj - yi
            ) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def box_touches_rings(
    box: tuple[float, float, float, float], rings: list[Ring]
) -> bool:
    """Whether a box overlaps the outline: a corner or the centre inside it, or a
    vertex of the outline inside the box (enough for tiles and 1° cells)."""
    west, south, east, north = box
    points = [
        (west, south),
        (west, north),
        (east, south),
        (east, north),
        ((west + east) / 2, (south + north) / 2),
    ]
    if any(point_in_rings(x, y, rings) for x, y in points):
        return True
    return any(west <= x <= east and south <= y <= north for r in rings for x, y in r)


Segment = tuple[float, float, float, float]


def segment_touches_box(seg: Segment, box: tuple[float, float, float, float]) -> bool:
    """Whether a segment of the outline crosses or lies in a box (Liang-Barsky)."""
    x1, y1, x2, y2 = seg
    west, south, east, north = box
    if (
        max(x1, x2) < west
        or min(x1, x2) > east
        or max(y1, y2) < south
        or min(y1, y2) > north
    ):
        return False
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, x1 - west),
        (dx, east - x1),
        (-dy, y1 - south),
        (dy, north - y1),
    ):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


Block = tuple[int, int, int]  # x, y, size: tiles x..x+size-1, y..y+size-1


def tile_blocks(outlines: list[list[Ring]], zoom: int) -> list[Block]:
    """The tiles of a zoom level inside every outline (e.g. a region and the country
    a source covers), as square blocks. A quadtree from zoom 0: only tiles an
    outline crosses are split (with the segments that cross them); a tile wholly
    inside every outline is one block, however many tiles it holds. France at zoom
    17 (17.8 million tiles) takes seconds and little memory."""
    segments: list[list[Segment]] = [
        [(*a, *b) for ring in rings for a, b in zip(ring, ring[1:] + ring[:1])]
        for rings in outlines
    ]
    out: list[Block] = []

    def visit(x: int, y: int, z: int, segs: list[list[Segment]]) -> None:
        box = tile_bounds(x, y, z)
        west, south, east, north = box
        crossing = []
        for rings, outline_segs in zip(outlines, segs):
            here = [seg for seg in outline_segs if segment_touches_box(seg, box)]
            # Not crossed: wholly inside or wholly outside, the centre says which.
            if not here and not point_in_rings(
                (west + east) / 2, (south + north) / 2, rings
            ):
                return
            crossing.append(here)
        if not any(crossing):
            n = 2 ** (zoom - z)
            out.append((x * n, y * n, n))
            return
        if z == zoom:
            out.append((x, y, 1))
            return
        for cx in (2 * x, 2 * x + 1):
            for cy in (2 * y, 2 * y + 1):
                visit(cx, cy, z + 1, crossing)

    visit(0, 0, 0, segments)
    return out


def block_count(blocks: list[Block]) -> int:
    return sum(n * n for _, _, n in blocks)


def block_tiles(blocks: list[Block], zoom: int) -> Iterator[tuple[int, int, int]]:
    for x0, y0, n in blocks:
        for x in range(x0, x0 + n):
            for y in range(y0, y0 + n):
                yield zoom, x, y


def tiles_in_outline(rings: list[Ring], zoom: int) -> list[tuple[int, int]]:
    """The tiles of a zoom level that overlap the outline."""
    return sorted((x, y) for _, x, y in block_tiles(tile_blocks([rings], zoom), zoom))


def box_ring(bbox: tuple[float, float, float, float]) -> list[Ring]:
    west, south, east, north = bbox
    return [[(west, south), (east, south), (east, north), (west, north)]]


def area_km2(rings: list[Ring]) -> float:
    """Approximate area of the outline (shoelace on an equirectangular projection)."""
    total = 0.0
    for ring in rings:
        lat0 = sum(p[1] for p in ring) / len(ring)
        kx = 111.32 * math.cos(math.radians(lat0))
        s = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            s += (x1 * kx) * (y2 * 110.57) - (x2 * kx) * (y1 * 110.57)
        total += abs(s) / 2
    return total


# --- What each tier needs -----------------------------------------------------


def world_overview_tiles() -> list[tuple[int, int, int]]:
    """Every tile of the world to zoom 8."""
    return [
        (z, x, y)
        for z in range(TIERS["overview"][1] + 1)
        for x in range(2**z)
        for y in range(2**z)
    ]


def overview_tiles(rings: list[Ring]) -> list[tuple[int, int, int]]:
    """The world to zoom 5, then the region's bounding box to zoom 8."""
    out = [
        (z, x, y)
        for z in range(WORLD_OVERVIEW_ZOOM + 1)
        for x in range(2**z)
        for y in range(2**z)
    ]
    box = rings_bbox(rings)
    for z in range(WORLD_OVERVIEW_ZOOM + 1, TIERS["overview"][1] + 1):
        out += [(z, x, y) for x, y in tiles_in_bbox(box, z)]
    return out


def worldcover_cells(rings: list[Ring]) -> list[str]:
    """The 1°×1° cells of the composite that touch the outline ("N49E006": the cell
    whose south-west corner is 49°N 6°E)."""
    west, south, east, north = rings_bbox(rings)
    cells = []
    for lat in range(math.floor(south), math.floor(north) + 1):
        for lon in range(math.floor(west), math.floor(east) + 1):
            if box_touches_rings((lon, lat, lon + 1, lat + 1), rings):
                ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
                ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
                cells.append(ns + ew)
    return cells


def world_cells(cache: Path) -> list[str]:
    """Every cell of the composite (land only), found once by asking for each 1°
    cell (in parallel; a few minutes) and kept in `cache`."""
    if cache.exists():
        return json.loads(cache.read_text())
    names = [
        f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
        for lat in WORLDCOVER_LATITUDES
        for lon in range(-180, 180)
    ]
    print(
        f"  Finding the composite's cells ({len(names):,} to check)...", file=sys.stderr
    )
    with ThreadPoolExecutor(max_workers=32) as pool:
        found = [c for c, ok in zip(names, pool.map(cell_exists, names)) if ok]
    cache.write_text(json.dumps(found))
    return found


def worldcover_url(cell: str) -> str:
    return WORLDCOVER_URL.format(lat_name=cell[:3], cell=cell)


def estimate(
    rings: list[Ring], regional_maxzoom: int = 12, detailed_maxzoom: int = 16
) -> dict:
    """Tiles, output size and download per tier (bytes), for the build script's menu."""
    area = area_km2(rings)
    lat = (rings_bbox(rings)[1] + rings_bbox(rings)[3]) / 2

    def tiles(minzoom: int, maxzoom: int) -> int:
        return int(
            sum(
                area / tile_side_km(lat, z) ** 2 + 1
                for z in range(minzoom, maxzoom + 1)
            )
        )

    overview = len(overview_tiles(rings))
    regional = tiles(TIERS["regional"][0], regional_maxzoom)
    detailed = tiles(TIERS["detailed"][0], detailed_maxzoom)
    return {
        "area_km2": round(area),
        "overview": {
            "tiles": overview,
            "bytes": overview * AVERAGE_TILE_BYTES["overview"],
        },
        "world_overview": {
            "tiles": len(world_overview_tiles()),
            "bytes": WORLD_OVERVIEW_BYTES,
        },
        # Sentinel-2 for the whole world, by max zoom: kept, and read from ESA.
        "world_regional": {
            str(z): {
                "bytes": WORLD_LAND_KM2 * REGIONAL_BYTES_PER_KM2[z],
                "download": WORLD_LAND_KM2 * WORLDCOVER_BYTES_PER_KM2[z],
            }
            for z in range(9, 14)
        },
        "regional": {
            "tiles": regional,
            "bytes": regional * AVERAGE_TILE_BYTES["regional"],
            "download": int(
                area * WORLDCOVER_BYTES_PER_KM2[13 if regional_maxzoom >= 13 else 12]
            ),
        },
        "detailed": {
            "tiles": detailed,
            "bytes": detailed * AVERAGE_TILE_BYTES["detailed"],
        },
        # Size of the detailed tier for each max zoom the build script offers.
        "detailed_by_zoom": {
            str(z): tiles(TIERS["detailed"][0], z) * AVERAGE_TILE_BYTES["detailed"]
            for z in (15, 16, 17)
        },
    }


# --- Writing tiles ------------------------------------------------------------


class MBTiles:
    """A minimal MBTiles writer (rows in TMS order, as the format wants)."""

    def __init__(
        self,
        path: Path,
        name: str,
        fmt: str,
        minzoom: int,
        maxzoom: int,
        attribution: str,
        bounds,
        resume: bool = False,
    ):
        # An interrupted download goes on where it stopped (resume=True).
        resuming = resume and path.exists()
        if not resuming:
            path.unlink(missing_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.pending = 0
        if resuming:
            return
        self.db.executescript(
            "CREATE TABLE metadata (name text, value text);"
            "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);"
            "CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);"
        )
        meta = {
            "name": name,
            "format": fmt,
            "type": "baselayer",
            "minzoom": str(minzoom),
            "maxzoom": str(maxzoom),
            "attribution": attribution,
            "bounds": ",".join(f"{v:.5f}" for v in bounds),
        }
        self.db.executemany("INSERT INTO metadata VALUES (?, ?)", meta.items())

    def put(self, z: int, x: int, y: int, data: bytes) -> None:
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)",
                (z, x, 2**z - 1 - y, data),
            )
            # Saved as it goes, so stopping loses little.
            self.pending += 1
            if self.pending >= 500:
                self.db.commit()
                self.pending = 0

    def delete(self, z: int, x: int, y: int) -> None:
        with self.lock:
            self.db.execute(
                "DELETE FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                (z, x, 2**z - 1 - y),
            )

    def has(self, z: int) -> set[tuple[int, int]]:
        """The tiles of a zoom level already there (x, y), to skip on a resume."""
        with self.lock:
            rows = self.db.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?", (z,)
            )
            return {(x, 2**z - 1 - row) for x, row in rows}

    def close(self) -> None:
        self.db.commit()
        self.db.close()


def fetch(url: str, retries: int = 4) -> bytes | None:
    """A tile, or None if the server has none there (404)."""
    for attempt in range(retries):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            if attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError):
            if attempt == retries - 1:
                raise
        time.sleep(2**attempt)
    return None


def download_tiles(
    tiles: Iterable[tuple[int, int, int]],
    url: str | Callable[[int, int, int], str],
    out: MBTiles,
    threads: int,
    per_second: float | None = None,
    progress: Callable[[int, int], None] | None = None,
    total: int | None = None,
    skip: Callable[[int, int, int], bool] | None = None,
    drop_repeated: bool = False,
) -> int:
    """Fetch tiles into an MBTiles file; returns how many there were. `url` is a
    template ({z} {x} {y}) or a function of z, x, y (WMS); `skip` says which are
    already there. Tiles are read lazily, so a huge list never sits in memory.
    drop_repeated: a small tile met twice byte for byte is a server's "no data"
    tile (white or empty outside its area), not imagery: none of them are kept,
    so they don't hide the imagery below."""
    if total is None:
        tiles = list(tiles)
        total = len(tiles)
    done = 0
    found = 0
    lock = threading.Lock()
    interval = 1.0 / per_second if per_second else 0.0
    next_slot = [time.monotonic()]
    # Small tiles seen once (where they are) or repeated (None: never kept).
    small: dict[bytes, tuple[int, int, int] | None] = {}

    def one(tile: tuple[int, int, int]) -> None:
        nonlocal done, found
        z, x, y = tile
        if skip and skip(z, x, y):
            with lock:
                done += 1
                found += 1
            return
        if interval:
            with lock:
                wait = next_slot[0] - time.monotonic()
                next_slot[0] = max(next_slot[0], time.monotonic()) + interval
            if wait > 0:
                time.sleep(wait)
        data = fetch(
            url.format(z=z, x=x, y=y) if isinstance(url, str) else url(z, x, y)
        )
        with lock:
            done += 1
            if data and drop_repeated and len(data) < SMALL_TILE:
                key = hashlib.md5(data).digest()
                if key in small:
                    first = small[key]
                    if first:
                        out.delete(*first)
                        found -= 1
                        small[key] = None
                    data = None
                else:
                    small[key] = (z, x, y)
            if data:
                found += 1
                out.put(z, x, y, data)
            if progress and (done % 200 == 0 or done == total):
                progress(done, total)

    # In chunks: Executor.map would queue every tile at once.
    with ThreadPoolExecutor(max_workers=threads) as pool:
        chunk: list[tuple[int, int, int]] = []
        for tile in tiles:
            chunk.append(tile)
            if len(chunk) >= 5000:
                list(pool.map(one, chunk))
                chunk = []
        list(pool.map(one, chunk))
    return found


# --- Docker helpers -------------------------------------------------------------


def docker_run(
    image: str, workdir: Path, args: list[str], env: dict[str, str] | None = None
) -> None:
    command = [
        "docker",
        "run",
        "--rm",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-v",
        f"{workdir}:/w:z",
        "-w",
        "/w",
    ]
    for key, value in (env or {}).items():
        command += ["-e", f"{key}={value}"]
    subprocess.run(command + [image] + args, check=True, stdin=subprocess.DEVNULL)


def to_pmtiles(mbtiles: Path, out: Path, pmtiles_image: str) -> None:
    """MBTiles -> PMTiles, with the basemap service's pmtiles CLI."""
    workdir = mbtiles.parent
    docker_run(
        pmtiles_image, workdir, ["convert", f"/w/{mbtiles.name}", f"/w/{out.name}.tmp"]
    )
    (workdir / f"{out.name}.tmp").replace(out)


def regional_pipeline(maxzoom: int, cut: bool = True) -> str:
    """The GDAL commands (run in the GDAL image) that turn the composite cells
    (listed in cells.txt) into web tiles: mosaic, reproject and cut to the outline
    (or the whole world), scale the 16-bit reflectance to 8-bit (one fixed curve
    for every cell, so tiles match), tile, add lower zooms."""
    resolution = EARTH_CIRCUMFERENCE_M / 256 / 2**maxzoom
    # Many cells (the world): their list in a file, not on the command line.
    sources = "-input_file_list cells.txt"
    levels = " ".join(str(2**i) for i in range(1, maxzoom - TIERS["regional"][0] + 1))
    scale = " ".join(f"-scale_{b} 0 2200 0 255 -exponent_{b} 0.7" for b in (1, 2, 3))
    return " && ".join(
        [
            f"gdalbuildvrt -q src.vrt {sources}",
            (
                f"gdalwarp -q -of VRT -t_srs EPSG:3857 -tr {resolution} {resolution} -r bilinear "
                + (
                    "-cutline area.geojson -crop_to_cutline "
                    if cut
                    else "-te -20037508.34 -20037508.34 20037508.34 20037508.34 "
                )
                + "-dstalpha -overwrite src.vrt warped.vrt"
            ),
            (
                f"gdal_translate -q -of MBTILES -b 1 -b 2 -b 3 -b 5 -ot Byte {scale} -scale_4 0 65535 0 255 "
                "-co TILE_FORMAT=WEBP -co QUALITY=75 -co ZOOM_LEVEL_STRATEGY=LOWER warped.vrt regional.mbtiles"
            ),
        ]
        + ([f"gdaladdo -q -r average regional.mbtiles {levels}"] if levels else [])
    )


def cell_exists(cell: str) -> bool:
    """The composite has no cells over open sea."""
    request = urllib.request.Request(
        worldcover_url(cell), method="HEAD", headers={"User-Agent": USER_AGENT}
    )
    try:
        with urllib.request.urlopen(request, timeout=30):
            return True
    except urllib.error.HTTPError:
        return False


# --- Commands -----------------------------------------------------------------


def load_rings(path: str) -> list[Ring]:
    rings = outline_rings(json.loads(Path(path).read_text()))
    if not rings:
        sys.exit(f"No polygon in {path}")
    return rings


def print_progress(done: int, total: int) -> None:
    print(f"\r  {done:,}/{total:,} tiles", end="", file=sys.stderr, flush=True)
    if done == total:
        print(file=sys.stderr)


def command_estimate(args) -> None:
    print(
        json.dumps(
            estimate(
                load_rings(args.outline), args.regional_maxzoom, args.detailed_maxzoom
            )
        )
    )


def command_overview(args) -> None:
    if args.world:
        tiles, bbox = world_overview_tiles(), WORLD_BBOX
    elif args.outline:
        rings = load_rings(args.outline)
        tiles, bbox = overview_tiles(rings), rings_bbox(rings)
    else:
        sys.exit("overview needs --outline or --world")
    out = Path(args.out).resolve()
    minzoom, maxzoom, _fmt, attribution = TIERS["overview"]
    mbtiles = out.with_suffix(".mbtiles")
    writer = MBTiles(mbtiles, "Blue Marble", "jpg", minzoom, maxzoom, attribution, bbox)
    found = download_tiles(tiles, GIBS_URL, writer, threads=8, progress=print_progress)
    writer.close()
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


def command_regional(args) -> None:
    out = Path(args.out).resolve()
    if args.world:
        cells = world_cells(out.parent / ".worldcover-cells.json")
    elif args.outline:
        rings = load_rings(args.outline)
        with ThreadPoolExecutor(max_workers=16) as pool:
            names = worldcover_cells(rings)
            cells = [c for c, ok in zip(names, pool.map(cell_exists, names)) if ok]
    else:
        sys.exit("regional needs --outline or --world")
    if not cells:
        sys.exit("The Sentinel-2 composite has nothing over this region.")
    print(f"  {len(cells)} cells of the Sentinel-2 composite", file=sys.stderr)
    with tempfile.TemporaryDirectory(dir=out.parent, prefix=".satellite-") as tmp:
        work = Path(tmp)
        (work / "cells.txt").write_text(
            "".join(f"/vsicurl/{worldcover_url(c)}\n" for c in cells)
        )
        if not args.world:
            (work / "area.geojson").write_text(Path(args.outline).read_text())
        env = {
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
            "GDAL_HTTP_MULTIRANGE": "YES",
            "GDAL_HTTP_MAX_RETRY": "5",
            "GDAL_HTTP_RETRY_DELAY": "3",
            "VSI_CACHE": "TRUE",
            "GDAL_CACHEMAX": "1024",
        }
        docker_run(
            args.gdal_image,
            work,
            ["sh", "-c", regional_pipeline(args.maxzoom, cut=not args.world)],
            env,
        )
        to_pmtiles(work / "regional.mbtiles", work / out.name, args.pmtiles_image)
        (work / out.name).replace(out)
    print(f"-> {out}")


def detailed_outlines(args, source: dict) -> list[list[Ring]]:
    """What to cover: the area asked for, the region the source covers (--clip),
    and the source's own limit."""
    outlines = [load_rings(args.outline)]
    if getattr(args, "clip", None):
        outlines.append(load_rings(args.clip))
    if "bbox" in source:
        outlines.append(box_ring(source["bbox"]))
    return outlines


def detailed_estimate(outlines: list[list[Ring]], source: dict) -> dict:
    """Tiles and bytes from zoom 14 up to 15, 16, 17 (as far as the source goes)."""
    minzoom = TIERS["detailed"][0]
    counts = {
        z: block_count(tile_blocks(outlines, z))
        for z in range(minzoom, source["maxzoom"] + 1)
    }
    return {
        str(top): {
            "tiles": sum(counts[z] for z in range(minzoom, top + 1)),
            "bytes": sum(counts[z] for z in range(minzoom, top + 1)) * source["bytes"],
        }
        for top in range(15, source["maxzoom"] + 1)
    }


def command_sources(args) -> None:
    """The high-resolution sources (JSON), for the scripts' menus."""
    print(
        json.dumps(
            [
                {
                    k: detailed_source(i)[k]
                    for k in (
                        "id",
                        "name",
                        "regions",
                        "resolution",
                        "maxzoom",
                        "attribution",
                    )
                }
                for i in DETAILED_SOURCES
            ]
        )
    )


def command_estimate_detailed(args) -> None:
    source = detailed_source(args.source)
    print(json.dumps(detailed_estimate(detailed_outlines(args, source), source)))


def command_detailed(args) -> None:
    source = detailed_source(args.source)
    outlines = detailed_outlines(args, source)
    maxzoom = min(args.maxzoom, source["maxzoom"])
    out = Path(args.out).resolve()
    minzoom = TIERS["detailed"][0]
    blocks = {z: tile_blocks(outlines, z) for z in range(minzoom, maxzoom + 1)}
    total = sum(block_count(b) for b in blocks.values())
    print(
        f"  {source['name']}: {total:,} tiles, zoom {minzoom} to {maxzoom}",
        file=sys.stderr,
    )
    mbtiles = out.with_suffix(".mbtiles")
    # A download stopped half-way goes on from there.
    writer = MBTiles(
        mbtiles,
        source["name"],
        source["format"],
        minzoom,
        maxzoom,
        source["attribution"],
        rings_bbox(outlines[0]),
        resume=True,
    )
    done: dict[int, set[tuple[int, int]]] = {}

    def skip(z: int, x: int, y: int) -> bool:
        if z not in done:
            done.clear()
            done[z] = writer.has(z)
        return (x, y) in done[z]

    found = download_tiles(
        (t for z in range(minzoom, maxzoom + 1) for t in block_tiles(blocks[z], z)),
        lambda z, x, y: tile_url(source, z, x, y),
        writer,
        threads=4,
        per_second=source["per_second"],
        progress=print_progress,
        total=total,
        skip=skip,
        drop_repeated=True,
    )
    writer.close()
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


# --- Choosing what to download (the scripts' questions) -----------------------


class Index:
    """Geofabrik's index of regions: names, parents and outlines."""

    def __init__(self, path: str | None):
        self.features: dict[str, dict] = {}
        if path and Path(path).exists():
            for f in json.loads(Path(path).read_text())["features"]:
                self.features[f["properties"]["id"]] = f

    def name(self, region: str) -> str:
        if region == "world":
            return "the whole world"
        return self.features.get(region, {}).get("properties", {}).get("name", region)

    def within(self, region: str, parent: str) -> bool:
        while region:
            if region == parent:
                return True
            region = self.features.get(region, {}).get("properties", {}).get("parent")
        return False

    def outline(self, region: str, folder: Path) -> Path | None:
        """The region's outline as a file in `folder` (written from the index)."""
        path = folder / f".area-{region}.geojson"
        if not path.exists():
            geometry = self.features.get(region, {}).get("geometry")
            if not geometry:
                return None
            path.write_text(json.dumps(geometry))
        return path

    def search(self, text: str) -> list[tuple[str, str, str]]:
        """(id, name, parent's name) of the regions matching a name, best first."""
        text = text.lower().strip()
        hits = [
            f["properties"]
            for f in self.features.values()
            if f.get("geometry")
            and (
                text in f["properties"]["id"].lower()
                or text in f["properties"]["name"].lower()
            )
        ]
        hits.sort(key=lambda r: (r["name"].lower() != text, r["name"]))
        return [
            (
                r["id"],
                r["name"],
                self.name(r.get("parent", "")) if r.get("parent") else "",
            )
            for r in hits[:15]
        ]


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1000 or unit == "TB":
            return (
                f"{n:.0f} {unit}"
                if unit in ("B", "KB", "MB") or n >= 10
                else f"{n:.1f} {unit}"
            )
        n /= 1000
    return ""


def duration(seconds: float) -> str:
    hours = seconds / 3600
    if hours < 1:
        return f"{max(1, round(seconds / 60))} min"
    if hours < 48:
        return f"{hours:.0f} h"
    return f"{hours / 24:.0f} days"


def sources_for(area: str, index: Index) -> list[str]:
    """The high-resolution sources that cover part of an area."""
    return [
        i
        for i, src in DETAILED_SOURCES.items()
        if area == "world"
        or any(index.within(area, r) or index.within(r, area) for r in src["regions"])
    ]


def detailed_job(source_id: str, area: str, index: Index, folder: Path) -> dict | None:
    """What one source downloads for an area: the area, cut to the source's region."""
    region = DETAILED_SOURCES[source_id]["regions"][0]
    clip = index.outline(region, folder)
    if not clip:
        return None
    if area == "world" or index.within(region, area):
        return {"source": source_id, "outline": str(clip), "clip": None}
    outline = index.outline(area, folder)
    return outline and {"source": source_id, "outline": str(outline), "clip": str(clip)}


def job_estimate(job: dict) -> dict:
    source = detailed_source(job["source"])
    outlines = [load_rings(job["outline"])]
    if job["clip"]:
        outlines.append(load_rings(job["clip"]))
    if "bbox" in source:
        outlines.append(box_ring(source["bbox"]))
    return detailed_estimate(outlines, source)


def ask(prompt: str, choices: Iterable[str], default: str) -> str:
    choices = list(choices)
    while True:
        print(f"    {prompt} ", end="", file=sys.stderr, flush=True)
        line = sys.stdin.readline()
        if not line:
            sys.exit("Aborted.")
        answer = line.strip() or default
        if answer in choices:
            return answer


def say(text: str = "") -> None:
    print(f"    {text}" if text else "", file=sys.stderr)


def command_choose(args) -> None:
    """Ask what to download (or take the presets) and write the plan (JSON)."""
    folder = Path(args.basemap_dir)
    folder.mkdir(parents=True, exist_ok=True)
    index = Index(args.index)
    region = args.region
    plan: dict = {"world_overview": False, "regional": None, "detailed": []}

    def regional_for(area: str, zoom: int) -> dict | None:
        if area == "world":
            return {"area": "world", "outline": None, "maxzoom": zoom}
        outline = index.outline(area, folder)
        return outline and {"area": area, "outline": str(outline), "maxzoom": zoom}

    def finish() -> None:
        plan["world_overview"] = (
            bool(
                plan["world_overview"]
                or plan["regional"]
                or plan["detailed"]
                or args.mode == "overview"
            )
            and not (folder / "world.sat-overview.pmtiles").exists()
        )
        Path(args.plan).write_text(json.dumps(plan, indent=1))

    # Presets (build-region.sh --satellite / --satellite-detailed, satellite.sh --yes).
    if args.mode:
        if args.mode in ("regional", "regional13"):
            area = args.area or region
            default = 10 if area == "world" else 12
            zoom = args.zoom or (13 if args.mode == "regional13" else default)
            plan["regional"] = regional_for(area, zoom)
        if args.detailed and args.detailed != "none":
            for source_id in (
                args.sources.split()
                if args.sources
                else sources_for(args.area or region, index)
            ):
                job = detailed_job(source_id, args.area or region, index, folder)
                if job:
                    plan["detailed"].append(
                        {
                            **job,
                            "area": args.area or region,
                            "maxzoom": int(args.detailed),
                        }
                    )
        finish()
        return

    world_done = (folder / "world.sat-overview.pmtiles").exists()
    say("Satellite imagery: photos of the ground as the map's background (Settings →")
    say("Background → Satellite), kept on this computer so they work offline.")
    say(
        "Zoom 8 shows a whole region on screen, 12 a town, 13 a neighbourhood, 16 a street."
    )
    say("Closer in than its last zoom, imagery is shown stretched (blurry).")
    say()
    if world_done:
        say("The world (NASA Blue Marble, 500 m, to zoom 8): already downloaded.")
    else:
        say(
            f"The world (NASA Blue Marble, 500 m, to zoom 8): {human(WORLD_OVERVIEW_BYTES)}, about an hour,"
        )
        say("downloaded once for every region. It comes with any choice below.")

    # --- Sentinel-2 ---
    say()
    say("Sentinel-2 photos, 10 m (2021, cloud-free), for:")
    region_name = args.region_name or index.name(region)
    region_outline = index.outline(region, folder) if region else None
    options = []
    if region_outline:
        e = estimate(load_rings(str(region_outline)), 13)
        options.append(
            (
                "region",
                f"{region_name} (the region you built)",
                f"+{human(e['regional']['bytes'] / 4)} to zoom 12",
            )
        )
    options += [
        ("other", "Another country or region...", ""),
        ("world", "The whole world", "sizes below"),
        ("none", "None (the world overview only)" if not world_done else "None", ""),
    ]
    for n, (_, label, size) in enumerate(options, 1):
        say(f"  {n}) {label:<42} {size}")
    pick = options[
        int(
            ask(
                f"Choose [1-{len(options)}, default 1]:",
                [str(n) for n in range(1, len(options) + 1)],
                "1",
            )
        )
        - 1
    ][0]
    area = None
    if pick == "region":
        area = region
    elif pick == "other":
        while area is None:
            print(
                "    Country or region name (e.g. spain, bayern, japan): ",
                end="",
                file=sys.stderr,
                flush=True,
            )
            text = sys.stdin.readline().strip()
            if not text:
                break
            hits = index.search(text)
            if not hits:
                say("Nothing by that name; try another.")
                continue
            for n, (_, name, parent) in enumerate(hits, 1):
                say(f"  {n:>2}) {name}" + (f" ({parent})" if parent else ""))
            answer = ask(
                "Which one? [number, Enter: search again]:",
                [str(n) for n in range(len(hits) + 1)],
                "0",
            )
            if answer != "0":
                area = hits[int(answer) - 1][0]
    elif pick == "world":
        area = "world"
    else:
        # The world overview only.
        plan["world_overview"] = True
        finish()
        return

    if area == "world":
        say()
        say(
            "The whole world (land only), up to which zoom? Made from imagery read from ESA;"
        )
        say("the higher zooms take days to read and process, and need the disk space:")
        for z in range(9, 14):
            kept = WORLD_LAND_KM2 * REGIONAL_BYTES_PER_KM2[z]
            read = WORLD_LAND_KM2 * WORLDCOVER_BYTES_PER_KM2[z]
            say(f"  {z:>2}) zoom {z:<3} {human(kept):>8} kept   (reads ~{human(read)})")
        zoom = int(
            ask(
                "Up to which zoom? [9-13, default 10]:",
                [str(z) for z in range(9, 14)],
                "10",
            )
        )
        plan["regional"] = regional_for("world", zoom)
    elif area:
        e = estimate(load_rings(str(index.outline(area, folder))), 13)
        say()
        say(f"{index.name(area)}, up to which zoom?")
        say(
            f"  12) a town      +{human(e['regional']['bytes'] / 4):>8} kept   (reads ~{human(e['regional']['download'] / 4)} from ESA)"
        )
        say(
            f"  13) a district  +{human(e['regional']['bytes']):>8} kept   (reads ~{human(e['regional']['download'])})"
        )
        plan["regional"] = regional_for(
            area, int(ask("Up to which zoom? [12/13, default 12]:", ["12", "13"], "12"))
        )

    # --- High resolution, by country ---
    target = area or region
    ids = sources_for(target, index) if target else []
    jobs = [j for j in (detailed_job(i, target, index, folder) for i in ids) if j]
    if jobs and not args.no_detailed:
        say()
        say(
            f"Aerial photos at 8 to 60 cm, from national mapping agencies, for {index.name(target)}"
        )
        say(
            "(zoom 14 and up). Fetched tile by tile from their servers, so large areas take long:"
        )
        say(
            "best for a city or a département. Sizes and times are at most: the outlines"
        )
        say(
            "include some sea, which comes back empty (and quick). Working out the sizes..."
        )
        rows = []
        for job in jobs:
            src = detailed_source(job["source"])
            sizes = job_estimate(job)
            rows.append((job, src, sizes))
            cols = "  ".join(
                f"to {z}: {human(v['bytes'])}, {duration(v['tiles'] / src['per_second'])}"
                for z, v in sizes.items()
            )
            say(f"  {len(rows):>2}) {src['name']}, {src['resolution']}")
            say(f"        {cols}")
        print(
            "    Which? [numbers separated by spaces, Enter: none]: ",
            end="",
            file=sys.stderr,
            flush=True,
        )
        chosen = [
            w
            for w in sys.stdin.readline().split()
            if w.isdigit() and 1 <= int(w) <= len(rows)
        ]
        if chosen:
            zoom = int(
                ask(
                    "Up to which zoom? [15/16/17, default 16]:",
                    ["15", "16", "17"],
                    "16",
                )
            )
            for w in dict.fromkeys(chosen):
                job, src, _ = rows[int(w) - 1]
                plan["detailed"].append(
                    {**job, "area": target, "maxzoom": min(zoom, src["maxzoom"])}
                )
    finish()


def command_steps(args) -> None:
    """The plan as commands, one per line: a label, then satellite.py's arguments,
    separated by tabs (for the scripts' timed steps)."""
    plan = json.loads(Path(args.plan).read_text())
    folder = Path(args.basemap_dir)
    index = Index(args.index)
    lines = []
    if plan["world_overview"]:
        lines.append(
            [
                "The world (NASA Blue Marble, to zoom 8; about an hour)",
                "overview",
                "--world",
                "--out",
                str(folder / "world.sat-overview.pmtiles"),
            ]
        )
    r = plan.get("regional")
    if r:
        where = ["--world"] if r["area"] == "world" else ["--outline", r["outline"]]
        lines.append(
            [
                f"Sentinel-2 10 m, {index.name(r['area'])}, to zoom {r['maxzoom']}",
                "regional",
                *where,
                "--maxzoom",
                str(r["maxzoom"]),
                "--out",
                str(folder / f"{r['area']}.sat-regional.pmtiles"),
            ]
        )
    for d in plan["detailed"]:
        src = detailed_source(d["source"])
        clip = ["--clip", d["clip"]] if d["clip"] else []
        lines.append(
            [
                f"{src['name']}, {src['resolution']}, {index.name(d['area'])}, to zoom {d['maxzoom']}",
                "detailed",
                "--source",
                d["source"],
                "--outline",
                d["outline"],
                *clip,
                "--maxzoom",
                str(d["maxzoom"]),
                "--out",
                str(folder / f"{d['area']}.sat-detailed-{d['source']}.pmtiles"),
            ]
        )
    for line in lines:
        print("\t".join(line))


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sources")
    for name in ("choose", "steps"):
        p = sub.add_parser(name)
        p.add_argument("--plan", required=True, help="the plan file (JSON)")
        p.add_argument("--basemap-dir", required=True)
        p.add_argument("--index", help="Geofabrik's index (index-v1.json)")
        if name == "choose":
            p.add_argument("--region", default="", help="the region built")
            p.add_argument("--region-name", default="")
            p.add_argument(
                "--mode",
                choices=("none", "overview", "regional", "regional13"),
                help="no questions: this choice (build-region.sh --satellite)",
            )
            p.add_argument(
                "--area",
                help="with --mode: the area, else the region (an id, or world)",
            )
            p.add_argument(
                "--detailed", help="with --mode: high resolution to this zoom, or none"
            )
            p.add_argument(
                "--zoom",
                type=int,
                choices=range(9, 14),
                help="with --mode regional: Sentinel-2 to this zoom",
            )
            p.add_argument(
                "--sources", help="with --detailed: these sources (else all that apply)"
            )
            p.add_argument(
                "--no-detailed", action="store_true", help="don't offer high resolution"
            )
    for name in ("estimate", "overview", "regional", "detailed", "estimate-detailed"):
        p = sub.add_parser(name)
        p.add_argument(
            "--outline",
            required=name not in ("overview", "regional"),
            help="the region's outline (GeoJSON)",
        )
        if name in ("overview", "regional"):
            p.add_argument("--world", action="store_true", help="the whole world")
        if name in ("detailed", "estimate-detailed"):
            p.add_argument(
                "--source", choices=sorted(DETAILED_SOURCES), default="fr_ign"
            )
            p.add_argument(
                "--clip", help="also inside this outline (the source's country)"
            )
        if name not in ("estimate", "estimate-detailed"):
            p.add_argument("--out", required=True, help="the PMTiles file to write")
            p.add_argument("--pmtiles-image", default="protomaps/go-pmtiles:v1.28.0")
        if name == "regional":
            p.add_argument(
                "--maxzoom", type=int, choices=(9, 10, 11, 12, 13), default=12
            )
            p.add_argument("--gdal-image", default=GDAL_IMAGE)
        if name == "detailed":
            p.add_argument("--maxzoom", type=int, choices=(15, 16, 17), default=16)
        if name == "estimate":
            p.add_argument("--regional-maxzoom", type=int, default=12)
            p.add_argument("--detailed-maxzoom", type=int, default=16)
    args = parser.parse_args(list(argv) if argv is not None else None)
    {
        "estimate": command_estimate,
        "overview": command_overview,
        "regional": command_regional,
        "detailed": command_detailed,
        "sources": command_sources,
        "estimate-detailed": command_estimate_detailed,
        "choose": command_choose,
        "steps": command_steps,
    }[args.command](args)


if __name__ == "__main__":
    main()
