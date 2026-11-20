"""Fork: what the background map leaves out zoomed out, made from its zoom 15 tiles
into a companion file, <area>.zoomed-out.pmtiles, beside <area>.pmtiles; the backend
appends its tiles to the background map's (background/__init__.py).

- the buildings big enough to see at zooms 12 to 14 (zoomed_buildings.py);
- the roads at zooms 8 to 13, with what Protomaps drops there: tunnel marks, small
  roads, paths, some stretches of big roads (zoomed_roads.py);
- the railways at zooms 6 to 15, ranked from OpenStreetMap's tags, close tracks
  drawn as one zoomed out, from <area>.railways.osm.pbf when there is one
  (zoomed_railways.py);
- airports' stand lead-ins (mapped as taxiways) left out of the roads at every zoom,
  with a cleaned roads layer for the zoom 14 and 15 tiles they're in
  (stand_lead_ins.py, from <area>.taxiways.osm.pbf).

The work goes one zoom 10 block at a time (its 1,024 zoom 15 tiles, in workers),
each tile decoded once, only its buildings and roads: the block's buildings tiles
(per zoom 12 block) and its roads tiles at zooms 10 to 13. The roads shown at zooms
8 and 9 come back simplified; at the end, their tiles and the railways' (a zoom
per task) are made side by side in the same workers.

    python -m src.fork.background_build.zoomed_out [--area AREA] [--folder DIR]

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
import numpy as np
import shapely
from pmtiles.tile import Compression, TileType, tileid_to_zxy, zxy_to_tileid
from pmtiles.writer import Writer

from ..pmtiles_files import Archive
from ..background import OFFLINE_MAPS_DIR, companion_of, is_background_map, mvt, unzipped
from . import beyond_area, stand_lead_ins
from . import zoomed_buildings as buildings
from . import zoomed_railways as railways
from . import zoomed_roads as roads
from .tiles import EXTENT, children, tile_bounds, zipped

FULL_ZOOM = 15
UNIT_ZOOM = 10  # a worker's share: a zoom 10 block
MAX_WORKERS = 8
# A worker's memory at its busiest (a dense block, Paris: 0.6 GB; with room for
# the area-wide roads at the end), and what's left to the rest of the computer.
WORKER_MEMORY = 1.5e9
KEPT_FREE = 4e9


def worker_count() -> int:
    """As many workers as the processors and the memory free allow (at least one):
    too many, and the computer stops while they swap."""
    free = available_memory()
    by_memory = int((free - KEPT_FREE) // WORKER_MEMORY) if free else MAX_WORKERS
    return max(1, min(MAX_WORKERS, os.cpu_count() or 4, by_memory))


def available_memory() -> float | None:
    """The memory free for new programs (Linux's MemAvailable), None if unknown."""
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) * 1024
    except OSError:
        pass  # Not Linux: the processors decide alone.
    return None


DECODED = {buildings.SOURCE_LAYER, roads.LAYER}
MIN_ZOOM, MAX_ZOOM = railways.ZOOMS[0], railways.ZOOMS[-1]


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
_lead_ins: shapely.Geometry = shapely.Polygon()


def _open(path: Path) -> None:
    global _archive, _lead_ins
    _archive = Archive.open(path)
    _lead_ins = stand_lead_ins.lead_ins(stand_lead_ins.source_of(path))


def one_unit(unit: tuple[int, int]) -> tuple[list[tuple[int, bytes]], dict, shapely.Geometry]:
    """A zoom 10 block's tiles (tile id, gzip), its roads for zooms 8 and 9, and
    where its zoom 15 tiles are."""
    archive = _archive
    assert archive is not None

    def read(x: int, y: int) -> dict[str, Any] | None:
        return stand_lead_ins.cleaned(decoded(archive, x, y), _lead_ins)

    return unit_tiles(read, *unit, map_tiles=archive)


def unit_tiles(
    read, ux: int, uy: int, map_tiles: Archive | None = None
) -> tuple[list[tuple[int, bytes]], dict, shapely.Geometry]:
    """`read(x, y)`: a zoom 15 tile decoded (decoded()), None where there's none;
    `map_tiles`: the background map, its own roads kept beyond the block's zoom 15
    tiles (beyond_area.py)."""
    out: list[tuple[int, bytes]] = []
    road_groups = roads.new_groups()
    present = []
    for bx, by in children(UNIT_ZOOM, ux, uy, buildings.BLOCK_ZOOM):
        tiles = {}
        for x, y in children(buildings.BLOCK_ZOOM, bx, by, FULL_ZOOM):
            tile = read(x, y)
            if tile is not None:
                tiles[(x, y)] = tile
                roads.collect(tile, tile_bounds(FULL_ZOOM, x, y), road_groups)
        present += list(tiles)
        if tiles:
            out += buildings.block_tiles(buildings.block_buildings(tiles, bx, by), bx, by)
    joined = roads.joined(road_groups)
    area = beyond_area.covered(present, FULL_ZOOM)
    for z in roads.ZOOMS:
        if z >= UNIT_ZOOM:
            tiles_at = children(UNIT_ZOOM, ux, uy, z)
            beyond = beyond_area.beyond_in(map_tiles, z, tiles_at, area) if map_tiles else ([], [])
            out += roads.zoom_tiles(joined, z, tiles_at, beyond)
    return out, roads.coarse(joined, below=UNIT_ZOOM), area


# --- A whole area -----------------------------------------------------------------------


def make(background_map: Path, workers: int | None = None) -> Path | None:
    """The companion of one background map; None if it has no zoom 15 (the world
    zoomed out). Written beside it under a hidden name, then renamed. `workers`: by
    default as many as the computer has room for (worker_count)."""
    source = Archive.open(background_map)
    if source is None or source.header["max_zoom"] < FULL_ZOOM:
        return None
    todo = units(source)
    out = companion_of(background_map)
    partial = out.with_name(f".{out.name}.part")
    started = time.monotonic()
    tiles: list[tuple[int, bytes]] = []
    zoomed_out_roads = roads.new_groups()
    areas = []
    pool = ProcessPoolExecutor(
        max_workers=workers or worker_count(), initializer=_open, initargs=(background_map,)
    )
    with pool:
        for done, (found, coarse, area) in enumerate(pool.map(one_unit, todo), 1):
            tiles += found
            roads.merge_into(zoomed_out_roads, coarse)
            areas.append(area)
            print(
                f"\r  {background_map.stem}: {done:,} / {len(todo):,} blocks",
                end="",
                file=sys.stderr,
                flush=True,
            )
        whole_area = shapely.union_all(areas)
        tiles += zoomed_right_out(
            pool, roads.joined(zoomed_out_roads), whole_area, railways.source_of(background_map)
        )
    lead_ins = stand_lead_ins.lead_ins(stand_lead_ins.source_of(background_map))
    tiles += stand_lead_ins.rewritten_tiles(source.get, lead_ins)
    write(partial, background_map, source, tiles)
    partial.replace(out)
    print(
        f" ({len(tiles):,} tiles, {out.stat().st_size / 1e6:.0f} MB, {time.monotonic() - started:.0f} s)",
        file=sys.stderr,
    )
    return out


# --- The whole area at once: roads at zooms 8 and 9, the railways ----------------------

_railways: dict[Path, tuple[np.ndarray, list]] = {}


def _railway_zoom(source: Path, z: int) -> list[tuple[int, bytes]]:
    """A zoom's railway tiles, the file read once per worker."""
    if source not in _railways:
        _railways[source] = railways.read(source)
    lines, props = _railways[source]
    return railways.zoom_tiles(lines, props, z)


def _roads_zoomed_right_out(joined_roads: dict, z: int, area: shapely.Geometry) -> list[tuple[int, bytes]]:
    """A zoom's road tiles from the whole area's roads, the background map's own kept
    beyond the area in the tiles its edge goes through."""
    assert _archive is not None
    beyond = beyond_area.beyond_in(_archive, z, beyond_area.edge_tiles(z, area), area)
    return roads.zoom_tiles(joined_roads, z, beyond=beyond)


def zoomed_right_out(
    pool: ProcessPoolExecutor, joined_roads: dict, area: shapely.Geometry, railways_source: Path
) -> list:
    """The tiles made from the whole area (`area`: where its zoom 15 tiles are), each
    zoom a task in the workers: the roads at zooms 8 and 9 (from every block's), the
    railways at every zoom (none without a railways file)."""
    tasks = [
        pool.submit(_roads_zoomed_right_out, joined_roads, z, area) for z in roads.ZOOMS if z < UNIT_ZOOM
    ]
    if railways_source.exists():
        tasks += [pool.submit(_railway_zoom, railways_source, z) for z in railways.ZOOMS]
    return [tile for task in tasks for tile in task.result()]


def one_per_tile(tiles: list[tuple[int, bytes]]) -> list[tuple[int, bytes]]:
    """The tiles in tile id order, those of one tile made apart (buildings, roads,
    railways) merged into one: a vector tile is a list of layers, so two tiles'
    bytes one after the other are one tile with the layers of both."""
    by_id: dict[int, list[bytes]] = {}
    for tile_id, data in tiles:
        by_id.setdefault(tile_id, []).append(data)
    merged = []
    for tile_id in sorted(by_id):
        parts = by_id[tile_id]
        if len(parts) > 1:
            joined = b"".join(gzip.decompress(part) for part in parts)
            parts = [zipped(joined)]
        merged.append((tile_id, parts[0]))
    return merged


def write(path: Path, background_map: Path, source: Archive, tiles: list[tuple[int, bytes]]) -> None:
    """The tiles, one per tile id, as a PMTiles file with the source's bounds."""
    tiles = one_per_tile(tiles)
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
                    {
                        "id": railways.LAYER,
                        "fields": {"kind": "String", "rank": "String", "tunnel": "Boolean"},
                    },
                ],
            },
        )


def out_of_date(folder: Path) -> list[Path]:
    """The background maps whose companion is missing or older than them (or than
    their railways file)."""
    found = []
    for path in sorted(folder.glob("*.pmtiles")):
        if not is_background_map(path):
            continue
        companion = companion_of(path)
        sources = [p for p in (path, railways.source_of(path)) if p.exists()]
        newest = max(p.stat().st_mtime for p in sources)
        if not companion.exists() or companion.stat().st_mtime < newest:
            found.append(path)
    return found


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Buildings, roads and railways zoomed out, for the background maps."
    )
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
