"""Fork: the satellite imagery the map shows, from the files downloaded into
data/offline-maps/<area>.sat-*.pmtiles (scripts/offline-maps.py): their list, at
/imagery (the one the scripts write beside them, imagery.json: each file, its
tiles' format, zooms, bounds and credit; the map reads it when it opens), and
their tiles, at /satellite/<file>/{z}/{x}/{y}.<format>."""

from __future__ import annotations

import json

from pmtiles.tile import TileType
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .background import OFFLINE_MAPS_DIR
from .pmtiles_files import ArchiveFolder
from .tile_answers import tile_response

IMAGERY_LIST = OFFLINE_MAPS_DIR / "imagery.json"  # scripts/offline_maps/inventory.py IMAGERY_LIST
IMAGERY_FILES = ArchiveFolder(OFFLINE_MAPS_DIR, lambda p: ".sat-" in p.name and p.suffix == ".pmtiles")
MEDIA_TYPES = {
    TileType.JPEG.value: "image/jpeg",
    TileType.PNG.value: "image/png",
    TileType.WEBP.value: "image/webp",
    TileType.AVIF.value: "image/avif",
}


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


async def imagery_tile(request: Request) -> Response:
    """A tile of one imagery file, by its name (only a file of the folder: a name
    that isn't one of them finds nothing)."""
    IMAGERY_FILES.archives()
    archive = IMAGERY_FILES.get(OFFLINE_MAPS_DIR / f"{request.path_params['file']}.pmtiles")
    if archive is None:
        return Response(status_code=404)
    tile_type = archive.header["tile_type"]
    media_type = MEDIA_TYPES.get(getattr(tile_type, "value", tile_type), "application/octet-stream")
    return await tile_response(request, IMAGERY_FILES.version, archive.get, media_type)


routes = [
    Route("/imagery", imagery),
    Route("/satellite/{file}/{z}/{x}/{y}.{format}", imagery_tile),
]
