"""
Fork: who is logged in. A session is a random token in an HttpOnly cookie, stored
hashed in userdata.user_session with its expiry (renewed while it's used).
"""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from ..userdata.users import User

COOKIE = "oim_session"
LIFETIME = timedelta(days=30)
# Renewed when less than this is left.
RENEW_BEFORE = timedelta(days=29)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def user_from_row(row) -> User:  # type: ignore[no-untyped-def]
    return User(id=str(row.id), name=row.name, is_admin=row.is_admin)


async def user_of(database: AsyncConnection, token: str | None) -> User | None:
    """The user a session token belongs to, if it's valid (renewing it)."""
    if not token:
        return None
    hashed = token_hash(token)
    row = (
        await database.execute(
            text(
                """SELECT u.id, u.name, u.is_admin, s.expires_at
                     FROM userdata.user_session AS s JOIN userdata.app_user AS u ON u.id = s.user_id
                    WHERE s.token_hash = :hash AND s.expires_at > now() AND NOT u.disabled"""
            ),
            {"hash": hashed},
        )
    ).first()
    if row is None:
        return None
    if row.expires_at - datetime.now(timezone.utc) < RENEW_BEFORE:
        await database.execute(
            text("UPDATE userdata.user_session SET expires_at = :until WHERE token_hash = :hash"),
            {"until": datetime.now(timezone.utc) + LIFETIME, "hash": hashed},
        )
        await database.commit()
    return user_from_row(row)


async def start(database: AsyncConnection, user_id: int) -> str:
    """A new session for a user: its token (for the cookie)."""
    token = secrets.token_urlsafe(32)
    await database.execute(text("DELETE FROM userdata.user_session WHERE expires_at < now()"))
    await database.execute(
        text(
            """INSERT INTO userdata.user_session (token_hash, user_id, expires_at)
               VALUES (:hash, :user, :until)"""
        ),
        {"hash": token_hash(token), "user": user_id, "until": datetime.now(timezone.utc) + LIFETIME},
    )
    await database.commit()
    return token


async def end(database: AsyncConnection, token: str | None) -> None:
    if token:
        await database.execute(
            text("DELETE FROM userdata.user_session WHERE token_hash = :hash"), {"hash": token_hash(token)}
        )
        await database.commit()
