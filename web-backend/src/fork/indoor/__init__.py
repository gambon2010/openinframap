"""Fork: buildings' interiors (docs/plans/indoor-maps.md). The data: osm_indoor
(scripts/indoor.py) and indoor_building (link.py, `python -m src.fork.indoor`); the
map draws them from Tegola's indoor map (tegola/layers.fork.yml).

    /indoor/building/{id}     a building's floors ({"levels": [-1, 0, 1]}), [] when it
        has no interior: its details' floor choice.
"""

from __future__ import annotations

from sqlalchemy import text
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db


async def building_levels(request: Request) -> Response:
    try:
        building = int(request.path_params["id"])
    except ValueError:
        return JSONResponse({"error": "a building id"}, status_code=400)
    database = get_db(request)
    if not await database.scalar(text("SELECT to_regclass('indoor_building') IS NOT NULL")):
        return JSONResponse({"levels": []})
    levels = await database.scalar(
        text("SELECT levels FROM indoor_building WHERE building_id = :id"), {"id": building}
    )
    return JSONResponse({"levels": [level_number(level) for level in levels or []]})


def level_number(level: float) -> float | int:
    """A floor as it's written: 1, not 1.0 (0.5 stays)."""
    return int(level) if float(level).is_integer() else float(level)


routes = [Route("/indoor/building/{id}", building_levels)]
