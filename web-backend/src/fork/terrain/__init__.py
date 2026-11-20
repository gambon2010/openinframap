"""Fork: the terrain (docs/plans/terrain.md): the elevation tiles of every area
downloaded, served together at /terrain/{z}/{x}/{y}.webp (Terrarium encoded,
512-pixel, lossless WebP: the map's hill shading and 3D relief)."""

from __future__ import annotations

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import files

MEDIA_TYPE = "image/webp"


async def terrain_tile(request: Request) -> Response:
    try:
        z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
    except ValueError:
        return Response(status_code=404)
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        return Response(status_code=404)
    # As the background map's: kept by the browser, asked again each time.
    etag = f'"{await run_in_threadpool(files.TERRAIN_FILES.version)}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    data = await run_in_threadpool(files.TERRAIN_FILES.tile, z, x, y)
    if not data:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    return Response(data, media_type=MEDIA_TYPE, headers=headers)


routes = [Route("/terrain/{z}/{x}/{y}.webp", terrain_tile)]
