"""
Fork: live updates (docs/plans/sync.md, "How the app hears about changes"): each
open page keeps a connection here (Server-Sent Events) and is told when something
it can see was saved, so it fetches it (the browser merges it with its unsaved
changes). Every POLL seconds:

- "changes": new saved changes on layers the user can see (the change log's ids);
- "access": what the user can see changed (a layer shared with them, or not any more);
- "status": a map feature's status changed.

The event id is the last change seen: a page that reconnects (the browser does it by
itself, with Last-Event-ID) is told what it missed. The stream holds no database
connection (main.py's middleware skips it, STREAMING): it takes one for each check.

    GET /userdata/events
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine
from starlette.responses import Response, StreamingResponse

from ... import Request
from . import access
from .schema import ensure_schema
from .users import User, current_user

POLL = 2.0
# A comment now and then keeps the connection open through proxies.
KEEPALIVE = 25.0
# Paths main.py's database middleware leaves alone (they'd hold a connection).
STREAMING = ("/userdata/events",)


def event(kind: str, data: dict, event_id: int | None = None) -> str:
    head = f"id: {event_id}\n" if event_id is not None else ""
    return f"{head}event: {kind}\ndata: {json.dumps(data)}\n\n"


def summary(changes: list[dict]) -> dict:
    """What a page needs to hear: how many changes, on which layers, by whom."""
    return {
        "count": len(changes),
        "layers": sorted({c["layer_id"] for c in changes}),
        "authors": sorted({c["author"] for c in changes if c["author"]}),
    }


async def look(engine: AsyncEngine, user: User, since: int) -> tuple[int, list[dict], str, int]:
    """What's new since change `since`: the last change id, the new changes the user
    can see, what they can see (as a fingerprint), the last status change id."""
    async with engine.connect() as db:
        await ensure_schema(db)
        last = (await db.execute(text("SELECT coalesce(max(id), 0) FROM userdata.change"))).scalar() or 0
        changes: list[dict] = []
        levels = await access.levels(db, user, deleted=True)
        if last > since:
            rows = await db.execute(
                text(
                    """SELECT c.id, c.op, c.layer_id, c.feature_id, s.author
                         FROM userdata.change c JOIN userdata.save s ON s.id = c.save_id
                        WHERE c.id > :since ORDER BY c.id LIMIT 500"""
                ),
                {"since": since},
            )
            changes = [
                {
                    "id": r.id,
                    "op": r.op,
                    "layer_id": str(r.layer_id),
                    "feature_id": str(r.feature_id) if r.feature_id else None,
                    "author": r.author,
                }
                for r in rows
                if access.at_least(levels.get(str(r.layer_id), "none"), "view")
            ]
        seen = ",".join(sorted(f"{k}={v}" for k, v in levels.items() if access.at_least(v, "view")))
        status = (
            await db.execute(text("SELECT coalesce(max(id), 0) FROM userdata.status_change"))
        ).scalar() or 0
    return last, changes, seen, status


async def stream(engine: AsyncEngine, user: User, since: int | None) -> AsyncIterator[str]:
    last, _, seen, status = await look(engine, user, 0)
    # A reconnection: what was missed since the last event it had.
    if since is not None and since < last:
        last, changes, seen, status = await look(engine, user, since)
        if changes:
            yield event("changes", summary(changes), last)
    yield event("ready", {"last": last}, last)
    quiet = 0.0
    while True:
        await asyncio.sleep(POLL)
        new_last, changes, new_seen, new_status = await look(engine, user, last)
        sent = False
        if changes:
            yield event("changes", summary(changes), new_last)
            sent = True
        if new_seen != seen:
            yield event("access", {}, new_last)
            sent = True
        if new_status != status:
            yield event("status", {"last": new_status}, new_last)
            sent = True
        last, seen, status = new_last, new_seen, new_status
        quiet = 0.0 if sent else quiet + POLL
        if quiet >= KEEPALIVE:
            yield ": still here\n\n"
            quiet = 0.0


async def events(request: Request) -> Response:
    engine: AsyncEngine = request.scope["state"]["db_engine"]
    try:
        since: int | None = int(request.headers.get("last-event-id", ""))
    except ValueError:
        since = None
    return StreamingResponse(
        stream(engine, current_user(request), since),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
