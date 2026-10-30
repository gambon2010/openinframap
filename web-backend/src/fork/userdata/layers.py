"""Fork: My layers: all the layers, Save, and the history."""

import json

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from .changes import apply_change
from .schema import ensure_schema


async def read_json(request: Request) -> dict:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "Expected a JSON object")
    return body


async def everything(request: Request) -> Response:
    """All layers with their features (GeoJSON, EPSG:4326)."""
    db = get_db(request)
    await ensure_schema(db)
    layers = (
        await db.execute(
            text("SELECT id, name, style FROM userdata.layer WHERE NOT deleted ORDER BY created_at")
        )
    ).all()
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
    save_id = (
        await db.execute(
            text("INSERT INTO userdata.save (author, note) VALUES (:author, :note) RETURNING id"),
            {"author": body.get("author"), "note": body.get("note")},
        )
    ).scalar_one()
    try:
        for change in changes:
            await apply_change(db, save_id, change)
    except Exception:
        await db.rollback()
        raise
    await db.commit()
    return JSONResponse({"save_id": save_id, "changes": len(changes)})


async def history(request: Request) -> Response:
    """Every saved change, oldest first, for playing the layers' history back."""
    db = get_db(request)
    await ensure_schema(db)
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
            ]
        }
    )
