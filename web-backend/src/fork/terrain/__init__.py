"""Fork: the terrain (docs/plans/terrain.md): the elevation tiles of every area
downloaded, served together at /terrain/{z}/{x}/{y}.webp (Terrarium encoded,
512-pixel, lossless WebP: the map's hill shading and 3D relief), and contour lines
made from them at /terrain/contours/{z}/{x}/{y}.mvt (contours.py)."""

from __future__ import annotations

from collections.abc import Callable

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import contours, files

MEDIA_TYPE = "image/webp"
VECTOR_TILE = "application/vnd.mapbox-vector-tile"


def tile_handler(make: Callable[[int, int, int], bytes | None], media_type: str):
    """A route answering a tile from the terrain files: kept by the browser but asked
    again each time, as the background map's ("not modified" while the files are
    the same); 204 where there's nothing, never kept (an area may come later)."""

    async def answer(request: Request) -> Response:
        try:
            z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
        except ValueError:
            return Response(status_code=404)
        if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
            return Response(status_code=404)
        etag = f'"{await run_in_threadpool(files.TERRAIN_FILES.version)}"'
        headers = {"Cache-Control": "no-cache", "ETag": etag}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        data = await run_in_threadpool(make, z, x, y)
        if not data:
            return Response(status_code=204, headers={"Cache-Control": "no-store"})
        return Response(data, media_type=media_type, headers=headers)

    return answer


def elevation_tile(z: int, x: int, y: int) -> bytes | None:
    return files.TERRAIN_FILES.tile(z, x, y)


routes = [
    Route("/terrain/contours/{z}/{x}/{y}.mvt", tile_handler(contours.tile, VECTOR_TILE)),
    Route("/terrain/{z}/{x}/{y}.webp", tile_handler(elevation_tile, MEDIA_TYPE)),
]
