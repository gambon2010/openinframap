"""Fork: the satellite imagery the map shows: the list the scripts write beside the
files (data/offline-maps/imagery.json, scripts/offline_maps/inventory.py
imagery_list: each file, its tiles' format, zooms, bounds and credit), at /imagery.
The map reads it when it opens, so imagery downloaded while the app runs shows on
the next page load (the tiles themselves: the `satellite` service)."""

from __future__ import annotations

import json

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .background import OFFLINE_MAPS_DIR

IMAGERY_LIST = OFFLINE_MAPS_DIR / "imagery.json"  # scripts/offline_maps/inventory.py IMAGERY_LIST


def imagery_list() -> list:
    """The list as written; empty if there's none yet or it can't be read (no
    imagery shown: the map still works)."""
    try:
        found = json.loads(IMAGERY_LIST.read_text())
    except (OSError, ValueError):
        return []
    return found if isinstance(found, list) else []


async def imagery(request: Request) -> Response:
    found = await run_in_threadpool(imagery_list)
    return JSONResponse(found, headers={"Cache-Control": "no-cache"})


routes = [Route("/imagery", imagery)]
