"""Fork: buildings' interiors (docs/plans/indoor-maps.md). The data: osm_indoor
(scripts/indoor.py) and indoor_building (link.py, `python -m src.fork.indoor`); the
map draws the floor plans from Tegola's indoor map (tegola/layers.fork.yml).

    /indoor/building/{id}?lon=&lat=     a building's (or an underground place's,
        negative id) floors, when it has a floor plan ({"levels": [-1, 0, 1]}), and
        what's inside ("inside": each with its name or null, what it is, its floors
        or null, where): the interiors' points with a floor, and the background map's points
        of interest inside the building (lon, lat: a point in it) with none written.
"""

from __future__ import annotations

from shapely.geometry import shape
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.concurrency import run_in_threadpool
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from ..background.buildings import outline, tiles_over
from ..background.pois import pois_in

# Not listed: the furniture and fittings of a place, not what one goes there for (the
# owner, 2026-11-23: lifts, waste baskets, outdoor seating, pickup stations, waiting
# areas...). OpenStreetMap's values, the interiors' and the background map's alike.
NOT_LISTED = {
    "elevator",
    "escalator",
    "waste_basket",
    "recycling",
    "bench",
    "outdoor_seating",
    "waiting_area",
    "parcel_locker",
    "vending_machine",
    "information",
    "ticket_validator",
    "parking_space",
    "parking_entrance",
    "bicycle_parking",
    "shelter",
    "pitch",
    "drinking_water",
    "telephone",
    "clock",
}
# What a point is, from the first of these tags it has ("bakery", "toilets").
WHAT_TAGS = ("shop", "amenity", "office", "craft", "healthcare", "tourism", "leisure", "vending")

# The interiors' pieces listed: what stands inside, and named rooms and open areas (a
# station's shops are often rooms: Relay, Paul); worth_listing keeps what's worth it.
LISTED = ("poi", "room", "area", "elevator", "escalator")

INSIDE = """
    SELECT name, kind, tags, levels, level_given, ST_X(p), ST_Y(p)
      FROM (SELECT *, ST_Transform(ST_PointOnSurface(geometry), 4326) AS p FROM osm_indoor
             WHERE building_id = :id AND kind = ANY(:listed)) AS listed
     ORDER BY level_low, name
"""


async def building_inside(request: Request) -> Response:
    try:
        building = int(request.path_params["id"])
        at = (float(request.query_params["lon"]), float(request.query_params["lat"]))
    except (KeyError, ValueError):
        return JSONResponse({"error": "a building id, lon and lat"}, status_code=400)
    database = get_db(request)
    if not await database.scalar(text("SELECT to_regclass('indoor_building') IS NOT NULL")):
        return JSONResponse({"levels": [], "inside": []})
    levels = await database.scalar(
        text("SELECT levels FROM indoor_building WHERE building_id = :id"), {"id": building}
    )
    with_floor = await interior_points(database, building)
    # An underground place has no building on the map, so none of its points.
    on_map = await run_in_threadpool(map_points, building, at) if building > 0 else []
    named = {item["name"].lower() for item in with_floor if item["name"]}
    found = with_floor + [item for item in on_map if item["name"].lower() not in named]
    inside = [item for item in found if worth_listing(item)]
    return JSONResponse({"levels": [level_number(level) for level in levels or []], "inside": inside})


async def interior_points(database: AsyncConnection, building: int) -> list[dict]:
    """The interiors' points in a building: shops, toilets, lifts, with their floors."""
    rows = await database.execute(text(INSIDE), {"id": building, "listed": list(LISTED)})
    found = []
    for name, kind, tags, levels, given, lon, lat in rows:
        what = what_of(kind, tags)
        found.append({"name": name, "what": what, "levels": levels if given else None, "at": [lon, lat]})
    return found


def worth_listing(item: dict) -> bool:
    """Something one goes there for: named, not furniture."""
    return bool(item["name"]) and item["what"] not in NOT_LISTED


def what_of(kind: str, tags: dict) -> str:
    """What a thing is: its first WHAT_TAGS value ("bakery"); a lift or an escalator
    as such; "poi" when nothing says (a room named "Hall 4")."""
    if kind in ("elevator", "escalator"):
        return kind
    return next((str(tags[tag]) for tag in WHAT_TAGS if tag in tags), "poi")


def map_points(building: int, at: tuple[float, float]) -> list[dict]:
    """The background map's points of interest inside the building (no floor known)."""
    whole = outline(building, *at)
    if whole is None:
        return []
    geometry = shape(whole)
    return [{**poi, "levels": None} for poi in pois_in(geometry, tiles_over(geometry.bounds))]


def level_number(level: float) -> float | int:
    """A floor as it's written: 1, not 1.0 (0.5 stays)."""
    return int(level) if float(level).is_integer() else float(level)


routes = [Route("/indoor/building/{id}", building_inside)]
