"""Fork: building numbers (building_numbers/__init__.py): a commune's buildings, read
from the background map's zoom 15 tiles (the ones the map draws its buildings from:
the same buildings, the same ids), each as one point inside it. A building cut by
tile edges is joined by its id first (background/buildings.py's pieces)."""

from __future__ import annotations

from shapely import unary_union
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

from ..background.buildings import area_only, full_tile, tile_of, to_degrees


def buildings_in(commune: BaseGeometry) -> dict[int, tuple[float, float]]:
    """Every building whose point is inside the commune (degrees): id to (lon, lat)."""
    pieces: dict[int, list[BaseGeometry]] = {}
    for tx, ty in tiles_over(commune.bounds):
        for feature in full_tile(tx, ty):
            geom = area_only(shape(feature["geometry"]))
            if not geom.is_empty:
                pieces.setdefault(int(feature["id"]), []).append(to_degrees(geom, tx, ty))
    inside = prep(commune)
    found: dict[int, tuple[float, float]] = {}
    for building, parts in pieces.items():
        # A point inside the building, not its centre (an L-shaped one's centre is outside).
        point = unary_union(parts).representative_point()
        if inside.contains(point):
            found[building] = (point.x, point.y)
    return found


def tiles_over(bounds: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """The zoom 15 tiles covering a box (west, south, east, north, degrees)."""
    west, south, east, north = bounds
    x0, y0 = tile_of(west, north)
    x1, y1 = tile_of(east, south)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
