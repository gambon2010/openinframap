"""
Fork: every call needs a logged-in user (docs/plans/sync.md, "Login for the whole
app"), apart from logging in. Puts the user on the request (userdata/users.py
current_user); without one, 401. The gate (gate/nginx.conf) checks the same session
for the tiles and the frontend.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from http.cookies import SimpleCookie
from typing import Any

from asgiref.typing import ASGI3Application, ASGIReceiveCallable, ASGISendCallable, Scope
from sqlalchemy.ext.asyncio import AsyncConnection

from ..userdata.schema import ensure_schema
from .sessions import COOKIE, user_of

# Open without a session: the login page and what it calls.
OPEN = ("/login", "/auth/login", "/auth/setup", "/auth/me", "/auth/check", "/auth/logout")


def cookie(scope: Mapping[str, Any], name: str) -> str | None:
    """A cookie of the request (an ASGI scope)."""
    for key, value in scope.get("headers", []):
        if key == b"cookie":
            jar: SimpleCookie = SimpleCookie()
            jar.load(value.decode("latin-1"))
            if name in jar:
                return jar[name].value
    return None


class LoginMiddleware:
    def __init__(self, app: ASGI3Application) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: ASGIReceiveCallable, send: ASGISendCallable) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        database: AsyncConnection | None = scope.get("db_connection")  # type: ignore[assignment]
        user = None
        if database is not None:
            await ensure_schema(database)
            user = await user_of(database, cookie(scope, COOKIE))
        scope["user"] = user  # type: ignore[typeddict-unknown-key]
        path = scope["path"]
        if user is None and not any(path == p or path.startswith(p + "/") for p in OPEN):
            body = json.dumps({"error": "Log in first"}).encode()
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                    "trailers": False,
                }
            )
            await send({"type": "http.response.body", "body": body, "more_body": False})
            return
        await self.app(scope, receive, send)
