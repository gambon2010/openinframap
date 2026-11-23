"""Fork: images people put on the map (userdata.image)."""

import base64
import uuid

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from .changes import parse_uuid
from .layers import read_json
from .schema import ensure_schema

MAX_IMAGE_BYTES = 2_000_000


async def add_image(request: Request) -> Response:
    """An image for the map: {"name", "mime", "data": base64}. Returns its id."""
    db = get_db(request)
    await ensure_schema(db)
    body = await read_json(request)
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
