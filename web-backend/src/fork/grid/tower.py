"""Fork: a tower's numbers along the lines it carries (grid/__init__.py,
tower_numbers.py).

    GET /grid/tower/<osm_id>
"""

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db


async def tower(request: Request) -> Response:
    """A tower's number on each line it carries (tower_numbers.py), highest voltage
    first: [{number, total, voltage_kv, name, start, end}].

        GET /grid/tower/<osm_id>
    """
    database = get_db(request)
    try:
        osm_id = int(request.path_params["osm_id"])
    except ValueError:
        raise HTTPException(400, "Invalid tower id")
    if not (await database.execute(text("SELECT to_regclass('tower_number') IS NOT NULL"))).scalar():
        return JSONResponse({"lines": []})  # built before towers were numbered
    rows = await database.execute(
        text(
            """SELECT n.number, n.total, n.voltage / 1000 AS voltage_kv, l.name,
                      l.start_name AS start, l.end_name AS end
                 FROM tower_number AS n JOIN tower_line AS l USING (line_id)
                WHERE n.osm_id = :osm_id
                ORDER BY n.voltage DESC"""
        ),
        {"osm_id": osm_id},
    )
    return JSONResponse({"lines": [dict(r._mapping) for r in rows]})
