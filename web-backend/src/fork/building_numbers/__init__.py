"""Fork: building numbers, for a shared map ("STR-NEU-12": the 12th building of
Neudorf, in Strasbourg; "WIS-47" in a commune with no neighbourhoods), as a gridded
reference graphic numbers them (numbering.py). Per neighbourhood where INSEE splits a
commune, else per commune (extra data `fr-communes`: their outlines and short codes),
worked out when asked for and kept in memory (areas.py): the same numbers on every
computer with the same background map. Slivers (a staircase's steps) aren't numbered,
and the map leaves them out of the buildings outside 3D.

    /background/building-numbers?bbox=w,s,e,n     the numbered buildings in a view
        (GeoJSON points: "prefix" "STR-NEU", "number" 12) and its slivers' ids
        ("hidden"); the areas it touches worked out first (a few seconds the first
        time). Asked for zoomed in only.
    /background/building-names?lon=&lat=&id=      one building's number and its own
        name from OpenStreetMap ("number", "name", each null when it has none), for
        its details and My layers' copy of it.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from .numbering import label
from .areas import area_numbers

# A view touching more areas than this is too far out to number (the map asks from
# zoom 16, a few streets).
MOST_AREAS = 8

# The numbering areas touching a box (degrees): a commune's neighbourhoods, or the
# commune itself when it has none; each with its prefix and outline.
AREAS = """
    SELECT n.code, c.abbreviation || '-' || n.abbreviation, ST_AsGeoJSON(ST_Transform(n.geometry, 4326))
      FROM extra.neighbourhood n JOIN extra.commune c ON c.code = n.commune
     WHERE n.geometry && ST_Transform(ST_MakeEnvelope(:w, :s, :e, :n, 4326), 3857)
       AND ST_Intersects(n.geometry, ST_Transform(ST_MakeEnvelope(:w, :s, :e, :n, 4326), 3857))
    UNION ALL
    SELECT c.code, c.abbreviation, ST_AsGeoJSON(ST_Transform(c.geometry, 4326))
      FROM extra.commune c
     WHERE c.geometry && ST_Transform(ST_MakeEnvelope(:w, :s, :e, :n, 4326), 3857)
       AND ST_Intersects(c.geometry, ST_Transform(ST_MakeEnvelope(:w, :s, :e, :n, 4326), 3857))
       AND NOT EXISTS (SELECT 1 FROM extra.neighbourhood n WHERE n.commune = c.code)
     LIMIT :most
"""


async def numbers_in_view(request: Request) -> Response:
    try:
        west, south, east, north = (float(v) for v in request.query_params["bbox"].split(","))
    except (KeyError, ValueError):
        return JSONResponse({"error": "bbox=west,south,east,north"}, status_code=400)
    database = get_db(request)
    missing = await missing_outlines(database)
    if missing:
        return missing
    areas = await areas_over(database, {"w": west, "s": south, "e": east, "n": north}, MOST_AREAS)
    if areas is None:
        return JSONResponse({"error": "Zoom in to see building numbers"}, status_code=413)

    def in_view(point: tuple[float, float]) -> bool:
        return west <= point[0] <= east and south <= point[1] <= north

    features, hidden = [], []
    for code, prefix, outline in areas:
        numbers = await area_numbers(code, outline)
        for building, number in numbers.numbers.items():
            point = numbers.points[building]
            if in_view(point):
                features.append(number_feature(prefix, number, point))
        hidden += [building for building, point in numbers.slivers.items() if in_view(point)]
    return JSONResponse({"type": "FeatureCollection", "features": features, "hidden": hidden})


def number_feature(prefix: str, number: int, point: tuple[float, float]) -> dict:
    """A building's number on the map: a point inside it."""
    return {
        "type": "Feature",
        "geometry": {"type": "Point", "coordinates": list(point)},
        "properties": {"prefix": prefix, "number": number},
    }


async def building_names(request: Request) -> Response:
    """A building's number and its own name, each null when it has none."""
    try:
        lon, lat = float(request.query_params["lon"]), float(request.query_params["lat"])
        building = int(request.query_params["id"])
    except (KeyError, ValueError):
        return JSONResponse({"error": "lon, lat and id"}, status_code=400)
    database = get_db(request)
    return JSONResponse(
        {"number": await number_of(database, building, lon, lat), "name": await osm_name(database, building)}
    )


async def number_of(database: AsyncConnection, building: int, lon: float, lat: float) -> str | None:
    """A building's number ("STR-NEU-12"); None for a sliver, or without the communes'
    outlines."""
    if await missing_outlines(database):
        return None
    for code, prefix, outline in (
        await areas_over(database, {"w": lon, "s": lat, "e": lon, "n": lat}, MOST_AREAS) or []
    ):
        number = (await area_numbers(code, outline)).numbers.get(building)
        if number is not None:
            return label(prefix, number)
    return None


async def osm_name(database: AsyncConnection, building: int) -> str | None:
    """The name OpenStreetMap gives a building (osm_building_name, filled at build by
    scripts/building_names.py; a database exported before it has none)."""
    if not await database.scalar(text("SELECT to_regclass('osm_building_name') IS NOT NULL")):
        return None
    found = await database.scalar(
        text("SELECT name FROM osm_building_name WHERE building_id = :id"), {"id": building}
    )
    return str(found) if found else None


async def missing_outlines(database: AsyncConnection) -> Response | None:
    """An answer saying what to do if the communes' outlines haven't been imported."""
    if await database.scalar(text("SELECT to_regclass('extra.neighbourhood') IS NOT NULL")):
        return None
    return JSONResponse(
        {"error": "No commune outlines: import the extra data fr-communes (scripts/extra_data.py)"},
        status_code=404,
    )


async def areas_over(database: AsyncConnection, box: dict, most: int) -> list[tuple[str, str, str]] | None:
    """The areas touching a box (code, prefix, outline); None if there are more than
    `most` (too far out)."""
    found = (await database.execute(text(AREAS), {**box, "most": most + 1})).all()
    if len(found) > most:
        return None
    return [(code, prefix, outline) for code, prefix, outline in found]


routes = [
    Route("/background/building-numbers", numbers_in_view),
    Route("/background/building-names", building_names),
]
