"""Fork: offline maps. An area's terrain (elevations, for the map's contour lines,
hill shading and 3D relief: docs/plans/terrain.md), cut out of Mapterhorn's terrain
tiles into data/map/offline-maps/<area>.terrain.pmtiles.

Mapterhorn (https://mapterhorn.com) publishes the world's terrain as PMTiles:
512-pixel tiles of elevations, Terrarium encoded, lossless WebP; in France IGN's RGE
ALTI and LiDAR HD, elsewhere mostly Copernicus' 30 m. Zooms 0 to 12 are in one world
file, the finer zooms in a file per zoom 6 tile, all listed with their bounds in
download_urls.json. An area's terrain is its outline cut out of each file it
touches, up to zoom 13 (6.6 m in France: enough for the relief and the radio mode
planned), merged into one file.

It isn't an offline map of its own: it comes with an area's background map
(extract.py), always."""

from __future__ import annotations

import json
import subprocess
import sys
import urllib.request
from pathlib import Path

import netsafe

from . import docker, ui
from .pmtiles import read_header

LISTING_URL = "https://download.mapterhorn.com/download_urls.json"
# The pmtiles program with merge (go-pmtiles 1.31; extract.py's is older).
PMTILES_IMAGE = "protomaps/go-pmtiles:v1.31.2"
TERRAIN = ".terrain.pmtiles"
# Its finest zoom: 6.6 m pixels in France (512-pixel tiles).
MAX_ZOOM = 13
CREDIT = "Mapterhorn; IGN; Copernicus"
# What it weighs per km² of an area's outline, to zoom 13 (France, 2026-11-20:
# 5.6 GB for its 775,000 km² outline, sea margins included; hilly Luxembourg
# twice as much per km²).
BYTES_PER_KM2 = 7_200


def terrain_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{TERRAIN}"


def terrain_missing(folder: Path, area: str) -> bool:
    """Whether an area has a background map but no terrain (or only a partial one)."""
    if area == "world" or not (folder / f"{area}.pmtiles").exists():
        return False
    header = read_header(terrain_of(folder, area))
    return not header or header.maxzoom < MAX_ZOOM


def listing() -> list[dict]:
    """Mapterhorn's files: name, url, md5sum, size, bounds, min_zoom, max_zoom."""

    def get() -> bytes:
        request = urllib.request.Request(
            LISTING_URL, headers={"User-Agent": netsafe.USER_AGENT}
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.read()

    return json.loads(netsafe.safely(get, LISTING_URL, retries=2))["items"]


def outline_bounds(outline: Path) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a GeoJSON outline (a geometry or a feature)."""
    data = json.loads(outline.read_text())
    geometry = data.get("geometry", data)
    points = list(flatten(geometry["coordinates"]))
    lons = [lon for lon, _ in points]
    lats = [lat for _, lat in points]
    return min(lons), min(lats), max(lons), max(lats)


def flatten(coordinates) -> list[tuple[float, float]]:
    """Every [lon, lat] in nested GeoJSON coordinates."""
    if coordinates and isinstance(coordinates[0], (int, float)):
        return [(coordinates[0], coordinates[1])]
    return [point for part in coordinates for point in flatten(part)]


def files_for(
    items: list[dict], bounds: tuple[float, float, float, float]
) -> list[dict]:
    """The files holding an area's terrain up to MAX_ZOOM: those whose bounds meet
    its box (the world file always does)."""
    west, south, east, north = bounds

    def meets(item: dict) -> bool:
        return (
            item["min_lon"] < east
            and item["max_lon"] > west
            and item["min_lat"] < north
            and item["max_lat"] > south
        )

    return [i for i in items if i["min_zoom"] <= MAX_ZOOM and meets(i)]


def pmtiles(folder: Path, args: list[str], **options) -> subprocess.CompletedProcess:
    """The pmtiles program (Docker), the offline maps' folder at /out."""
    return docker.run(PMTILES_IMAGE, args, folder, at="/out", **options)


def extract_args(url: str, outline: Path, out: str) -> list[str]:
    return [
        "extract",
        url,
        out,
        f"--region=/out/{outline.name}",
        f"--maxzoom={MAX_ZOOM}",
    ]


def make_terrain(folder: Path, area: str, outline: Path) -> None:
    """Cut the area out of each file it touches (a part each: those holding
    nothing of it dropped), then merge the parts into <area>.terrain.pmtiles."""
    items = files_for(listing(), outline_bounds(outline))
    parts = []
    for n, item in enumerate(items, 1):
        part = folder / f".{area}.terrain-{n}.pmtiles"
        print(f"  terrain {n}/{len(items)}: {item['name']}", file=sys.stderr)
        cut_out(folder, item["url"], outline, part)
        if holds_tiles(part):
            parts.append(part)
        else:
            part.unlink(missing_ok=True)
    out = terrain_of(folder, area)
    merge(folder, parts, out)
    for part in parts:
        part.unlink(missing_ok=True)
    print(f"{ui.human(out.stat().st_size)} -> {out.name}", file=sys.stderr)


def cut_out(folder: Path, url: str, outline: Path, part: Path) -> None:
    part.unlink(missing_ok=True)
    netsafe.safely(
        lambda: pmtiles(folder, extract_args(url, outline, f"/out/{part.name}")),
        url,
        also_retry=(subprocess.CalledProcessError,),
        report=True,
    )


def holds_tiles(part: Path) -> bool:
    """Whether a cut-out part holds any tile (an area only grazing a file's box
    gets an empty one)."""
    header = read_header(part)
    return bool(header and header.tile_count)


def merge(folder: Path, parts: list[Path], out: Path) -> None:
    """The parts into one file (they don't overlap: different zooms or places);
    one part is simply renamed."""
    partial = folder / f".{out.name}.partial"
    partial.unlink(missing_ok=True)
    if len(parts) == 1:
        parts[0].replace(partial)
    else:
        pmtiles(
            folder,
            ["merge", *[f"/out/{p.name}" for p in parts], f"/out/{partial.name}"],
        )
    partial.replace(out)


def command_terrain(args) -> None:
    """offline-maps.py terrain --area AREA --outline FILE: the terrain of an area
    whose background map is already there (made before terrain came with it)."""
    make_terrain(Path(args.maps_dir).resolve(), args.area, Path(args.outline).resolve())
