"""
Fork: statuses of map features (docs/plans/feature-status.md, step 1): a power
line damaged, a substation destroyed... Shared by everyone, with their own history
(userdata.feature_status, userdata.status_change), separate from My layers.

    GET  /userdata/status                       the features with a problem (GeoJSON)
    GET  /userdata/status/feature?layer=&id=    one feature's status and history
    POST /userdata/status                       {layer, id, status, evidence?, note?,
                                                 details?, name?, author?}: set it
                                                (details: the extra fields, FIELDS)
"""

import json
from typing import Any

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from ..map_data import SOURCE_TABLES
from .layers import read_json
from .schema import ensure_schema
from .users import can_set_statuses, current_user

STATUSES = (
    "operational",
    "repaired",
    "threatened",
    "suspected_damage",
    "damaged",
    "destroyed",
    "under_repair",
    "unknown",
)
# Shown on the map: the problems (operational, repaired and unknown aren't).
PROBLEMS = ("threatened", "suspected_damage", "damaged", "destroyed", "under_repair")
# How it's known.
EVIDENCE = ("seen", "reported", "imagery")
# Extra fields by kind of feature (the frontend asks for those that apply): a
# store's or depot's stock and what's short, a hospital's capacity, the fuel left.
FIELDS: dict[str, tuple[str, ...] | None] = {
    "stock": ("full", "half", "low", "empty", "unknown"),
    "short": None,  # free text
    "capacity": ("normal", "saturated", "closed"),
    "fuel": ("yes", "no", "rationed"),
}


def clean_details(raw: Any) -> dict[str, str]:
    """The extra fields given, checked; empty ones left out."""
    if raw is None:
        return {}
    if not isinstance(raw, dict):
        raise HTTPException(400, "details must be an object")
    details = {}
    for key, value in raw.items():
        if key not in FIELDS:
            raise HTTPException(400, f"Unknown field: {key}")
        value = str(value or "").strip()
        if not value:
            continue
        allowed = FIELDS[key]
        if allowed is not None and value not in allowed:
            raise HTTPException(400, f"{key} must be one of: {', '.join(allowed)}")
        details[key] = value[:500]
    return details


def feature_of(layer: str, raw_id: Any) -> tuple[str, str, int]:
    """(table, id column, id) of a tile layer's feature."""
    if layer not in SOURCE_TABLES:
        raise HTTPException(404, "Features of that layer can't have a status")
    try:
        feature_id = int(raw_id)
    except (TypeError, ValueError):
        raise HTTPException(400, "Invalid id")
    table, id_column = SOURCE_TABLES[layer]
    return table, id_column, feature_id


def change_json(r: Any) -> dict:
    return {
        "status": r.status,
        "previous": r.previous,
        "evidence": r.evidence,
        "note": r.note,
        "author": r.author,
        "details": r.details or {},
        "at": r.made_at.isoformat(),
    }


async def statuses(request: Request) -> Response:
    """GET: the features with a problem, as GeoJSON (their geometry, and "badge": a
    point on them for the status sign). POST: set a feature's status."""
    db = get_db(request)
    await ensure_schema(db)
    if request.method == "POST":
        return await set_status(request)
    rows = await db.execute(
        text(
            """SELECT source, feature_id, layer, status, evidence, note, name, author, updated_at, details,
                      ST_AsGeoJSON(geometry, 7) AS geometry,
                      ST_AsGeoJSON(ST_PointOnSurface(geometry), 7) AS badge
                 FROM userdata.feature_status
                WHERE status = ANY(:problems) AND geometry IS NOT NULL"""
        ),
        {"problems": list(PROBLEMS)},
    )
    features = []
    for r in rows:
        features.append(
            {
                "type": "Feature",
                "geometry": json.loads(r.geometry),
                "properties": {
                    "layer": r.layer,
                    "id": r.feature_id,
                    "status": r.status,
                    "evidence": r.evidence,
                    "note": r.note,
                    "name": r.name,
                    "author": r.author,
                    "details": r.details or {},
                    "updated_at": r.updated_at.isoformat(),
                    "badge": json.loads(r.badge)["coordinates"],
                },
            }
        )
    return JSONResponse({"type": "FeatureCollection", "features": features})


async def feature_status(request: Request) -> Response:
    """One feature's status (null if it never had one) and its history, newest first."""
    db = get_db(request)
    await ensure_schema(db)
    table, _, feature_id = feature_of(request.query_params.get("layer", ""), request.query_params.get("id"))
    current = (
        await db.execute(
            text(
                """SELECT status, evidence, note, author, updated_at, details FROM userdata.feature_status
                    WHERE source = :source AND feature_id = :id"""
            ),
            {"source": table, "id": feature_id},
        )
    ).first()
    history = await db.execute(
        text(
            """SELECT status, previous, evidence, note, author, made_at, details FROM userdata.status_change
                WHERE source = :source AND feature_id = :id ORDER BY id DESC"""
        ),
        {"source": table, "id": feature_id},
    )
    return JSONResponse(
        {
            "status": current.status if current else None,
            "evidence": current.evidence if current else None,
            "note": current.note if current else None,
            "author": current.author if current else None,
            "updated_at": current.updated_at.isoformat() if current else None,
            "details": (current.details or {}) if current else {},
            "history": [change_json(r) for r in history],
            "can_set": can_set_statuses(current_user(request)),
        }
    )


async def set_status(request: Request) -> Response:
    db = get_db(request)
    if not can_set_statuses(current_user(request)):
        raise HTTPException(403, "You can't set statuses")
    body = await read_json(request)
    layer = str(body.get("layer") or "")
    table, id_column, feature_id = feature_of(layer, body.get("id"))
    status = body.get("status")
    if status not in STATUSES:
        raise HTTPException(400, f"The status must be one of: {', '.join(STATUSES)}")
    evidence = body.get("evidence") or None
    if evidence is not None and evidence not in EVIDENCE:
        raise HTTPException(400, f"How it's known must be one of: {', '.join(EVIDENCE)}")
    note = str(body.get("note") or "").strip() or None
    details = clean_details(body.get("details"))
    name = str(body.get("name") or "").strip() or None
    author = current_user(request).name or str(body.get("author") or "").strip() or None

    the_geometry = f"(SELECT ST_Transform(geometry, 4326) FROM {table} WHERE {id_column} = :id LIMIT 1)"
    exists = (await db.execute(text(f"SELECT {the_geometry} IS NOT NULL"), {"id": feature_id})).scalar()
    if not exists:
        raise HTTPException(404, "That feature isn't on the map (any more)")
    previous = (
        await db.execute(
            text("SELECT status FROM userdata.feature_status WHERE source = :source AND feature_id = :id"),
            {"source": table, "id": feature_id},
        )
    ).scalar()
    params = {
        "source": table,
        "id": feature_id,
        "layer": layer,
        "status": status,
        "previous": previous,
        "evidence": evidence,
        "note": note,
        "name": name,
        "author": author,
        "details": json.dumps(details),
    }
    await db.execute(
        text(
            f"""INSERT INTO userdata.feature_status
                      (source, feature_id, layer, status, evidence, note, name, author, details, geometry)
               VALUES (:source, :id, :layer, :status, :evidence, :note, :name, :author,
                       CAST(:details AS jsonb), {the_geometry})
               ON CONFLICT (source, feature_id) DO UPDATE
                  SET layer = EXCLUDED.layer, status = EXCLUDED.status, evidence = EXCLUDED.evidence,
                      note = EXCLUDED.note, name = coalesce(EXCLUDED.name, feature_status.name),
                      author = EXCLUDED.author, details = EXCLUDED.details, geometry = EXCLUDED.geometry,
                      updated_at = now()"""
        ),
        params,
    )
    await db.execute(
        text(
            """INSERT INTO userdata.status_change
                      (source, feature_id, status, previous, evidence, note, author, details)
               VALUES (:source, :id, :status, :previous, :evidence, :note, :author,
                       CAST(:details AS jsonb))"""
        ),
        params,
    )
    await db.commit()
    return JSONResponse({"status": status, "previous": previous})
