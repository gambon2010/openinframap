"""
Fork: personal settings (docs/plans/sync.md, phase 5): a JSON value per account and
key, e.g. My layers' "userlayers" (each layer's folder, the layers hidden, open or
folded in the list, empty folders). Only for logged-in accounts.

    GET /userdata/settings/{key}    the value (null: none yet)
    PUT /userdata/settings/{key}    the new value
"""

from __future__ import annotations

import json
import re

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from .schema import ensure_schema
from .users import current_user

KEY = re.compile(r"^[a-z][a-z0-9_-]{0,40}$")
MAX_SIZE = 200_000


async def setting(request: Request) -> Response:
    db = get_db(request)
    await ensure_schema(db)
    key = request.path_params["key"]
    if not KEY.match(key):
        raise HTTPException(400, "Invalid setting")
    user = current_user(request)
    if user.id is None:
        raise HTTPException(403, "Personal settings need an account")
    if request.method == "PUT":
        body = await request.body()
        if len(body) > MAX_SIZE:
            raise HTTPException(413, "Too large")
        try:
            value = json.loads(body)
        except ValueError:
            raise HTTPException(400, "Expected JSON")
        await db.execute(
            text(
                """INSERT INTO userdata.user_setting (user_id, key, value)
                   VALUES (:user, :key, CAST(:value AS jsonb))
                   ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()"""
            ),
            {"user": int(user.id), "key": key, "value": json.dumps(value)},
        )
        await db.commit()
        return JSONResponse({"ok": True})
    value = (
        await db.execute(
            text("SELECT value FROM userdata.user_setting WHERE user_id = :user AND key = :key"),
            {"user": int(user.id), "key": key},
        )
    ).scalar()
    return JSONResponse({"value": value})
