"""
Fork: logging in, and the accounts (docs/plans/sync.md, "Login for the whole app").

    GET  /login                  the login page (the setup page when there's no user yet)
    GET  /auth/check             204 with a valid session, else 401 (the gate asks)
    GET  /auth/me                {name, is_admin, can_set_statuses}, or 401 ({setup: true}
                                 when there's no user yet)
    POST /auth/login             {name, password}: sets the session cookie
    POST /auth/logout
    POST /auth/setup             {name, password}: the first account (an admin), only
                                 when there's none
    GET  /auth/users             admins: every account
    POST /auth/users             admins: {name, password, is_admin?, can_set_statuses?}
    PATCH /auth/users/{id}       admins: {password?, is_admin?, can_set_statuses?, disabled?}
"""

from __future__ import annotations

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from starlette.exceptions import HTTPException
from starlette.responses import HTMLResponse, JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from ..userdata.layers import read_json
from ..userdata.schema import ensure_schema
from ..userdata.users import current_user
from . import sessions
from .passwords import MIN_LENGTH, check_password, hash_password

LOGIN_PAGE = (Path(__file__).parent / "login.html").read_text()


async def has_users(request: Request) -> bool:
    db = get_db(request)
    await ensure_schema(db)
    return bool((await db.execute(text("SELECT EXISTS (SELECT 1 FROM userdata.app_user)"))).scalar())


def logged_in(request: Request) -> bool:
    return request.scope.get("user") is not None


def with_cookie(response: Response, request: Request, token: str) -> Response:
    response.set_cookie(
        sessions.COOKIE,
        token,
        max_age=int(sessions.LIFETIME.total_seconds()),
        httponly=True,
        samesite="lax",
        secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https",
        path="/",
    )
    return response


def check_new_password(password: str) -> None:
    if len(password) < MIN_LENGTH:
        raise HTTPException(400, f"The password needs {MIN_LENGTH} characters at least")


async def login_page(request: Request) -> Response:
    return HTMLResponse(LOGIN_PAGE, headers={"Cache-Control": "no-store"})


async def check(request: Request) -> Response:
    return Response(status_code=204 if logged_in(request) else 401)


async def me(request: Request) -> Response:
    if not logged_in(request):
        return JSONResponse({"setup": not await has_users(request)}, status_code=401)
    user = current_user(request)
    return JSONResponse(
        {"name": user.name, "is_admin": user.is_admin, "can_set_statuses": user.can_set_statuses}
    )


async def login(request: Request) -> Response:
    body = await read_json(request)
    name = str(body.get("name") or "").strip()
    password = str(body.get("password") or "")
    db = get_db(request)
    await ensure_schema(db)
    row = (
        await db.execute(
            text(
                """SELECT id, password_hash FROM userdata.app_user
                    WHERE lower(name) = lower(:name) AND NOT disabled"""
            ),
            {"name": name},
        )
    ).first()
    if row is None or not check_password(password, row.password_hash):
        raise HTTPException(401, "Wrong name or password")
    return with_cookie(JSONResponse({"ok": True}), request, await sessions.start(db, row.id))


async def logout(request: Request) -> Response:
    from .middleware import cookie

    await sessions.end(get_db(request), cookie(request.scope, sessions.COOKIE))
    response = JSONResponse({"ok": True})
    response.delete_cookie(sessions.COOKIE, path="/")
    return response


async def setup(request: Request) -> Response:
    """The first account, an admin; refused once there's one. The existing layers
    stay as they are (owners come with sharing, docs/plans/sync.md)."""
    if await has_users(request):
        raise HTTPException(403, "There are accounts already: ask an admin")
    body = await read_json(request)
    name = str(body.get("name") or "").strip()
    password = str(body.get("password") or "")
    if not name:
        raise HTTPException(400, "A name is needed")
    check_new_password(password)
    db = get_db(request)
    user_id = (
        await db.execute(
            text(
                """INSERT INTO userdata.app_user (name, password_hash, is_admin, can_set_statuses)
                   VALUES (:name, :hash, true, true) RETURNING id"""
            ),
            {"name": name, "hash": hash_password(password)},
        )
    ).scalar_one()
    await db.commit()
    return with_cookie(JSONResponse({"ok": True}), request, await sessions.start(db, user_id))


def admin_only(request: Request) -> None:
    if not current_user(request).is_admin:
        raise HTTPException(403, "Only admins manage the accounts")


async def users(request: Request) -> Response:
    admin_only(request)
    db = get_db(request)
    if request.method == "POST":
        body = await read_json(request)
        name = str(body.get("name") or "").strip()
        password = str(body.get("password") or "")
        if not name:
            raise HTTPException(400, "A name is needed")
        check_new_password(password)
        try:
            await db.execute(
                text(
                    """INSERT INTO userdata.app_user (name, password_hash, is_admin, can_set_statuses)
                       VALUES (:name, :hash, :admin, :statuses)"""
                ),
                {
                    "name": name,
                    "hash": hash_password(password),
                    "admin": bool(body.get("is_admin")),
                    "statuses": bool(body.get("can_set_statuses")),
                },
            )
        except IntegrityError:
            raise HTTPException(400, f"There's an account called {name} already")
        await db.commit()
    rows = await db.execute(
        text(
            """SELECT id, name, is_admin, can_set_statuses, disabled, created_at
                 FROM userdata.app_user ORDER BY lower(name)"""
        )
    )
    return JSONResponse(
        {
            "users": [
                {
                    "id": r.id,
                    "name": r.name,
                    "is_admin": r.is_admin,
                    "can_set_statuses": r.can_set_statuses,
                    "disabled": r.disabled,
                    "created_at": r.created_at.isoformat(),
                }
                for r in rows
            ]
        }
    )


async def update_user(request: Request) -> Response:
    admin_only(request)
    db = get_db(request)
    try:
        user_id = int(request.path_params["user_id"])
    except ValueError:
        raise HTTPException(400, "Invalid user")
    body = await read_json(request)
    changes: dict[str, object] = {}
    for key in ("is_admin", "can_set_statuses", "disabled"):
        if key in body:
            changes[key] = bool(body[key])
    if body.get("password"):
        check_new_password(str(body["password"]))
        changes["password_hash"] = hash_password(str(body["password"]))
    if str(user_id) == current_user(request).id and (
        changes.get("is_admin") is False or changes.get("disabled") is True
    ):
        raise HTTPException(400, "You can't take away your own admin right or disable yourself")
    if not changes:
        raise HTTPException(400, "Nothing to change")
    sets = ", ".join(f"{key} = :{key}" for key in changes)
    result = await db.execute(
        text(f"UPDATE userdata.app_user SET {sets} WHERE id = :id"), {**changes, "id": user_id}
    )
    if result.rowcount == 0:  # type: ignore[attr-defined]
        raise HTTPException(404, "No such account")
    if changes.get("disabled") or "password_hash" in changes:
        # Logged out everywhere.
        await db.execute(text("DELETE FROM userdata.user_session WHERE user_id = :id"), {"id": user_id})
    await db.commit()
    return JSONResponse({"ok": True})


routes = [
    Route("/login", endpoint=login_page),
    Route("/auth/check", endpoint=check),
    Route("/auth/me", endpoint=me),
    Route("/auth/login", endpoint=login, methods=["POST"]),
    Route("/auth/logout", endpoint=logout, methods=["POST"]),
    Route("/auth/setup", endpoint=setup, methods=["POST"]),
    Route("/auth/users", endpoint=users, methods=["GET", "POST"]),
    Route("/auth/users/{user_id}", endpoint=update_user, methods=["PATCH"]),
]
