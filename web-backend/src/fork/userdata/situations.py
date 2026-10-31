"""Fork: situations, named points in My layers' history (userdata.situation)."""

from typing import Any

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from .layers import read_json
from . import access
from .schema import ensure_schema
from .users import current_user


def situation_json(r: Any) -> dict:
    return {
        "id": r.id,
        "name": r.name,
        "change_id": r.change_id,
        "author": r.author,
        "created_at": r.created_at.isoformat(),
        "at": r.at.isoformat() if r.at else None,
        "layers": [str(layer) for layer in r.layer_ids] if r.layer_ids is not None else None,
    }


SITUATION_COLUMNS = """s.id, s.name, s.change_id, s.author, s.created_at, s.layer_ids,
    (SELECT made_at FROM userdata.change WHERE id = s.change_id) AS at"""


def visible(layer_ids: list | None, seen: set[str]) -> bool:
    """A situation is seen by who can view all its layers (all: from before)."""
    return layer_ids is None or all(str(layer) in seen for layer in layer_ids)


async def situations(request: Request) -> Response:
    """GET: the saved situations the user can see, oldest first. POST {"name",
    "layers"?}: save the layers as they are now (up to the last saved change) as a
    situation, covering those layers (default: every layer the user can see)."""
    db = get_db(request)
    await ensure_schema(db)
    user = current_user(request)
    levels = await access.levels(db, user, deleted=True)
    seen = {k for k, v in levels.items() if access.at_least(v, "view")}
    if request.method == "POST":
        body = await read_json(request)
        name = str(body.get("name") or "").strip()
        if not name:
            raise HTTPException(400, "A situation needs a name")
        layers = body.get("layers")
        if layers is None:
            live = await access.levels(db, user)
            layers = [k for k, v in live.items() if access.at_least(v, "view")]
        if not isinstance(layers, list) or not layers or any(str(layer) not in seen for layer in layers):
            raise HTTPException(400, "A situation covers layers you can see")
        last = (await db.execute(text("SELECT max(id) FROM userdata.change"))).scalar()
        if last is None:
            raise HTTPException(400, "Nothing is saved yet: save your layers first")
        row = (
            await db.execute(
                text(
                    f"""WITH s AS (INSERT INTO userdata.situation (name, change_id, author, layer_ids)
                                   VALUES (:name, :change_id, :author, CAST(:layers AS uuid[])) RETURNING *)
                        SELECT {SITUATION_COLUMNS} FROM s"""
                ),
                {
                    "name": name[:200],
                    "change_id": last,
                    "author": user.name or body.get("author") or None,
                    "layers": [str(layer) for layer in layers],
                },
            )
        ).one()
        await db.commit()
        return JSONResponse(situation_json(row))
    rows = (
        await db.execute(text(f"SELECT {SITUATION_COLUMNS} FROM userdata.situation s ORDER BY s.id"))
    ).all()
    return JSONResponse({"situations": [situation_json(r) for r in rows if visible(r.layer_ids, seen)]})


async def delete_situation(request: Request) -> Response:
    db = get_db(request)
    await ensure_schema(db)
    try:
        situation_id = int(request.path_params["situation_id"])
    except ValueError:
        raise HTTPException(400, "Invalid situation id")
    row = (
        await db.execute(
            text("SELECT layer_ids FROM userdata.situation WHERE id = :id"), {"id": situation_id}
        )
    ).first()
    levels = await access.levels(db, current_user(request), deleted=True)
    if row is None or not visible(
        row.layer_ids, {k for k, v in levels.items() if access.at_least(v, "view")}
    ):
        raise HTTPException(404, "No such situation")
    await db.execute(text("DELETE FROM userdata.situation WHERE id = :id"), {"id": situation_id})
    await db.commit()
    return JSONResponse({"deleted": situation_id})
