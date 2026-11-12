"""
Fork: who may see and change which layer (docs/plans/sync.md, "Owners and
sharing"). One place for the rules; layers.py, changes.py and situations.py ask here.

- the owner: everything (share it, lock it, delete it);
- shared to modify: change its items, its name and colour;
- shared to view: see it (read-only);
- ANYONE (no login middleware: tests, scripts): owner of everything.
"""

from __future__ import annotations

import uuid
from typing import Literal

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException

from .users import User

Level = Literal["none", "view", "modify", "owner"]
ORDER: dict[str, int] = {"none": 0, "view": 1, "modify": 2, "owner": 3}


def level_of(user: User, owner_id: int | None, shared: str | None) -> Level:
    """A user's access to a layer, from its owner and what was shared with them."""
    if user.id is None:
        return "owner"
    if owner_id is not None and str(owner_id) == user.id:
        return "owner"
    if shared in ("view", "modify"):
        return shared  # type: ignore[return-value]
    return "none"


def at_least(level: str, needed: Level) -> bool:
    return ORDER[level] >= ORDER[needed]


async def levels(database: AsyncConnection, user: User, deleted: bool = False) -> dict[str, Level]:
    """Every layer's access for a user (by id), deleted ones too if asked."""
    rows = await database.execute(
        text(
            f"""SELECT l.id, l.owner_id, a.level
                  FROM userdata.layer AS l
                  LEFT JOIN userdata.layer_access AS a ON a.layer_id = l.id AND a.user_id = :user
                 {"" if deleted else "WHERE NOT l.deleted"}"""
        ),
        {"user": int(user.id) if user.id is not None else None},
    )
    return {str(r.id): level_of(user, r.owner_id, r.level) for r in rows}


async def require(database: AsyncConnection, user: User, layer_id: uuid.UUID, needed: Level) -> None:
    """Refuse (403) unless the user has that access to the layer; a layer that
    doesn't exist yet passes (it's being made, and will be theirs)."""
    row = (
        await database.execute(
            text(
                """SELECT l.owner_id, a.level FROM userdata.layer AS l
                     LEFT JOIN userdata.layer_access AS a ON a.layer_id = l.id AND a.user_id = :user
                    WHERE l.id = :layer"""
            ),
            {"layer": layer_id, "user": int(user.id) if user.id is not None else None},
        )
    ).first()
    if row is None:
        return
    level = level_of(user, row.owner_id, row.level)
    if not at_least(level, needed):
        what = {"view": "see", "modify": "change", "owner": "do that to"}[needed]
        raise HTTPException(403, f"You can't {what} that layer")
