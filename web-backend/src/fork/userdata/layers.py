"""Fork: My layers: all the layers, Save, and the history."""

import json

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from . import access
from .changes import apply_change
from .schema import ensure_schema
from .users import current_user


async def read_json(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object")
    return body


async def everything(request: Request) -> Response:
    """The layers the user can see, with their features (GeoJSON, EPSG:4326), their
    access ("view", "modify", "owner") and owner."""
    db = get_db(request)
    await ensure_schema(db)
    user = current_user(request)
    seen = {k: v for k, v in (await access.levels(db, user)).items() if access.at_least(v, "view")}
    layers = (
        await db.execute(
            text(
                """SELECT l.id, l.name, l.style, u.name AS owner
                     FROM userdata.layer AS l LEFT JOIN userdata.app_user AS u ON u.id = l.owner_id
                    WHERE NOT l.deleted ORDER BY l.created_at"""
            )
        )
    ).all()
    layers = [layer for layer in layers if str(layer.id) in seen]
    features = (
        await db.execute(
            text(
                """SELECT f.id, f.layer_id, ST_AsGeoJSON(f.geometry) AS geometry, f.properties
                     FROM userdata.feature f JOIN userdata.layer l ON l.id = f.layer_id
                    WHERE NOT f.deleted AND NOT l.deleted
                    ORDER BY f.created_at"""
            )
        )
    ).all()
    by_layer: dict[str, list[dict]] = {str(layer.id): [] for layer in layers}
    for f in features:
        if str(f.layer_id) not in by_layer:
            continue
        by_layer[str(f.layer_id)].append(
            {
                "type": "Feature",
                "id": str(f.id),
                "geometry": json.loads(f.geometry),
                "properties": f.properties,
            }
        )
    last_save = (await db.execute(text("SELECT max(id) FROM userdata.save"))).scalar()
    return JSONResponse(
        {
            "last_save": last_save,
            "layers": [
                {
                    "id": str(layer.id),
                    "name": layer.name,
                    "style": layer.style,
                    "access": seen[str(layer.id)],
                    "owner": layer.owner,
                    "features": by_layer[str(layer.id)],
                }
                for layer in layers
            ],
        }
    )


async def save(request: Request) -> Response:
    """Apply the browser's unsaved changes, in order, all or nothing."""
    db = get_db(request)
    await ensure_schema(db)
    body = await read_json(request)
    changes = body.get("changes") or []
    if not isinstance(changes, list) or not changes:
        raise HTTPException(400, "No changes")
    user = current_user(request)
    save_id = (
        await db.execute(
            text(
                """INSERT INTO userdata.save (author, note, user_id) VALUES (:author, :note, :user)
                   RETURNING id"""
            ),
            {
                # The account's name when logged in.
                "author": user.name or body.get("author"),
                "note": body.get("note"),
                "user": int(user.id) if user.id is not None else None,
            },
        )
    ).scalar_one()
    try:
        for change in changes:
            await apply_change(db, save_id, change, user)
    except Exception:
        await db.rollback()
        raise
    await db.commit()
    return JSONResponse({"save_id": save_id, "changes": len(changes)})


async def history(request: Request) -> Response:
    """Every saved change to a layer the user can see (deleted ones too, as they
    could), oldest first, for playing the layers' history back."""
    db = get_db(request)
    await ensure_schema(db)
    seen = {
        k
        for k, v in (await access.levels(db, current_user(request), deleted=True)).items()
        if access.at_least(v, "view")
    }
    rows = (
        await db.execute(
            text(
                """SELECT c.id, c.save_id, s.saved_at, s.author, s.note, c.op, c.layer_id,
                          c.feature_id, c.after, c.made_at
                     FROM userdata.change c JOIN userdata.save s ON s.id = c.save_id
                    ORDER BY c.id"""
            )
        )
    ).all()
    return JSONResponse(
        {
            "changes": [
                {
                    "id": r.id,
                    "save_id": r.save_id,
                    "saved_at": r.saved_at.isoformat(),
                    "author": r.author,
                    "note": r.note,
                    "op": r.op,
                    "layer_id": str(r.layer_id),
                    "feature_id": str(r.feature_id) if r.feature_id else None,
                    "after": r.after,
                    "made_at": r.made_at.isoformat(),
                }
                for r in rows
                if str(r.layer_id) in seen
            ]
        }
    )
