"""Fork: an area's terrain without what stood on the sea when it was measured. At
sea, Mapterhorn's elevations come from Copernicus' DEM, a surface model: ships
moored at the time stand there as hills of 100 m and more (Toulon's roadstead), and
the contour lines, hill shading and 3D relief draw them.

Each terrain tile is masked with the background map's land (Protomaps' earth layer,
in its tile of the same zoom and place): every height above 0 outside the land
becomes 0. Lakes lie inside the land and are kept; a tile all on land is copied as
it is. Clipping elevations with land polygons is how OpenTopoMap and others clean
their DEMs at the coast (there with OpenStreetMap's land polygons, which Protomaps'
earth layer is made from).

<area>.terrain.pmtiles is rewritten in place (through a .part file), marked in its
metadata so it's done once. scripts/offline_maps/terrain.py runs it after a download.

    python -m src.fork.background_build.terrain_sea --area AREA [--folder DIR]
"""

from __future__ import annotations

import argparse
import io
import json
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
from PIL import Image, ImageDraw
from pmtiles.tile import tileid_to_zxy
from pmtiles.writer import Writer

from ..background import unzipped
from ..paths import OFFLINE_MAPS_DIR
from ..pmtiles_files import Archive
from ..terrain.elevations import TILE_PIXELS, decode

LAND_LAYER = "earth"
# What the metadata says once done (and what a download hasn't).
DONE_KEY = "oim_sea"
DONE_VALUE = "flattened"
# Tiles per worker's task, and workers.
CHUNK = 256
WORKERS = 8
# Terrarium: height = red * 256 + green + blue / 256 - OFFSET metres.
TERRARIUM_OFFSET = 32768


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="An area's terrain with the sea flattened.")
    parser.add_argument("--area", required=True, help="the area (<area>.terrain.pmtiles, <area>.pmtiles)")
    parser.add_argument("--folder", type=Path, default=OFFLINE_MAPS_DIR)
    args = parser.parse_args(argv)
    terrain = args.folder / f"{args.area}.terrain.pmtiles"
    background_map = args.folder / f"{args.area}.pmtiles"
    for path in (terrain, background_map):
        if not path.exists():
            sys.exit(f"Flattening the sea in {args.area}'s terrain: no {path.name} in {args.folder}.")
    if already_flattened(terrain):
        print(f"  {terrain.name}: the sea is already flattened", file=sys.stderr)
        return
    flatten(terrain, background_map)


def already_flattened(terrain: Path) -> bool:
    archive = Archive.open(terrain)
    return archive is not None and metadata(archive).get(DONE_KEY) == DONE_VALUE


def flatten(terrain: Path, background_map: Path) -> None:
    """Every tile of the terrain file through flattened_tile, into a new file that
    replaces it."""
    source = Archive.open(terrain)
    if source is None:
        sys.exit(f"Flattening the sea: {terrain.name} isn't a PMTiles file.")
    tile_ids = list(source.tile_ids())
    chunks = [tile_ids[i : i + CHUNK] for i in range(0, len(tile_ids), CHUNK)]
    part = terrain.with_name(f".{terrain.name}.part")
    changed = 0
    with part.open("wb") as f:
        writer = Writer(f)
        with ProcessPoolExecutor(WORKERS, initializer=_open, initargs=(terrain, background_map)) as pool:
            for n, results in enumerate(pool.map(_flatten_chunk, chunks), 1):
                for tile_id, data, was_changed in results:
                    writer.write_tile(tile_id, data)
                    changed += was_changed
                print(f"\r  {n}/{len(chunks)} parts, {changed} tiles flattened", end="", file=sys.stderr)
        print(file=sys.stderr)
        writer.finalize(dict(source.header), {**metadata(source), DONE_KEY: DONE_VALUE})
    part.replace(terrain)


def metadata(archive: Archive) -> dict:
    h = archive.header
    start = h["metadata_offset"]
    raw = archive.data[start : start + h["metadata_length"]]
    return json.loads(unzipped(bytes(raw)) or b"{}")


# Each worker's own open files (an mmap can't go to another process).
_files: dict[str, Archive] = {}


def _open(terrain: Path, background_map: Path) -> None:
    for name, path in (("terrain", terrain), ("land", background_map)):
        archive = Archive.open(path)
        if archive is None:
            raise RuntimeError(f"Flattening the sea: can't open {path}")
        _files[name] = archive


def _flatten_chunk(tile_ids: list[int]) -> list[tuple[int, bytes, bool]]:
    out = []
    for tile_id in tile_ids:
        z, x, y = tileid_to_zxy(tile_id)
        data = bytes(_files["terrain"].get(z, x, y) or b"")
        land = _files["land"].get(z, x, y)
        flattened = flattened_tile(data, land_mask(bytes(land)) if land else None)
        out.append((tile_id, flattened, flattened is not data))
    return out


def land_mask(background_tile: bytes) -> np.ndarray:
    """Which of a terrain tile's pixels are on land: the background map's earth
    polygons of the same tile, drawn at the terrain's resolution (rows from the north)."""
    tile = mapbox_vector_tile.decode(unzipped(background_tile), default_options={"y_coord_down": True})
    layer = tile.get(LAND_LAYER, {"features": [], "extent": 4096})
    scale = TILE_PIXELS / layer.get("extent", 4096)
    image = Image.new("1", (TILE_PIXELS, TILE_PIXELS), 0)
    draw = ImageDraw.Draw(image)
    for feature in layer["features"]:
        geometry = feature["geometry"]
        if geometry["type"] not in ("Polygon", "MultiPolygon"):
            continue
        polygons = [geometry["coordinates"]] if geometry["type"] == "Polygon" else geometry["coordinates"]
        for rings in polygons:
            outer, *holes = rings
            draw.polygon([(px * scale, py * scale) for px, py in outer], fill=1)
            for hole in holes:
                draw.polygon([(px * scale, py * scale) for px, py in hole], fill=0)
    return np.asarray(image, dtype=bool)


def flattened_tile(webp: bytes, land: np.ndarray | None) -> bytes:
    """A terrain tile with its heights above 0 outside the land set to 0; the same
    bytes where nothing changes (land unknown: no background tile; all on land; no
    height above the sea)."""
    if land is None or land.all():
        return webp
    heights = decode(webp)
    above_sea = ~land & (heights > 0)
    if not above_sea.any():
        return webp
    heights[above_sea] = 0
    return encode(heights)


def encode(heights: np.ndarray) -> bytes:
    """Heights as a Terrarium tile, lossless WebP (Mapterhorn's own encoding)."""
    value = heights.astype(np.float64) + TERRARIUM_OFFSET
    red = np.floor(value / 256)
    green = np.floor(value) - red * 256
    blue = np.round((value - np.floor(value)) * 256).clip(0, 255)
    rgb = np.stack([red, green, blue], axis=-1).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(out, format="WEBP", lossless=True)
    return out.getvalue()


if __name__ == "__main__":
    main()
