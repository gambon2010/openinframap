"""Fork: the search box (search/__init__.py): buildings by their number ("STR-NEU-451",
"WIS-47": building_numbers/), in the area the code names: a neighbourhood of a commune,
or a commune without neighbourhoods. A commune's code is unique within its
département only: every area it may be is answered (a handful at most), numbered
first if it wasn't yet, the nearest to the map's centre first (the search is told)."""

from __future__ import annotations

import json
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from ..building_numbers.numbering import label
from ..building_numbers.register import number_area
from ..userdata.schema import ensure_schema
from .matching import plain, table_exists

# "str-neu-451", "wis 47": a commune's code, a neighbourhood's (if any), the number.
BUILDING_QUERY = re.compile(r"^([a-z]{3})[\s-]+(?:([a-z]{3})[\s-]+)?(\d{1,6})$")

# The areas a code may be (code, prefix, name, outline): a commune's neighbourhood,
# or a commune without neighbourhoods; the nearest to :lon, :lat first, at most :most.
AREAS = """
    SELECT code, prefix, place, outline FROM (
        SELECT n.code, c.abbreviation || '-' || n.abbreviation AS prefix, n.name || ', ' || c.name AS place,
               ST_AsGeoJSON(ST_Transform(n.geometry, 4326)) AS outline, n.geometry
          FROM extra.neighbourhood n JOIN extra.commune c ON c.code = n.commune
         WHERE lower(c.abbreviation) = :commune AND lower(n.abbreviation) = :neighbourhood
        UNION ALL
        SELECT c.code, c.abbreviation, c.name, ST_AsGeoJSON(ST_Transform(c.geometry, 4326)), c.geometry
          FROM extra.commune c
         WHERE :neighbourhood = '' AND lower(c.abbreviation) = :commune
           AND NOT EXISTS (SELECT 1 FROM extra.neighbourhood n WHERE n.commune = c.code)
    ) areas
     ORDER BY geometry <-> ST_Transform(ST_SetSRID(ST_MakePoint(:lon, :lat), 4326), 3857)
     LIMIT :most
"""
# The nearest areas a code may be (a code is only unique within its département):
# numbering more would take too long for a search.
MOST_AREAS = 3
# Where to measure "nearest" from when the map's centre isn't given: France's middle.
FRANCE_CENTRE = (2.35, 46.6)


async def search_buildings(
    database: AsyncConnection,
    query: str,
    limit: Optional[int] = 10,
    near: tuple[float, float] = FRANCE_CENTRE,
) -> list[dict]:
    """Buildings by their number, if the query is one, in the areas nearest `near`."""
    match = BUILDING_QUERY.match(plain(query).strip())
    if not match or not await table_exists(database, "extra.neighbourhood"):
        return []
    # The register's tables (userdata migrations), made on first use.
    await ensure_schema(database)
    commune, neighbourhood, number = match.group(1), match.group(2) or "", int(match.group(3))
    lon, lat = near
    areas = (
        await database.execute(
            text(AREAS),
            {"commune": commune, "neighbourhood": neighbourhood, "most": MOST_AREAS, "lon": lon, "lat": lat},
        )
    ).all()
    found = []
    for code, prefix, place, outline in areas:
        await number_area(database, code, outline)
        point = await database.scalar(
            text(
                """SELECT ST_AsGeoJSON(geometry) FROM userdata.building_ref
                    WHERE area = :code AND number = :number"""
            ),
            {"code": code, "number": number},
        )
        if point:
            found.append(result(f"{label(prefix, number)} · {place}", json.loads(point)))
    return found[: limit or None]


def result(name: str, geometry: dict) -> dict:
    """A search result in the shape the others have (towers.py)."""
    return {
        "type": "feature",
        "source": "osm",
        "kind": "building",
        "subtype": None,
        "name": name,
        "local_name": None,
        "operator": None,
        "town": None,
        "geometry": geometry,
        "match_rank": 0,
    }
