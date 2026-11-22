"""Fork: building numbers, for a shared map ("WIS-47": the 47th building of Wisches),
as a gridded reference graphic numbers them (numbering.py). Per commune (France's,
extra data `fr-communes`: their outlines and short codes), numbered the first time
asked for and kept (register.py), so a number never changes for anyone.

    /background/building-numbers?bbox=w,s,e,n     the numbered buildings in a view (GeoJSON
        points, "label": "WIS-47"): the communes it touches numbered first (a few
        seconds the first time). Asked for zoomed in only (the map's key entry).
"""

from __future__ import annotations

from sqlalchemy import text
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from ..userdata.schema import ensure_schema
from .numbering import label
from .register import number_commune

# A view touching more communes than this is too far out to number (the map asks
# from zoom 16, a few streets).
MOST_COMMUNES = 6


async def numbers_in_view(request: Request) -> Response:
    try:
        west, south, east, north = (float(v) for v in request.query_params["bbox"].split(","))
    except (KeyError, ValueError):
        return JSONResponse({"error": "bbox=west,south,east,north"}, status_code=400)
    database = get_db(request)
    # The register's tables (userdata migration 004), made on first use.
    await ensure_schema(database)
    if not await database.scalar(text("SELECT to_regclass('extra.commune') IS NOT NULL")):
        return JSONResponse(
            {"error": "No commune outlines: import the extra data fr-communes (scripts/extra_data.py)"},
            status_code=404,
        )
    view = {"w": west, "s": south, "e": east, "n": north}
    communes = (
        await database.execute(
            text(
                """SELECT code, abbreviation, ST_AsGeoJSON(ST_Transform(geometry, 4326))
                     FROM extra.commune
                    WHERE geometry && ST_Transform(ST_MakeEnvelope(:w, :s, :e, :n, 4326), 3857)
                    LIMIT :most"""
            ),
            {**view, "most": MOST_COMMUNES + 1},
        )
    ).all()
    if len(communes) > MOST_COMMUNES:
        return JSONResponse({"error": "Zoom in to see building numbers"}, status_code=413)
    for code, _, outline in communes:
        await number_commune(database, code, outline)
    abbreviations = {code: abbreviation for code, abbreviation, _ in communes}
    rows = await database.execute(
        text(
            """SELECT commune, number, ST_X(geometry), ST_Y(geometry) FROM userdata.building_ref
                WHERE geometry && ST_MakeEnvelope(:w, :s, :e, :n, 4326) AND commune = ANY(:codes)"""
        ),
        {**view, "codes": list(abbreviations)},
    )
    features = [
        {
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"label": label(abbreviations[commune], number)},
        }
        for commune, number, lon, lat in rows
    ]
    return JSONResponse({"type": "FeatureCollection", "features": features})


routes = [Route("/background/building-numbers", numbers_in_view)]
