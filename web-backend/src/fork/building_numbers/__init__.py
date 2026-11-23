"""Fork: building numbers, for a shared map ("STR-NEU-12": the 12th building of
Neudorf, in Strasbourg; "WIS-47" in a commune with no neighbourhoods), as a gridded
reference graphic numbers them (numbering.py). Per neighbourhood where INSEE splits a
commune, else per commune (extra data `fr-communes`: their outlines and short codes),
numbered the first time asked for and kept (register.py), so a number never changes
for anyone. Slivers (a staircase's steps) aren't numbered, and the map leaves them
out of the buildings outside 3D.

    /background/building-numbers?bbox=w,s,e,n     the numbered buildings in a view
        (GeoJSON points: "prefix" "STR-NEU", "number" 12) and its slivers' ids
        ("hidden"); the areas it touches numbered first (a few seconds the first
        time). Asked for zoomed in only.
    /background/building-number?lon=&lat=&id=     one building's number ("label"),
        for My layers' copy of it.
"""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from ..userdata.schema import ensure_schema
from .numbering import label
from .register import number_area

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
    view = {"w": west, "s": south, "e": east, "n": north}
    areas = await numbered_areas(database, view, MOST_AREAS)
    if areas is None:
        return JSONResponse({"error": "Zoom in to see building numbers"}, status_code=413)
    prefixes = {code: prefix for code, prefix in areas}
    rows = await database.execute(
        text(
            """SELECT area, number, ST_X(geometry), ST_Y(geometry) FROM userdata.building_ref
                WHERE geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326) AND area = ANY(:codes)"""
        ),
        {**view, "codes": list(prefixes)},
    )
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"prefix": prefixes[area], "number": number},
        }
        for area, number, lon, lat in rows
    ]
    hidden = await database.execute(
        text(
            """SELECT building_id FROM userdata.building_sliver
                WHERE geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326) AND area = ANY(:codes)"""
        ),
        {**view, "codes": list(prefixes)},
    )
    return JSONResponse(
        {"type": "FeatureCollection", "features": features, "hidden": [building for (building,) in hidden]}
    )


async def building_number(request: Request) -> Response:
    try:
        lon, lat = float(request.query_params["lon"]), float(request.query_params["lat"])
        building = int(request.query_params["id"])
    except (KeyError, ValueError):
        return JSONResponse({"error": "lon, lat and id"}, status_code=400)
    database = get_db(request)
    missing = await missing_outlines(database)
    if missing:
        return missing
    point = {"w": lon, "s": lat, "e": lon, "n": lat}
    areas = await numbered_areas(database, point, MOST_AREAS) or []
    prefixes = {code: prefix for code, prefix in areas}
    found = (
        await database.execute(
            text("SELECT area, number FROM userdata.building_ref WHERE building_id = :id"), {"id": building}
        )
    ).first()
    if not found or found[0] not in prefixes:
        return JSONResponse({"error": "No number for this building"}, status_code=404)
    area, number = found
    return JSONResponse({"label": label(prefixes[area], number)})


async def missing_outlines(database: AsyncConnection) -> Response | None:
    """The register's tables made (userdata migrations), and an answer saying what to
    do if the communes' outlines haven't been imported."""
    await ensure_schema(database)
    if await database.scalar(text("SELECT to_regclass('extra.neighbourhood') IS NOT NULL")):
        return None
    return JSONResponse(
        {"error": "No commune outlines: import the extra data fr-communes (scripts/extra_data.py)"},
        status_code=404,
    )


async def numbered_areas(database: AsyncConnection, box: dict, most: int) -> list[tuple[str, str]] | None:
    """The areas touching a box, numbered if they weren't (code, prefix); None if there
    are more than `most` (too far out)."""
    found = (await database.execute(text(AREAS), {**box, "most": most + 1})).all()
    if len(found) > most:
        return None
    for code, _, outline in found:
        await number_area(database, code, outline)
    return [(code, prefix) for code, prefix, _ in found]


routes = [
    Route("/background/building-numbers", numbers_in_view),
    Route("/background/building-number", building_number),
]
