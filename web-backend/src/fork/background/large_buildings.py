"""Fork: the large buildings, for showing them zoomed out (a build step).

The background maps (data/basemap/<area>.pmtiles) hold every building only in their
zoom 15 tiles; their lower zooms keep a few landmarks. This reads every zoom 15
tile, keeps the buildings of at least MIN_AREA_M2 on the ground, and writes them
to basemap_building_large (EPSG:3857), which Tegola's "buildings" map serves at
zooms 12 to 14, each zoom the buildings big enough to see there
(tegola/layers.fork.yml). From zoom 15 the background map's own outlines take over.

A building crossing a tile edge comes in pieces (one per tile, each a little over
the edge): pieces are joined by the building's id in the database, then measured.

    python -m src.fork.background.large_buildings   (scripts/lib/basemap.sh runs it)
"""

from __future__ import annotations

import asyncio
import gzip
import math
import os
import sys
import time
from collections import deque
from collections.abc import Iterator
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import asyncpg
import mapbox_vector_tile  # type: ignore[import-untyped]
from pmtiles.reader import MmapSource, all_tiles
from pmtiles.tile import deserialize_header
from shapely.geometry import shape

from . import BASEMAP_DIR, is_background_map

# The smallest building kept: about 4 pixels across at zoom 14 (25 m × 25 m).
MIN_AREA_M2 = 600
# Pieces of a building cut at a tile edge are kept from this size (their building
# is measured once joined); smaller ones can't make a large building.
MIN_PIECE_M2 = 50
ZOOM = 15
EXTENT = 4096
HALF = 20037508.342789244  # web Mercator's half width, metres
TABLE = "basemap_building_large"
WORKERS = min(8, os.cpu_count() or 4)
BATCH = 2000


def tile_pieces(item: tuple[int, int, bytes]) -> list[tuple[int, float | None, bytes, bool]]:
    """The buildings of one zoom 15 tile worth keeping: (id, height, WKB in EPSG:3857,
    cut at the tile's edge)."""
    x, y, data = item
    size = 2 * HALF / 2**ZOOM
    west, north = -HALF + x * size, HALF - y * size
    # A unit of web Mercator is this many metres on the ground here.
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / 2**ZOOM))))
    stretch = math.cos(math.radians(lat))

    def to_3857(px: float, py: float) -> tuple[float, float]:
        return west + px / EXTENT * size, north - py / EXTENT * size

    tile = mapbox_vector_tile.decode(
        gzip.decompress(data), default_options={"y_coord_down": True, "transformer": to_3857}
    )
    out = []
    for feature in tile.get("buildings", {}).get("features", []):
        props = feature.get("properties", {})
        if props.get("kind") != "building" or feature.get("id") is None:
            continue
        geom = shape(feature["geometry"])
        if geom.is_empty:
            continue
        area = geom.area * stretch * stretch
        minx, miny, maxx, maxy = geom.bounds
        cut = minx < west or maxx > west + size or maxy > north or miny < north - size
        if area >= MIN_AREA_M2 or (cut and area >= MIN_PIECE_M2):
            height = props.get("height")
            out.append((int(feature["id"]), float(height) if height is not None else None, geom.wkb, cut))
    return out


def full_detail_maps(folder: Path) -> list[Path]:
    """The background maps with zoom 15 (not the world zoomed out)."""
    found = []
    for path in sorted(folder.glob("*.pmtiles")):
        if not is_background_map(path):
            continue
        with path.open("rb") as f:
            if deserialize_header(f.read(127))["max_zoom"] >= ZOOM:
                found.append(path)
    return found


def zoom15_tiles(path: Path) -> Iterator[tuple[int, int, bytes]]:
    with path.open("rb") as f:
        for (z, x, y), data in all_tiles(MmapSource(f)):
            if z == ZOOM:
                yield x, y, data


def batches(items: Iterator, size: int) -> Iterator[list]:
    batch = []
    for item in items:
        batch.append(item)
        if len(batch) == size:
            yield batch
            batch = []
    if batch:
        yield batch


def read_batch(batch: list[tuple[int, int, bytes]]) -> list:
    return [piece for item in batch for piece in tile_pieces(item)]


async def write(connection: asyncpg.Connection, maps: list[Path]) -> int:
    await connection.execute(
        "CREATE TEMP TABLE building_piece (id bigint, height real, geom bytea, cut boolean)"
    )
    pieces = 0
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        for path in maps:
            started = time.monotonic()
            tiles = 0
            # A few batches ahead at most: a country's tiles are gigabytes.
            waiting: deque = deque()
            source = batches(zoom15_tiles(path), BATCH)
            while True:
                while len(waiting) < WORKERS * 2 and (batch := next(source, None)) is not None:
                    waiting.append(pool.submit(read_batch, batch))
                if not waiting:
                    break
                found = waiting.popleft().result()
                tiles += BATCH
                if found:
                    await connection.copy_records_to_table("building_piece", records=found)
                    pieces += len(found)
                print(
                    f"\r  {path.stem}: ~{tiles:,} tiles read, {pieces:,} buildings kept",
                    end="",
                    file=sys.stderr,
                    flush=True,
                )
            print(f" ({time.monotonic() - started:.0f} s)", file=sys.stderr)
    # One row per building (pieces joined, the same building from two areas once),
    # measured on the ground (schema/distances.sql), the small ones left out.
    async with connection.transaction():
        await connection.execute(f"DROP TABLE IF EXISTS {TABLE}")
        await connection.execute(
            f"""
            CREATE TABLE {TABLE} AS
            SELECT id, height, area_m2, geometry FROM (
                SELECT id, max(height) AS height,
                       ST_Multi(ST_MakeValid(ST_UnaryUnion(ST_Collect(ST_GeomFromWKB(geom, 3857)))))
                           AS geometry
                FROM building_piece GROUP BY id
            ) joined
            CROSS JOIN LATERAL (SELECT oim_ground_area(geometry) AS area_m2) measured
            WHERE area_m2 >= {MIN_AREA_M2} AND ST_GeometryType(geometry) = 'ST_MultiPolygon'
            """
        )
        await connection.execute(f"CREATE INDEX ON {TABLE} USING gist (geometry)")
        await connection.execute(f"ANALYZE {TABLE}")
    return await connection.fetchval(f"SELECT count(*) FROM {TABLE}")


async def main() -> None:
    maps = full_detail_maps(BASEMAP_DIR)
    url = os.environ["DATABASE_URL"].replace("postgresql+asyncpg://", "postgresql://")
    connection = await asyncpg.connect(url)
    try:
        if not maps:
            # None (left): the table empty, so the map shows none.
            await connection.execute(f"DROP TABLE IF EXISTS {TABLE}")
            await connection.execute(
                f"CREATE TABLE {TABLE} (id bigint, height real, area_m2 float, "
                "geometry geometry(MultiPolygon, 3857))"
            )
            print("No background map with zoom 15: no large buildings.", file=sys.stderr)
            return
        count = await write(connection, maps)
        print(
            f"{count:,} large buildings (≥ {MIN_AREA_M2} m²) from {', '.join(m.stem for m in maps)}.",
            file=sys.stderr,
        )
    finally:
        await connection.close()


if __name__ == "__main__":
    asyncio.run(main())
