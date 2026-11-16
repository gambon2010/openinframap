"""Fork: buildings zoomed out (zooms 12 to 14), made from a background map's zoom 15
tiles into a companion file, <area>.buildings.pmtiles, beside <area>.pmtiles.

Protomaps' tiles hold every building only at zoom 15: below, its tile build merges
neighbouring buildings into blocks and keeps the big blocks (the background map's
pale city texture). The companion's tiles hold one layer, LAYER, the buildings big
enough to see at each zoom (MIN_AREA_M2); the backend appends it to the background
map's own tile of the same zoom (background/__init__.py), so the map has both and
Protomaps' tiles stay as downloaded.

The work goes one zoom 12 block at a time (its 64 zoom 15 tiles): a building cut at
tile edges comes in pieces, joined by its id, then measured; from one list of
buildings come the block's zoom 12, 13 and 14 tiles.

    python -m src.fork.background.zoomed_buildings [--area AREA] [--folder DIR]

Without --area: every background map with zoom 15 whose companion is missing or
older than it. scripts/satimagery/extract.py runs it after a download.
"""

from __future__ import annotations

import argparse
import gzip
import math
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
from pmtiles.writer import Writer
from shapely import unary_union
from shapely.geometry import box, shape
from shapely.geometry.base import BaseGeometry

from . import BASEMAP_DIR, COMPANION_ZOOMS, Archive, companion_of, is_background_map, unzipped

LAYER = "buildings_large"
FULL_ZOOM = 15
BLOCK_ZOOM = 12
# The smallest building shown at each zoom: about 4 pixels across there.
MIN_AREA_M2 = {12: 10_000, 13: 2_500, 14: 600}
ZOOMS = tuple(COMPANION_ZOOMS)  # the zooms the backend appends
EXTENT = 4096
BUFFER = 64  # tile units drawn past each edge, as Protomaps' tiles
HALF = 20037508.342789244  # web Mercator's half width, metres
WORKERS = min(8, os.cpu_count() or 4)


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """A tile's square in web Mercator metres (west, south, east, north)."""
    size = 2 * HALF / 2**z
    west, north = -HALF + x * size, HALF - y * size
    return west, north - size, west + size, north


def ground_stretch(z: int, y: int) -> float:
    """Ground metres per web Mercator metre in a tile's row (squared for areas)."""
    lat = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / 2**z)))
    return math.cos(lat)


# --- Reading the background map ------------------------------------------------------


def stored(archive: Archive, z: int, x: int, y: int) -> bytes | None:
    """A tile's protobuf bytes (unzipped), None if the file hasn't it."""
    data = archive.get(z, x, y)
    return unzipped(data) if data else None


def blocks(archive: Archive) -> list[tuple[int, int]]:
    """The zoom 12 blocks that have zoom 15 tiles, in tile id order."""
    first, last = zxy_to_tileid(FULL_ZOOM, 0, 0), zxy_to_tileid(FULL_ZOOM + 1, 0, 0)
    shift = FULL_ZOOM - BLOCK_ZOOM
    found = set()
    for tile_id in archive.tile_ids():
        if first <= tile_id < last:
            _, x, y = tileid_to_zxy(tile_id)
            found.add((x >> shift, y >> shift))
    return sorted(found, key=lambda b: zxy_to_tileid(BLOCK_ZOOM, *b))


# --- One block -------------------------------------------------------------------------

_archive: Archive | None = None


def _open(path: Path) -> None:
    global _archive
    _archive = Archive.open(path)


def block_buildings(get, bx: int, by: int) -> list[dict[str, Any]]:
    """The buildings of a zoom 12 block, whole (their pieces joined), in web Mercator,
    with their area on the ground: those big enough to show at some zoom."""
    shift = FULL_ZOOM - BLOCK_ZOOM
    pieces: dict[int, list[BaseGeometry]] = {}
    heights: dict[int, float] = {}
    for x in range(bx << shift, (bx + 1) << shift):
        for y in range(by << shift, (by + 1) << shift):
            data = get(FULL_ZOOM, x, y)
            if not data:
                continue
            west, _, east, north = tile_bounds(FULL_ZOOM, x, y)
            size = east - west

            def to_metres(px: float, py: float, west: float = west, north: float = north, size: float = size):
                return west + px / EXTENT * size, north - py / EXTENT * size

            tile = mapbox_vector_tile.decode(
                data, default_options={"y_coord_down": True, "transformer": to_metres}
            )
            for f in tile.get("buildings", {}).get("features", []):
                props = f.get("properties", {})
                if props.get("kind") != "building" or f.get("id") is None:
                    continue
                geom = shape(f["geometry"])
                if geom.is_empty:
                    continue
                pieces.setdefault(int(f["id"]), []).append(geom if geom.is_valid else geom.buffer(0))
                if isinstance(props.get("height"), (int, float)):
                    heights[int(f["id"])] = float(props["height"])
    stretch = ground_stretch(BLOCK_ZOOM, by) ** 2
    smallest = min(MIN_AREA_M2.values())
    found = []
    for building_id, parts in pieces.items():
        geom = parts[0] if len(parts) == 1 else unary_union(parts)
        area = geom.area * stretch
        if area >= smallest and geom.geom_type in ("Polygon", "MultiPolygon"):
            found.append({"id": building_id, "geom": geom, "area": area, "height": heights.get(building_id)})
    return found


def block_tiles(buildings: list[dict[str, Any]], bx: int, by: int) -> list[tuple[int, bytes]]:
    """The block's tiles at zooms 12 to 14 (tile id, gzip), each with the buildings
    big enough for its zoom, simplified to about a pixel, cut to the tile and its
    buffer. Tiles with none are left out."""
    out = []
    for z in ZOOMS:
        n = 1 << (z - BLOCK_ZOOM)
        big = [b for b in buildings if b["area"] >= MIN_AREA_M2[z]]
        if not big:
            continue
        for x in range(bx * n, (bx + 1) * n):
            for y in range(by * n, (by + 1) * n):
                bounds = tile_bounds(z, x, y)
                size = bounds[2] - bounds[0]
                margin = BUFFER / EXTENT * size
                clip = box(bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
                pixel = size / 512  # a tile is drawn 512 pixels wide
                features = []
                for b in big:
                    if not b["geom"].intersects(clip):
                        continue
                    geom = b["geom"].simplify(pixel, preserve_topology=True).intersection(clip)
                    if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
                        geom = polygons_only(geom)
                        if geom is None:
                            continue
                    props: dict[str, Any] = {"kind": "building", "area_m2": round(b["area"])}
                    if b["height"] is not None:
                        props["height"] = b["height"]
                    features.append({"id": b["id"], "geometry": geom.wkb, "properties": props})
                if features:
                    data = mapbox_vector_tile.encode(
                        [{"name": LAYER, "features": features}],
                        default_options={"quantize_bounds": bounds, "extents": EXTENT},
                    )
                    out.append((zxy_to_tileid(z, x, y), gzip.compress(data, compresslevel=6, mtime=0)))
    return out


def polygons_only(geom: BaseGeometry) -> BaseGeometry | None:
    """The areas of what cutting left (it can add lines or points along the cut)."""
    areas = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(areas) if areas else None


def one_block(block: tuple[int, int]) -> list[tuple[int, bytes]]:
    archive = _archive
    assert archive is not None
    bx, by = block
    return block_tiles(block_buildings(lambda z, x, y: stored(archive, z, x, y), bx, by), bx, by)


# --- A whole area -----------------------------------------------------------------------


def make(background_map: Path, workers: int = WORKERS) -> Path | None:
    """The companion of one background map; None if it has no zoom 15 (the world
    zoomed out). Written beside it under a hidden name, then renamed."""
    source = Archive.open(background_map)
    if source is None or source.header["max_zoom"] < FULL_ZOOM:
        return None
    todo = blocks(source)
    out = companion_of(background_map)
    partial = out.with_name(f".{out.name}.part")
    started = time.monotonic()
    tiles = 0
    with partial.open("wb") as f:
        writer = Writer(f)
        with ProcessPoolExecutor(max_workers=workers, initializer=_open, initargs=(background_map,)) as pool:
            for done, found in enumerate(pool.map(one_block, todo, chunksize=8), 1):
                for tile_id, data in found:
                    writer.write_tile(tile_id, data)
                    tiles += 1
                if done % 200 == 0 or done == len(todo):
                    print(
                        f"\r  {background_map.stem}: {done:,} / {len(todo):,} blocks",
                        end="",
                        file=sys.stderr,
                        flush=True,
                    )
        if not tiles:
            # Nothing big enough anywhere: an empty tile so the file is valid.
            writer.write_tile(zxy_to_tileid(ZOOMS[0], 0, 0), gzip.compress(b"", mtime=0))
        h = source.header
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": ZOOMS[0],
                "max_zoom": ZOOMS[-1],
                **{
                    k: h[k]
                    for k in (
                        "min_lon_e7",
                        "min_lat_e7",
                        "max_lon_e7",
                        "max_lat_e7",
                        "center_lon_e7",
                        "center_lat_e7",
                    )
                },
                "center_zoom": ZOOMS[0],
            },
            {
                "name": f"{background_map.stem} buildings zoomed out",
                "vector_layers": [
                    {"id": LAYER, "fields": {"kind": "String", "height": "Number", "area_m2": "Number"}}
                ],
            },
        )
    partial.replace(out)
    print(
        f" ({tiles:,} tiles, {out.stat().st_size / 1e6:.0f} MB, {time.monotonic() - started:.0f} s)",
        file=sys.stderr,
    )
    return out


def out_of_date(folder: Path) -> list[Path]:
    """The background maps whose companion is missing or older than them."""
    found = []
    for path in sorted(folder.glob("*.pmtiles")):
        if not is_background_map(path):
            continue
        companion = companion_of(path)
        if not companion.exists() or companion.stat().st_mtime < path.stat().st_mtime:
            found.append(path)
    return found


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Buildings zoomed out, for the background maps.")
    parser.add_argument("--area", help="one area (<area>.pmtiles); default: every one out of date")
    parser.add_argument("--folder", type=Path, default=BASEMAP_DIR)
    args = parser.parse_args(argv)
    maps = [args.folder / f"{args.area}.pmtiles"] if args.area else out_of_date(args.folder)
    for path in maps:
        if not path.exists():
            sys.exit(f"No background map {path.name}")
        if make(path) is None:
            print(f"  {path.stem}: no zoom 15, no buildings to show zoomed out", file=sys.stderr)


if __name__ == "__main__":
    main()
