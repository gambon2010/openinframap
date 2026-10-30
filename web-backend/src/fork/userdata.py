"""
Fork: "My layers" storage (schema: userdata.sql; frontend: web/src/fork/userlayers/).

The browser keeps unsaved changes and sends them all with "Save" (POST
/userdata/save); each is applied and logged with its state before and after, so
the history can be played back (GET /userdata/history). Also images people put on
the map, and the full geometry of a map feature being copied into a layer (tiles
only have it cut at tile edges and simplified at low zoom).
"""

import base64
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import Request, get_db

SCHEMA_SQL = (Path(__file__).parent / "userdata.sql").read_text()

# Tile layer -> (table, id column): where a copied map feature's full geometry is.
SOURCE_TABLES: dict[str, tuple[str, str]] = {
    "power_line": ("osm_power_line", "osm_id"),
    "power_tower": ("osm_power_tower", "osm_id"),
    "power_portal_way": ("osm_power_tower", "osm_id"),
    "power_substation": ("substation", "osm_id"),
    "power_substation_point": ("substation", "osm_id"),
    "power_plant": ("power_plant", "osm_id"),
    "power_plant_point": ("power_plant", "osm_id"),
    "power_generator": ("osm_power_generator", "osm_id"),
    "power_generator_area": ("osm_power_generator", "osm_id"),
    "power_transformer": ("osm_power_switchgear", "osm_id"),
    "power_compensator": ("osm_power_switchgear", "osm_id"),
    "power_switch": ("osm_power_switchgear", "osm_id"),
    "telecoms_communication_line": ("osm_telecom_cable", "osm_id"),
    "telecoms_data_center": ("osm_telecom_building", "osm_id"),
    "telecoms_data_center_point": ("osm_telecom_building", "osm_id"),
    "telecoms_mast": ("osm_mast", "osm_id"),
    "telecoms_antenna": ("osm_telecom_antenna", "osm_id"),
    "telecoms_cabinet": ("osm_street_cabinet", "osm_id"),
    "petroleum_pipeline": ("osm_pipeline", "osm_id"),
    "other_pipeline": ("osm_pipeline", "osm_id"),
    "water_pipeline": ("osm_pipeline", "osm_id"),
    "petroleum_well": ("osm_petroleum_well", "osm_id"),
    "petroleum_site": ("osm_petroleum_site", "osm_id"),
    "pressurised_waterway": ("osm_pressurised_waterway", "osm_id"),
    "water_treatment_plant_polygon": ("osm_water_treatment_plant", "osm_id"),
    "water_treatment_plant_point": ("osm_water_treatment_plant", "osm_id"),
    "wastewater_plant_polygon": ("osm_wastewater_plant", "osm_id"),
    "wastewater_plant_point": ("osm_wastewater_plant", "osm_id"),
    "water_reservoir": ("osm_water_reservoir", "osm_id"),
    "water_reservoir_point": ("osm_water_reservoir", "osm_id"),
    "water_tower": ("osm_water_tower", "osm_id"),
    "water_well": ("osm_water_well", "osm_id"),
    "pumping_station_polygon": ("osm_pumping_station", "osm_id"),
    "pumping_station_point": ("osm_pumping_station", "osm_id"),
    "water_cabinet": ("osm_street_cabinet", "osm_id"),
    "extra_power_line": ("extra.power_line", "id"),
    "extra_power_substation": ("extra.power_substation", "id"),
    "extra_pipeline": ("extra.pipeline", "id"),
    "extra_facility": ("extra.facility", "id"),
    "sites_area": ("osm_site", "osm_id"),
    "sites_point": ("osm_site", "osm_id"),
}

LAYER_OPS = {"layer_create", "layer_update", "layer_delete"}
FEATURE_OPS = {"feature_create", "feature_update", "feature_delete"}
MAX_IMAGE_BYTES = 2_000_000

_schema_ready = False


async def ensure_schema(db: AsyncConnection) -> None:
    """Create the userdata schema on first use (databases built before it existed)."""
    global _schema_ready
    if _schema_ready:
        return
    # The newest table: an older database gets what it lacks (every statement in
    # userdata.sql is "if not exists", so running it again is safe).
    exists = (await db.execute(text("SELECT to_regclass('userdata.situation') IS NOT NULL"))).scalar()
    if not exists:
        # One statement at a time (asyncpg doesn't run several in one call).
        for statement in SCHEMA_SQL.split(";\n"):
            code = "\n".join(line for line in statement.splitlines() if not line.strip().startswith("--"))
            if code.strip():
                await db.execute(text(code))
        await db.commit()
    _schema_ready = True


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


async def apply_change(db: AsyncConnection, save_id: int, change: dict) -> None:
    op = change.get("op")
    if op not in LAYER_OPS | FEATURE_OPS:
        raise HTTPException(400, f"Unknown change: {op}")
    layer_id = parse_uuid(change.get("layer_id"), "layer id")
    data = change.get("data") or {}
    made_at = change.get("made_at") or datetime.now(timezone.utc).isoformat()

    if op in LAYER_OPS:
        before = await layer_json(db, layer_id)
        if op == "layer_create":
            await db.execute(
                text(
                    """INSERT INTO userdata.layer (id, name, style) VALUES (:id, :name, :style)
                       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, style = EXCLUDED.style,
                           deleted = false, updated_at = now()"""
                ),
                {
                    "id": layer_id,
                    "name": str(data.get("name") or "Layer"),
                    "style": json.dumps(data.get("style") or {}),
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
            "made_at": datetime.fromisoformat(str(made_at).replace("Z", "+00:00")),
        },
    )


async def save(request: Request) -> Response:
    """Apply the browser's unsaved changes, in order, all or nothing."""
    db = get_db(request)
    await ensure_schema(db)
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "Expected JSON")
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
        body = await request.json()
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


async def add_image(request: Request) -> Response:
    """An image for the map: {"name", "mime", "data": base64}. Returns its id."""
    db = get_db(request)
    await ensure_schema(db)
    body = await request.json()
    mime = str(body.get("mime") or "")
    if mime not in ("image/png", "image/jpeg", "image/webp", "image/svg+xml"):
        raise HTTPException(400, "Only PNG, JPEG, WebP or SVG images")
    try:
        data = base64.b64decode(body.get("data") or "", validate=True)
    except ValueError:
        raise HTTPException(400, "Invalid image data")
    if not data or len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(400, "Image empty or too big (2 MB at most)")
    image_id = uuid.uuid4()
    await db.execute(
        text("INSERT INTO userdata.image (id, name, mime, data) VALUES (:id, :name, :mime, :data)"),
        {"id": image_id, "name": body.get("name"), "mime": mime, "data": data},
    )
    await db.commit()
    return JSONResponse({"id": str(image_id)})


async def get_image(request: Request) -> Response:
    db = get_db(request)
    await ensure_schema(db)
    image_id = parse_uuid(request.path_params["image_id"], "image id")
    row = (
        await db.execute(text("SELECT mime, data FROM userdata.image WHERE id = :id"), {"id": image_id})
    ).first()
    if not row:
        raise HTTPException(404, "No such image")
    # Images never change (a new one gets a new id).
    return Response(row.data, media_type=row.mime, headers={"Cache-Control": "max-age=31536000, immutable"})


async def source_feature(request: Request) -> Response:
    """The full geometry of a map feature (tile layer + id), to copy it into a layer."""
    db = get_db(request)
    layer = request.query_params.get("layer", "")
    if layer not in SOURCE_TABLES:
        raise HTTPException(404, "Can't copy from that layer")
    table, id_column = SOURCE_TABLES[layer]
    try:
        feature_id = int(request.query_params.get("id", ""))
    except ValueError:
        raise HTTPException(400, "Invalid id")
    row = (
        await db.execute(
            text(
                f"""SELECT ST_AsGeoJSON(ST_Transform(geometry, 4326), 7) AS geometry
                      FROM {table} WHERE {id_column} = :id LIMIT 1"""
            ),
            {"id": feature_id},
        )
    ).first()
    if not row:
        raise HTTPException(404, "Not found")
    return JSONResponse({"geometry": json.loads(row.geometry)})


routes = [
    Route("/userdata", endpoint=everything),
    Route("/userdata/save", endpoint=save, methods=["POST"]),
    Route("/userdata/history", endpoint=history),
    Route("/userdata/situations", endpoint=situations, methods=["GET", "POST"]),
    Route("/userdata/situations/{situation_id}", endpoint=delete_situation, methods=["DELETE"]),
    Route("/userdata/images", endpoint=add_image, methods=["POST"]),
    Route("/userdata/images/{image_id}", endpoint=get_image),
    Route("/userdata/source-feature", endpoint=source_feature),
]
