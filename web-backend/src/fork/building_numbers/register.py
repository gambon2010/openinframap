"""Fork: building numbers (building_numbers/__init__.py): the register
(userdata.building_ref, building_sliver, area_numbered). An area (a neighbourhood, or
a commune without any) is numbered the first time its numbers are asked for; when the
background map has changed since, its new buildings get the next numbers and the
others keep theirs."""

from __future__ import annotations

import json

from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool

from ..background import ARCHIVES
from .buildings import buildings_in
from .numbering import new_numbers


async def number_area(database: AsyncConnection, code: str, outline_geojson: str) -> None:
    """Numbers an area's buildings unless done for this background map; one request at
    a time per area (two browsers opening the same place)."""
    version = ARCHIVES.version()
    await database.execute(text("SELECT pg_advisory_xact_lock(hashtext(:code))"), {"code": code})
    done = await database.scalar(
        text("SELECT map_version FROM userdata.area_numbered WHERE area = :code"), {"code": code}
    )
    if done == version:
        return
    found = await run_in_threadpool(buildings_in, shape(json.loads(outline_geojson)))
    registered = await database.execute(
        text("SELECT building_id, number FROM userdata.building_ref WHERE area = :code"),
        {"code": code},
    )
    numbered = {building: number for building, number in registered}
    added = new_numbers(numbered, found.buildings)
    if added:
        await database.execute(
            text(
                """INSERT INTO userdata.building_ref (building_id, area, number, geometry)
                   VALUES (:id, :code, :number, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                   ON CONFLICT (building_id) DO NOTHING"""
            ),
            [row(building, code, number, found.buildings[building]) for building, number in added.items()],
        )
    if found.slivers:
        await database.execute(
            text(
                """INSERT INTO userdata.building_sliver (building_id, area, geometry)
                   VALUES (:id, :code, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326))
                   ON CONFLICT (building_id) DO NOTHING"""
            ),
            [row(building, code, 0, point) for building, point in found.slivers.items()],
        )
    await database.execute(
        text(
            """INSERT INTO userdata.area_numbered (area, map_version) VALUES (:code, :version)
               ON CONFLICT (area) DO UPDATE SET map_version = EXCLUDED.map_version, numbered_at = now()"""
        ),
        {"code": code, "version": version},
    )
    await database.commit()


def row(building: int, code: str, number: int, point: tuple[float, float]) -> dict:
    """A building's register row, as the inserts take it."""
    lon, lat = point
    return {"id": building, "code": code, "number": number, "lon": lon, "lat": lat}
