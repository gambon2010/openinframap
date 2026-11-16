"""Fork: what the background map leaves out zoomed out, made from its zoom 15 tiles
into a companion file, <area>.zoomed-out.pmtiles, beside <area>.pmtiles; the backend
appends its tiles to the background map's (background/__init__.py).

- the buildings big enough to see at zooms 12 to 14 (zoomed_buildings.py);
- the roads at zooms 8 to 13, with what Protomaps drops there: tunnel marks, small
  roads, paths, some stretches of big roads (zoomed_roads.py).

The work goes one zoom 10 block at a time (its 1,024 zoom 15 tiles, in workers),
each tile decoded once, only its buildings and roads: the block's buildings tiles
(per zoom 12 block) and its roads tiles at zooms 10 to 13. The roads shown at zooms
8 and 9 come back simplified, and their tiles are made at the end.

    python -m src.fork.background.zoomed_out [--area AREA] [--folder DIR]

Without --area: every background map with zoom 15 whose companion is missing or
older than it. scripts/offline_maps/extract.py runs it after a download.
"""

from __future__ import annotations

import argparse
import gzip
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import shapely
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
from pmtiles.writer import Writer

from . import OFFLINE_MAPS_DIR, Archive, companion_of, is_background_map, mvt, unzipped
from . import zoomed_buildings as buildings
from . import zoomed_roads as roads
from .tiles import EXTENT, children, tile_bounds

FULL_ZOOM = 15
UNIT_ZOOM = 10  # a worker's share: a zoom 10 block
WORKERS = min(8, os.cpu_count() or 4)
DECODED = {buildings.SOURCE_LAYER, roads.LAYER}
MIN_ZOOM, MAX_ZOOM = roads.ZOOMS[0], buildings.ZOOMS[-1]


# --- Reading the background map ------------------------------------------------------


def decoded(archive: Archive, x: int, y: int) -> dict[str, Any] | None:
    """A zoom 15 tile's buildings and roads, each feature's geometry a shapely one in
    web Mercator metres; None if the file hasn't the tile."""
    data = archive.get(FULL_ZOOM, x, y)
    if not data:
        return None
    tile = mapbox_vector_tile.decode(
        mvt.keep(unzipped(data), DECODED), default_options={"y_coord_down": True}
    )
    for name, layer in tile.items():
        layer["features"] = [f for f in layer["features"] if used(name, f)]
    features = [f for layer in tile.values() for f in layer["features"]]
    if features:
        # From tile units to metres in one go (not point by point while decoding).
        west, _, east, north = tile_bounds(FULL_ZOOM, x, y)
        scale = (east - west) / EXTENT
        in_units = [shapely.geometry.shape(f["geometry"]) for f in features]
        in_metres = shapely.transform(in_units, lambda xy: xy * [scale, -scale] + [west, north])
        for feature, geometry in zip(features, in_metres):
            feature["geometry"] = geometry
    return tile


def used(layer: str, feature: dict[str, Any]) -> bool:
    """Whether the build uses a feature: whole buildings, roads shown before zoom 14
    (the rest is never turned into a shape, the slowest part of reading)."""
    if layer == buildings.SOURCE_LAYER:
        return buildings.used(feature)
    return roads.used(feature)


def units(archive: Archive) -> list[tuple[int, int]]:
    """The zoom 10 blocks that have zoom 15 tiles, in tile id order."""
    first, last = zxy_to_tileid(FULL_ZOOM, 0, 0), zxy_to_tileid(FULL_ZOOM + 1, 0, 0)
    shift = FULL_ZOOM - UNIT_ZOOM
    found = set()
    for tile_id in archive.tile_ids():
        if first <= tile_id < last:
            _, x, y = tileid_to_zxy(tile_id)
            found.add((x >> shift, y >> shift))
    return sorted(found, key=lambda u: zxy_to_tileid(UNIT_ZOOM, *u))


# --- One zoom 10 block (in a worker) ----------------------------------------------------

_archive: Archive | None = None


def _open(path: Path) -> None:
    global _archive
    _archive = Archive.open(path)


def one_unit(unit: tuple[int, int]) -> tuple[list[tuple[int, bytes]], dict]:
    """A zoom 10 block's tiles (tile id, gzip), and its roads for zooms 8 and 9."""
    archive = _archive
    assert archive is not None
    return unit_tiles(lambda x, y: decoded(archive, x, y), *unit)


def unit_tiles(read, ux: int, uy: int) -> tuple[list[tuple[int, bytes]], dict]:
    """`read(x, y)`: a zoom 15 tile decoded (decoded()), None where there's none."""
    out: list[tuple[int, bytes]] = []
    road_groups = roads.new_groups()
    for bx, by in children(UNIT_ZOOM, ux, uy, buildings.BLOCK_ZOOM):
        tiles = {}
        for x, y in children(buildings.BLOCK_ZOOM, bx, by, FULL_ZOOM):
            tile = read(x, y)
            if tile is not None:
                tiles[(x, y)] = tile
                roads.collect(tile, tile_bounds(FULL_ZOOM, x, y), road_groups)
        if tiles:
            out += buildings.block_tiles(buildings.block_buildings(tiles, bx, by), bx, by)
    joined = roads.joined(road_groups)
    for z in roads.ZOOMS:
        if z >= UNIT_ZOOM:
            out += roads.zoom_tiles(joined, z, children(UNIT_ZOOM, ux, uy, z))
    return out, roads.coarse(joined, below=UNIT_ZOOM)


# --- A whole area -----------------------------------------------------------------------


def make(background_map: Path, workers: int = WORKERS) -> Path | None:
    """The companion of one background map; None if it has no zoom 15 (the world
    zoomed out). Written beside it under a hidden name, then renamed."""
    source = Archive.open(background_map)
    if source is None or source.header["max_zoom"] < FULL_ZOOM:
        return None
    todo = units(source)
    out = companion_of(background_map)
    partial = out.with_name(f".{out.name}.part")
    started = time.monotonic()
    tiles: list[tuple[int, bytes]] = []
    zoomed_out_roads = roads.new_groups()
    with ProcessPoolExecutor(max_workers=workers, initializer=_open, initargs=(background_map,)) as pool:
        for done, (found, coarse) in enumerate(pool.map(one_unit, todo), 1):
            tiles += found
            roads.merge_into(zoomed_out_roads, coarse)
            print(
                f"\r  {background_map.stem}: {done:,} / {len(todo):,} blocks",
                end="",
                file=sys.stderr,
                flush=True,
            )
    joined = roads.joined(zoomed_out_roads)
    for z in roads.ZOOMS:
        if z < UNIT_ZOOM:
            tiles += roads.zoom_tiles(joined, z)
    write(partial, background_map, source, tiles)
    partial.replace(out)
    print(
        f" ({len(tiles):,} tiles, {out.stat().st_size / 1e6:.0f} MB, {time.monotonic() - started:.0f} s)",
        file=sys.stderr,
    )
    return out


def write(path: Path, background_map: Path, source: Archive, tiles: list[tuple[int, bytes]]) -> None:
    """The tiles, in tile id order, as a PMTiles file with the source's bounds."""
    tiles.sort(key=lambda t: t[0])
    if not tiles:
        # Nothing anywhere: an empty tile so the file is valid.
        tiles = [(zxy_to_tileid(MIN_ZOOM, 0, 0), gzip.compress(b"", mtime=0))]
    h = source.header
    bounds = ("min_lon_e7", "min_lat_e7", "max_lon_e7", "max_lat_e7", "center_lon_e7", "center_lat_e7")
    with path.open("wb") as f:
        writer = Writer(f)
        for tile_id, data in tiles:
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": MIN_ZOOM,
                "max_zoom": MAX_ZOOM,
                **{k: h[k] for k in bounds},
                "center_zoom": MIN_ZOOM,
            },
            {
                "name": f"{background_map.stem} zoomed out",
                "vector_layers": [
                    {
                        "id": buildings.LAYER,
                        "fields": {"kind": "String", "height": "Number", "area_m2": "Number"},
                    },
                    {"id": roads.LAYER, "fields": {k: "String" for k in roads.KEPT}},
                ],
            },
        )


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
    parser = argparse.ArgumentParser(description="Buildings and roads zoomed out, for the background maps.")
    parser.add_argument("--area", help="one area (<area>.pmtiles); default: every one out of date")
    parser.add_argument("--folder", type=Path, default=OFFLINE_MAPS_DIR)
    args = parser.parse_args(argv)
    maps = [args.folder / f"{args.area}.pmtiles"] if args.area else out_of_date(args.folder)
    for path in maps:
        if not path.exists():
            sys.exit(f"No background map {path.name}")
        if make(path) is None:
            print(f"  {path.stem}: no zoom 15, nothing to add zoomed out", file=sys.stderr)


if __name__ == "__main__":
    main()
