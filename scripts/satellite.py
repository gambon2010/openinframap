#!/usr/bin/env python3
"""
Offline satellite imagery for the built region, in three tiers (one PMTiles file
each, in data/basemap/, served by the `basemap` Compose service like the offline
background map). Run by scripts/build-region.sh; see docs/plans/satellite-imagery.md.

  overview   zoom 0-8   NASA Blue Marble Next Generation (NASA GIBS, 500 m):
                        the world to zoom 5, the region's bounding box to zoom 8.
  regional   zoom 9-12  Sentinel-2 10 m yearly composite (ESA WorldCover 2021,
             (or 13)    CC BY 4.0), read straight from the public COGs with GDAL
                        (only the needed parts are downloaded), cut to the region.
  detailed   zoom 14-17 IGN orthophotos, 20 cm (France only, Licence Ouverte),
                        from the Géoplateforme WMTS, cut to the region; throttled.

    python3 scripts/satellite.py estimate --outline AREA.geojson
    python3 scripts/satellite.py overview --outline AREA.geojson --out FILE.pmtiles
    python3 scripts/satellite.py regional --outline AREA.geojson --out FILE.pmtiles [--maxzoom 13]
    python3 scripts/satellite.py detailed --outline AREA.geojson --out FILE.pmtiles [--maxzoom 16]

The outline is the region's GeoJSON (Geofabrik's, as for the background map). GDAL
and pmtiles run in Docker (GDAL_IMAGE, and the basemap service's image).
Standard library only.
"""

from __future__ import annotations

import argparse
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

# Average tile sizes measured on Luxembourg and Alsace (bytes), for estimates.
AVERAGE_TILE_BYTES = {"overview": 6_500, "regional": 9_000, "detailed": 22_000}
# Bytes read from the 10 m composite per km² (RGBN, deflate): full resolution for
# zoom 13, the 20 m overview for zoom 12 and below.
WORLDCOVER_BYTES_PER_KM2 = {13: 70_000, 12: 18_000}

EARTH_CIRCUMFERENCE_M = 40_075_016.686


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


def tiles_in_outline(rings: list[Ring], zoom: int) -> list[tuple[int, int]]:
    return [
        (x, y)
        for x, y in tiles_in_bbox(rings_bbox(rings), zoom)
        if box_touches_rings(tile_bounds(x, y, zoom), rings)
    ]


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
    ):
        path.unlink(missing_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
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
    tiles: list[tuple[int, int, int]],
    url: str,
    out: MBTiles,
    threads: int,
    per_second: float | None = None,
    progress: Callable[[int, int], None] | None = None,
) -> int:
    """Fetch tiles into an MBTiles file; returns how many there were."""
    done = 0
    found = 0
    lock = threading.Lock()
    interval = 1.0 / per_second if per_second else 0.0
    next_slot = [time.monotonic()]

    def one(tile: tuple[int, int, int]) -> None:
        nonlocal done, found
        if interval:
            with lock:
                wait = next_slot[0] - time.monotonic()
                next_slot[0] = max(next_slot[0], time.monotonic()) + interval
            if wait > 0:
                time.sleep(wait)
        z, x, y = tile
        data = fetch(url.format(z=z, x=x, y=y))
        with lock:
            done += 1
            if data:
                found += 1
                out.put(z, x, y, data)
            if progress and (done % 200 == 0 or done == len(tiles)):
                progress(done, len(tiles))

    with ThreadPoolExecutor(max_workers=threads) as pool:
        list(pool.map(one, tiles))
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


def regional_pipeline(cells: list[str], maxzoom: int) -> str:
    """The GDAL commands (run in the GDAL image) that turn the composite cells into
    web tiles: mosaic, reproject and cut to the outline, scale the 16-bit reflectance
    to 8-bit (one fixed curve for every cell, so tiles match), tile, add lower zooms."""
    resolution = EARTH_CIRCUMFERENCE_M / 256 / 2**maxzoom
    sources = " ".join(f"/vsicurl/{worldcover_url(c)}" for c in cells)
    levels = " ".join(str(2**i) for i in range(1, maxzoom - TIERS["regional"][0] + 1))
    scale = " ".join(f"-scale_{b} 0 2200 0 255 -exponent_{b} 0.7" for b in (1, 2, 3))
    return " && ".join(
        [
            f"gdalbuildvrt -q src.vrt {sources}",
            (
                f"gdalwarp -q -of VRT -t_srs EPSG:3857 -tr {resolution} {resolution} -r bilinear "
                "-cutline area.geojson -crop_to_cutline -dstalpha -overwrite src.vrt warped.vrt"
            ),
            (
                f"gdal_translate -q -of MBTILES -b 1 -b 2 -b 3 -b 5 -ot Byte {scale} -scale_4 0 65535 0 255 "
                "-co TILE_FORMAT=WEBP -co QUALITY=75 -co ZOOM_LEVEL_STRATEGY=LOWER warped.vrt regional.mbtiles"
            ),
            f"gdaladdo -q -r average regional.mbtiles {levels}",
        ]
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
    rings = load_rings(args.outline)
    out = Path(args.out).resolve()
    tiles = overview_tiles(rings)
    minzoom, maxzoom, _fmt, attribution = TIERS["overview"]
    mbtiles = out.with_suffix(".mbtiles")
    writer = MBTiles(
        mbtiles, "Blue Marble", "jpg", minzoom, maxzoom, attribution, rings_bbox(rings)
    )
    found = download_tiles(tiles, GIBS_URL, writer, threads=8, progress=print_progress)
    writer.close()
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


def command_regional(args) -> None:
    rings = load_rings(args.outline)
    out = Path(args.out).resolve()
    cells = [c for c in worldcover_cells(rings) if cell_exists(c)]
    if not cells:
        sys.exit("The Sentinel-2 composite has nothing over this region.")
    print(
        f"  {len(cells)} cells of the Sentinel-2 composite: {', '.join(cells)}",
        file=sys.stderr,
    )
    with tempfile.TemporaryDirectory(dir=out.parent, prefix=".satellite-") as tmp:
        work = Path(tmp)
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
            ["sh", "-c", regional_pipeline(cells, args.maxzoom)],
            env,
        )
        to_pmtiles(work / "regional.mbtiles", work / out.name, args.pmtiles_image)
        (work / out.name).replace(out)
    print(f"-> {out}")


def command_detailed(args) -> None:
    rings = load_rings(args.outline)
    out = Path(args.out).resolve()
    minzoom = TIERS["detailed"][0]
    tiles = [
        (z, x, y)
        for z in range(minzoom, args.maxzoom + 1)
        for x, y in tiles_in_outline(rings, z)
    ]
    mbtiles = out.with_suffix(".mbtiles")
    writer = MBTiles(
        mbtiles,
        "IGN orthophotos",
        "jpg",
        minzoom,
        args.maxzoom,
        TIERS["detailed"][3],
        rings_bbox(rings),
    )
    # Géoplateforme fair use: a few requests at a time, at most 20 a second.
    found = download_tiles(
        tiles, IGN_URL, writer, threads=4, per_second=20, progress=print_progress
    )
    writer.close()
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    for name in ("estimate", "overview", "regional", "detailed"):
        p = sub.add_parser(name)
        p.add_argument(
            "--outline", required=True, help="the region's outline (GeoJSON)"
        )
        if name != "estimate":
            p.add_argument("--out", required=True, help="the PMTiles file to write")
            p.add_argument("--pmtiles-image", default="protomaps/go-pmtiles:v1.28.0")
        if name == "regional":
            p.add_argument("--maxzoom", type=int, choices=(12, 13), default=12)
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
    }[args.command](args)


if __name__ == "__main__":
    main()
