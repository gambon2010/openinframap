"""
Fork: sharing a layer (docs/plans/sync.md, "Owners and sharing"), for its owner.

    GET /userdata/layers/{id}/access   {owner, people: [{id, name, level}]}: every
                                       other account and its access (null: none)
    PUT /userdata/layers/{id}/access   {user_id, level: "view" | "modify" | null}
"""

from __future__ import annotations

import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from . import access
from .changes import parse_uuid
from .layers import read_json
from .schema import ensure_schema
from .users import current_user


async def owned(request: Request) -> tuple[AsyncConnection, uuid.UUID]:
    db = get_db(request)
    await ensure_schema(db)
    layer_id = parse_uuid(request.path_params["layer_id"], "layer id")
    exists = (
        await db.execute(
            text("SELECT 1 FROM userdata.layer WHERE id = :id AND NOT deleted"), {"id": layer_id}
        )
    ).first()
    if not exists:
        raise HTTPException(404, "That layer doesn't exist (any more)")
    await access.require(db, current_user(request), layer_id, "owner")
    return db, layer_id


async def people(db: AsyncConnection, layer_id: uuid.UUID) -> Response:
    """Every account but the owner, and its access."""
    owner = (
        await db.execute(
            text(
                """SELECT u.id, u.name FROM userdata.layer AS l
                     LEFT JOIN userdata.app_user AS u ON u.id = l.owner_id WHERE l.id = :id"""
            ),
            {"id": layer_id},
        )
    ).one()
    rows = await db.execute(
        text(
            """SELECT u.id, u.name, a.level FROM userdata.app_user AS u
                 LEFT JOIN userdata.layer_access AS a ON a.user_id = u.id AND a.layer_id = :layer
                WHERE NOT u.disabled AND u.id IS DISTINCT FROM :owner
                ORDER BY lower(u.name)"""
        ),
        {"layer": layer_id, "owner": owner.id},
    )
    return JSONResponse(
        {
            "owner": owner.name,
            "people": [{"id": r.id, "name": r.name, "level": r.level} for r in rows],
        }
    )


async def layer_access(request: Request) -> Response:
    db, layer_id = await owned(request)
    if request.method == "GET":
        return await people(db, layer_id)
    body = await read_json(request)
    try:
        user_id = int(str(body.get("user_id")))
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid account")
    level = body.get("level")
    if level not in ("view", "modify", None):
        raise HTTPException(400, "Access is view, modify or none")
    owner_id = (
        await db.execute(text("SELECT owner_id FROM userdata.layer WHERE id = :id"), {"id": layer_id})
    ).scalar()
    if user_id == owner_id:
        raise HTTPException(400, "That's the layer's owner")
    if level is None:
        await db.execute(
            text("DELETE FROM userdata.layer_access WHERE layer_id = :layer AND user_id = :user"),
            {"layer": layer_id, "user": user_id},
        )
    else:
        await db.execute(
            text(
                """INSERT INTO userdata.layer_access (layer_id, user_id, level) VALUES (:layer, :user, :level)
                   ON CONFLICT (layer_id, user_id) DO UPDATE SET level = EXCLUDED.level"""
            ),
            {"layer": layer_id, "user": user_id, "level": level},
        )
    await db.commit()
    return await people(db, layer_id)
