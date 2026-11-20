"""Fork: the terrain (docs/plans/terrain.md): the elevation tiles of every area
downloaded, served together at /terrain/{z}/{x}/{y}.webp (Terrarium encoded,
512-pixel, lossless WebP: the map's hill shading and 3D relief), and contour lines
made from them at /terrain/contours/{z}/{x}/{y}.mvt (contours.py); the height at a
point and the ground's slope there at /terrain/elevation?lon=&lat= (the coordinates
box); the line of sight between two points at /terrain/sight (sight.py)."""

from __future__ import annotations

from collections.abc import Callable

from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import contours, elevations, files, sight

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


async def elevation_at(request: Request) -> Response:
    """{"elevation": metres, "slope": degrees; null where there's no terrain}."""
    try:
        lon, lat = float(request.query_params["lon"]), float(request.query_params["lat"])
    except (KeyError, ValueError):
        return Response(status_code=400)
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        return Response(status_code=400)
    height = await run_in_threadpool(elevations.elevation, lon, lat)
    steepness = await run_in_threadpool(elevations.slope, lon, lat)
    return JSONResponse(
        {
            "elevation": None if height is None else round(height, 1),
            "slope": None if steepness is None else round(steepness, 1),
        }
    )


def point_of(text: str) -> tuple[float, float]:
    """ "lon,lat" as a point; ValueError if it isn't one."""
    lon, lat = (float(v) for v in text.split(","))
    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
        raise ValueError(text)
    return lon, lat


async def sight_between(request: Request) -> Response:
    """?from=lon,lat&to=lon,lat[&observer=2&target=0]: the line of sight
    (sight.py): {"target_seen", "blocked_at" (metres), "profile": [[distance, ground,
    seen]...]}."""
    try:
        start, end = point_of(request.query_params["from"]), point_of(request.query_params["to"])
        observer = float(request.query_params.get("observer", 2))
        target = float(request.query_params.get("target", 0))
    except (KeyError, ValueError):
        return Response(status_code=400)
    found = await run_in_threadpool(sight.line_of_sight, start, end, observer, target)
    return JSONResponse(
        {
            "target_seen": found.target_seen,
            "blocked_at": None if found.blocked_at is None else round(found.blocked_at),
            "profile": [
                [round(s.distance, 1), None if s.ground is None else round(s.ground, 1), s.seen]
                for s in found.samples
            ],
        }
    )


routes = [
    Route("/terrain/elevation", elevation_at),
    Route("/terrain/sight", sight_between),
    Route("/terrain/contours/{z}/{x}/{y}.mvt", tile_handler(contours.tile, VECTOR_TILE)),
    Route("/terrain/{z}/{x}/{y}.webp", tile_handler(elevation_tile, MEDIA_TYPE)),
]
