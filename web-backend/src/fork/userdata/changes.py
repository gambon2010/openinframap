"""Fork: applying My layers' changes to the database and logging them (no HTTP)."""

import json
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException

from . import access
from .users import ANYONE, User

LAYER_OPS = {"layer_create", "layer_update", "layer_delete"}
FEATURE_OPS = {"feature_create", "feature_update", "feature_delete"}


def parse_time(value: Any) -> datetime:
    """When a change was made, as the browser says (ISO 8601); now if it can't be read."""
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def parse_uuid(value: Any, what: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError:
        raise HTTPException(400, f"Invalid {what}")


async def layer_json(db: AsyncConnection, layer_id: uuid.UUID) -> dict | None:
    row = (
        await db.execute(
            text("SELECT id, name, style FROM userdata.layer WHERE id = :id AND NOT deleted"),
            {"id": layer_id},
        )
    ).first()
    if not row:
        return None
    return {"id": str(row.id), "name": row.name, "style": row.style}


async def feature_json(db: AsyncConnection, feature_id: uuid.UUID) -> dict | None:
    row = (
        await db.execute(
            text(
                """SELECT id, layer_id, ST_AsGeoJSON(geometry) AS geometry, properties
                     FROM userdata.feature WHERE id = :id AND NOT deleted"""
            ),
            {"id": feature_id},
        )
    ).first()
    if not row:
        return None
    return {
        "type": "Feature",
        "id": str(row.id),
        "layer_id": str(row.layer_id),
        "geometry": json.loads(row.geometry),
        "properties": row.properties,
    }


async def apply_change(db: AsyncConnection, save_id: int, change: dict, user: User = ANYONE) -> None:
    """Apply one change and log it, if the user may (access.py): a new layer is
    theirs; changing a layer's items, name or colour needs modify access; its lock,
    deleting it or making it again, the owner; moving an item, modify on both layers."""
    op = change.get("op")
    if op not in LAYER_OPS | FEATURE_OPS:
        raise HTTPException(400, f"Unknown change: {op}")
    layer_id = parse_uuid(change.get("layer_id"), "layer id")
    data = change.get("data") or {}
    made_at = change.get("made_at")

    if op in LAYER_OPS:
        before = await layer_json(db, layer_id)
        if op == "layer_update":
            await access.require(db, user, layer_id, "modify")
            locked = (before or {}).get("style", {}).get("locked")
            if "style" in data and bool((data.get("style") or {}).get("locked")) != bool(locked):
                await access.require(db, user, layer_id, "owner")
        else:
            await access.require(db, user, layer_id, "owner")
        if op == "layer_create":
            await db.execute(
                text(
                    """INSERT INTO userdata.layer (id, name, style, owner_id)
                       VALUES (:id, :name, :style, :owner)
                       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, style = EXCLUDED.style,
                           deleted = false, updated_at = now()"""
                ),
                {
                    "id": layer_id,
                    "name": str(data.get("name") or "Layer"),
                    "style": json.dumps(data.get("style") or {}),
                    "owner": int(user.id) if user.id is not None else None,
                },
            )
        elif op == "layer_update":
            if before is None:
                raise HTTPException(409, "That layer doesn't exist (any more)")
            await db.execute(
                text(
                    """UPDATE userdata.layer SET name = :name, style = :style, updated_at = now()
                        WHERE id = :id"""
                ),
                {
                    "id": layer_id,
                    "name": str(data.get("name", before["name"])),
                    "style": json.dumps(data.get("style", before["style"])),
                },
            )
        else:
            await db.execute(
                text("UPDATE userdata.layer SET deleted = true, updated_at = now() WHERE id = :id"),
                {"id": layer_id},
            )
        after = await layer_json(db, layer_id)
        feature_id = None
    else:
        feature_id = parse_uuid(change.get("feature_id"), "feature id")
        before = await feature_json(db, feature_id)
        await access.require(db, user, layer_id, "modify")
        if before and before["layer_id"] != str(layer_id):
            await access.require(db, user, uuid.UUID(before["layer_id"]), "modify")
        if op == "feature_delete":
            await db.execute(
                text("UPDATE userdata.feature SET deleted = true, updated_at = now() WHERE id = :id"),
                {"id": feature_id},
            )
        else:
            geometry = data.get("geometry") or (before or {}).get("geometry")
            if not geometry:
                raise HTTPException(400, "A feature needs a geometry")
            properties = data.get("properties", (before or {}).get("properties", {}))
            await db.execute(
                text(
                    """INSERT INTO userdata.feature (id, layer_id, geometry, properties)
                       VALUES (:id, :layer_id, ST_SetSRID(ST_GeomFromGeoJSON(:geometry), 4326), :properties)
                       ON CONFLICT (id) DO UPDATE SET layer_id = EXCLUDED.layer_id,
                           geometry = EXCLUDED.geometry, properties = EXCLUDED.properties,
                           deleted = false, updated_at = now()"""
                ),
                {
                    "id": feature_id,
                    "layer_id": layer_id,
                    "geometry": json.dumps(geometry),
                    "properties": json.dumps(properties),
                },
            )
        after = await feature_json(db, feature_id)

    await db.execute(
        text(
            """INSERT INTO userdata.change (save_id, op, layer_id, feature_id, before, after, made_at)
               VALUES (:save_id, :op, :layer_id, :feature_id, :before, :after, :made_at)"""
        ),
        {
            "save_id": save_id,
            "op": op,
            "layer_id": layer_id,
            "feature_id": feature_id,
            "before": json.dumps(before) if before is not None else None,
            "after": json.dumps(after) if after is not None else None,
            "made_at": parse_time(made_at),
        },
    )
