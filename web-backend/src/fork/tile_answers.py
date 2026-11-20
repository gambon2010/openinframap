"""Fork: how the backend answers a tile request from the offline maps (the
background map, the trams' lanes, the terrain, the satellite imagery): the same
rules for all of them."""

from __future__ import annotations

from collections.abc import Callable

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response

GZIP_MAGIC = b"\x1f\x8b"
MAX_ZOOM = 22  # past any file's: a request beyond it is a mistake


def tile_coordinates(request: Request) -> tuple[int, int, int] | None:
    """The request's tile (z, x, y), None if it isn't one."""
    try:
        z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
    except ValueError:
        return None
    if not (0 <= z <= MAX_ZOOM and 0 <= x < 2**z and 0 <= y < 2**z):
        return None
    return z, x, y


async def tile_response(
    request: Request,
    version: Callable[[], str],
    find: Callable[[int, int, int], bytes | None],
    media_type: str,
) -> Response:
    """A tile, kept by the browser but asked again each time: while the files are the
    same (`version`, their ETag), "not modified" with no tile read; a file rebuilt,
    the new tile (an hour's cache showed old tiles beside new ones after a rebuild).
    Nothing there: 204, never kept (the area may be downloaded a minute later). A
    tile stored gzipped (Protomaps' vector tiles) is sent as it is, saying so."""
    tile = tile_coordinates(request)
    if tile is None:
        return Response(status_code=404)
    etag = f'"{await run_in_threadpool(version)}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    data = await run_in_threadpool(find, *tile)
    if not data:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    if data[:2] == GZIP_MAGIC:
        headers["Content-Encoding"] = "gzip"
    return Response(data, media_type=media_type, headers=headers)
