"""Fork: a building's exact outline, from the background maps' zoom 15 tiles (the
only ones holding every building whole: lower zooms keep a few landmarks, and
Tegola's large buildings are simplified for their zoom).

    /background/building/{id}?lon=&lat=     its whole outline (GeoJSON, in degrees):
        its pieces in the zoom 15 tiles around the point, joined. What My layers'
        copy takes, at any zoom.

A building crossing a tile edge is cut there, each piece a little over the edge:
pieces are cut back to their tile and joined by the building's id, so no seam
shows. (Making the zoomed-out tiles this way too was tried: decoding 64 tiles for
one zoom 12 tile over Paris took 13 s, so those stay a build step.)
"""

from __future__ import annotations

import gzip
import math

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from shapely import unary_union
from shapely.geometry import box, mapping, shape
from shapely.geometry.base import BaseGeometry
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from . import ARCHIVES

FULL_ZOOM = 15
EXTENT = 4096


def full_tile(x: int, y: int) -> list[dict]:
    """The buildings of one zoom 15 tile, in its own coordinates (0 to EXTENT, y
    down): [] if no background map has it."""
    found = ARCHIVES.tile(FULL_ZOOM, x, y)
    if not found:
        return []
    data = found[0]
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    layers = mapbox_vector_tile.decode(data, default_options={"y_coord_down": True})
    return [
        f
        for f in layers.get("buildings", {}).get("features", [])
        if f.get("properties", {}).get("kind") == "building" and f.get("id") is not None
    ]


def outline(building_id: int, lon: float, lat: float, most: int = 25) -> dict | None:
    """A building's whole outline in degrees: its piece in the zoom 15 tile at the
    point, and in each neighbour its piece reaches the edge of (at most `most`
    tiles). None if it isn't there."""
    n = 2**FULL_ZOOM
    start = (int((lon + 180) / 360 * n), int((1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n))
    todo: list[tuple[int, int]] = [start]
    seen: set[tuple[int, int]] = set()
    parts: list[BaseGeometry] = []
    while todo and len(seen) < most:
        tx, ty = todo.pop()
        if (tx, ty) in seen:
            continue
        seen.add((tx, ty))
        for f in full_tile(tx, ty):
            if int(f["id"]) != building_id:
                continue
            geom = area_only(shape(f["geometry"]))
            if geom.is_empty:
                continue
            parts.append(to_degrees(geom, tx, ty))
            minx, miny, maxx, maxy = geom.bounds
            for dx, dy, touches in (
                (-1, 0, minx <= 0),
                (1, 0, maxx >= EXTENT),
                (0, -1, miny <= 0),
                (0, 1, maxy >= EXTENT),
            ):
                if touches:
                    todo.append((tx + dx, ty + dy))
    if not parts:
        return None
    return mapping(unary_union(parts))


def area_only(geom: BaseGeometry) -> BaseGeometry:
    """A piece cut back to its tile, its areas only: cutting a shape can leave a
    line or a point along the edge as well."""
    geom = (geom if geom.is_valid else geom.buffer(0)).intersection(box(0, 0, EXTENT, EXTENT))
    if geom.geom_type in ("Polygon", "MultiPolygon"):
        return geom
    areas = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(areas) if areas else box(0, 0, 0, 0)


def to_degrees(geom: BaseGeometry, tx: int, ty: int) -> BaseGeometry:
    """A zoom 15 tile's coordinates (0 to EXTENT, y down) as degrees."""
    n = 2**FULL_ZOOM

    def degrees(points: np.ndarray) -> np.ndarray:
        lon = (tx + points[:, 0] / EXTENT) / n * 360 - 180
        lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (ty + points[:, 1] / EXTENT) / n))))
        return np.column_stack([lon, lat])

    return shapely.transform(geom, degrees)


async def building_outline(request: Request) -> Response:
    try:
        building_id = int(request.path_params["id"])
        lon, lat = float(request.query_params["lon"]), float(request.query_params["lat"])
    except (KeyError, ValueError):
        return JSONResponse({"error": "id, lon and lat"}, status_code=400)
    found = await run_in_threadpool(outline, building_id, lon, lat)
    if not found:
        return JSONResponse({"error": "No such building there"}, status_code=404)
    return JSONResponse({"type": "Feature", "id": building_id, "geometry": found, "properties": {}})


routes = [
    Route("/background/building/{id}", building_outline),
]
