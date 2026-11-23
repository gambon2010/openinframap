"""Fork: buildings' interiors (osm_indoor, filled by scripts/indoor.py): the
background map's building each piece stands in, from the map's zoom 15 tiles (the
same buildings and ids the map draws), and indoor_building, each such building's
floors and outline. A piece with a floor that isn't itself part of an interior (a
shop, a bench: inside_only) and stands in no building is left out: outdoors."""

from __future__ import annotations

import json
import time
from functools import lru_cache

from shapely import STRtree
from shapely.geometry import Point, shape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from ..background.buildings import TileReader, area_only, full_tile, outline, tile_of, to_degrees
from ..database import database_url

# One point inside each piece (degrees), with the zoom 15 tile it's in.
PIECES = """
    SELECT id, ST_X(p), ST_Y(p)
      FROM (SELECT id, ST_Transform(ST_PointOnSurface(geometry), 4326) AS p FROM osm_indoor) AS pieces
"""

# Each building's floors: every level a piece is on, whole floors between a range's ends.
FLOORS = """
    INSERT INTO indoor_building (building_id, levels, geometry)
    SELECT building_id, array_agg(DISTINCT level ORDER BY level), ST_GeomFromText('POINT EMPTY', 3857)
      FROM (SELECT building_id, level_low AS level FROM osm_indoor WHERE building_id IS NOT NULL
            UNION SELECT building_id, level_high FROM osm_indoor WHERE building_id IS NOT NULL
            UNION SELECT building_id, generate_series(ceil(level_low)::int, floor(level_high)::int)
                    FROM osm_indoor WHERE building_id IS NOT NULL) AS floors
     GROUP BY building_id
"""


# Tiles kept decoded while the step runs: a building's outline reads the tiles its
# pieces were found in again, and its neighbours' (visited in tile order: near).
TILES_REMEMBERED = 1024
# A door sits on a wall, the building's very edge: within this of a building is in it
# (degrees, about a metre).
EDGE_DEGREES = 1e-5


async def main() -> None:
    began = time.monotonic()
    read_tile = remembering(full_tile)
    engine = create_async_engine(database_url())
    async with engine.connect() as database:
        pieces = await pieces_by_tile(database)
        found = buildings_of(pieces, read_tile)
        await write_buildings(database, found)
        dropped = await drop_outdoors(database)
        await write_floors(database, read_tile)
        buildings = await database.scalar(text("SELECT count(*) FROM indoor_building"))
        await database.commit()
    await engine.dispose()
    print(f"{len(found):,} pieces in {buildings:,} buildings, {dropped:,} left out (outdoors), "
          f"in {time.monotonic() - began:.0f} s.")  # fmt: skip


async def pieces_by_tile(database: AsyncConnection) -> dict[tuple[int, int], list[tuple[int, Point]]]:
    """Each piece's point, by the zoom 15 tile it's in."""
    tiles: dict[tuple[int, int], list[tuple[int, Point]]] = {}
    for piece, lon, lat in await database.execute(text(PIECES)):
        tiles.setdefault(tile_of(lon, lat), []).append((piece, Point(lon, lat)))
    return tiles


def remembering(read_tile: TileReader) -> TileReader:
    """read_tile, the last TILES_REMEMBERED tiles kept."""
    return lru_cache(maxsize=TILES_REMEMBERED)(read_tile)


def buildings_of(
    tiles: dict[tuple[int, int], list[tuple[int, Point]]], read_tile: TileReader
) -> dict[int, int]:
    """Each piece's building (piece id to building id), where its point is inside one
    (or on its edge, as a door is)."""
    found: dict[int, int] = {}
    for (tx, ty), pieces in sorted(tiles.items()):
        ids, outlines = [], []
        for feature in read_tile(tx, ty):
            geom = area_only(shape(feature["geometry"]))
            if not geom.is_empty:
                ids.append(int(feature["id"]))
                outlines.append(to_degrees(geom, tx, ty))
        if not outlines:
            continue
        tree = STRtree(outlines)
        for piece, point in pieces:
            inside = tree.query(point, predicate="dwithin", distance=EDGE_DEGREES)
            if len(inside):
                found[piece] = ids[int(inside[0])]
    return found


async def write_buildings(database: AsyncConnection, found: dict[int, int]) -> None:
    await database.execute(text("UPDATE osm_indoor SET building_id = NULL"))
    await database.execute(
        text("CREATE TEMP TABLE indoor_found (id integer, building_id bigint) ON COMMIT DROP")
    )
    rows = [{"id": piece, "building": building} for piece, building in found.items()]
    if rows:
        await database.execute(text("INSERT INTO indoor_found VALUES (:id, :building)"), rows)
    await database.execute(
        text("UPDATE osm_indoor o SET building_id = f.building_id FROM indoor_found f WHERE f.id = o.id")
    )


async def drop_outdoors(database: AsyncConnection) -> int:
    """What's only kept indoors and stands in no building: outdoors."""
    result = await database.execute(text("DELETE FROM osm_indoor WHERE inside_only AND building_id IS NULL"))
    return int(getattr(result, "rowcount", 0) or 0)


async def write_floors(database: AsyncConnection, read_tile: TileReader) -> None:
    """indoor_building: each building's floors, and its whole outline from the tiles."""
    await database.execute(text("TRUNCATE indoor_building"))
    await database.execute(text(FLOORS))
    points = await database.execute(
        text(
            """SELECT building_id, ST_X(p), ST_Y(p) FROM (
                 SELECT DISTINCT ON (building_id) building_id,
                        ST_Transform(ST_PointOnSurface(geometry), 4326) AS p
                   FROM osm_indoor WHERE building_id IS NOT NULL ORDER BY building_id, id) AS one"""
        )
    )
    in_tile_order = sorted(points.all(), key=lambda row: tile_of(row[1], row[2]))
    for building, lon, lat in in_tile_order:
        whole = outline(building, lon, lat, read_tile=read_tile)
        if whole is None:
            continue
        await database.execute(
            text(
                """UPDATE indoor_building
                      SET geometry = ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:outline), 4326), 3857)
                    WHERE building_id = :building"""
            ),
            {"outline": json.dumps(whole), "building": building},
        )
