"""Fork: situations, named points in My layers' history (userdata.situation)."""

from typing import Any

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from .layers import read_json
from .schema import ensure_schema


def situation_json(r: Any) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "change_id": r.change_id,
        "author": r.author,
        "created_at": r.created_at.isoformat(),
        "at": r.at.isoformat() if r.at else None,
    }


SITUATION_COLUMNS = """s.id, s.name, s.change_id, s.author, s.created_at,
    (SELECT made_at FROM userdata.change WHERE id = s.change_id) AS at"""


async def situations(request: Request) -> Response:
    """GET: the saved situations, oldest first. POST {"name", "author"}: save the
    layers as they are now (up to the last saved change) as a situation."""
    db = get_db(request)
    await ensure_schema(db)
    if request.method == "POST":
        body = await read_json(request)
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "A situation needs a name")
        last = (await db.execute(text("SELECT max(id) FROM userdata.change"))).scalar()
        if last is None:
            raise HTTPException(400, "Nothing is saved yet: save your layers first")
        row = (
            await db.execute(
                text(
                    f"""WITH s AS (INSERT INTO userdata.situation (name, change_id, author)
                                   VALUES (:name, :change_id, :author) RETURNING *)
                        SELECT {SITUATION_COLUMNS} FROM s"""
                ),
                {"name": name[:200], "change_id": last, "author": body.get("author") or None},
            )
        ).one()
        await db.commit()
        return JSONResponse(situation_json(row))
    rows = (
        await db.execute(text(f"SELECT {SITUATION_COLUMNS} FROM userdata.situation s ORDER BY s.id"))
    ).all()
    return JSONResponse({"situations": [situation_json(r) for r in rows]})


async def delete_situation(request: Request) -> Response:
    db = get_db(request)
    await ensure_schema(db)
    try:
        situation_id = int(request.path_params["situation_id"])
    except ValueError:
        raise HTTPException(400, "Invalid situation id")
    await db.execute(text("DELETE FROM userdata.situation WHERE id = :id"), {"id": situation_id})
    await db.commit()
    return JSONResponse({"deleted": situation_id})
