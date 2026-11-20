"""Fork: /background/transit/{z}/{x}/{y}.mvt, the trams' and metros' lanes (each
line in its lane, LOOM's: loom_tiles.py), from data/offline-maps/<area>.transit.pmtiles,
the first file that has the tile. A source of its own: its tiles go to zoom 18
(the lanes' offsets are written per zoom), the background map's stop at 15.
Revalidated like the background map's tiles (an ETag from the files)."""

from __future__ import annotations


from pmtiles.tile import Compression
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from ..pmtiles_files import ArchiveFolder
from . import MEDIA_TYPE, OFFLINE_MAPS_DIR

# <area>.transit.pmtiles (loom_tiles.py).
TRANSIT = ".transit.pmtiles"


TRANSIT_FILES = ArchiveFolder(OFFLINE_MAPS_DIR, lambda p: p.name.endswith(TRANSIT))


async def transit_tile(request: Request) -> Response:
    try:
        z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
    except ValueError:
        return Response(status_code=404)
    etag = f'"{await run_in_threadpool(TRANSIT_FILES.version)}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    found = await run_in_threadpool(TRANSIT_FILES.first_tile, z, x, y)
    if not found:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    data, archive = found
    if archive.header["tile_compression"] == Compression.GZIP:
        headers["Content-Encoding"] = "gzip"
    return Response(data, media_type=MEDIA_TYPE, headers=headers)


routes = [Route("/background/transit/{z}/{x}/{y}.mvt", transit_tile)]
