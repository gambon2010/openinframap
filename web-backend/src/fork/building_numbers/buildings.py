"""Fork: building numbers (building_numbers/__init__.py): an area's buildings, read
from the background map's zoom 15 tiles (the ones the map draws its buildings from:
the same buildings, the same ids), each as one point inside it. A building cut by
tile edges is joined by its id first (background/buildings.py's pieces). Slivers are
set apart: shapes no one could stand in (narrower than MIN_WIDTH_M, or smaller than
MIN_AREA_M2), such as a staircase's steps drawn one by one beside a cathedral."""

from __future__ import annotations

import math
from dataclasses import dataclass

import shapely
from shapely import unary_union
from shapely.geometry import Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

from ..background.buildings import area_only, full_tile, tile_of, to_degrees

MIN_WIDTH_M = 1.5
MIN_AREA_M2 = 2.0
METRES_PER_DEGREE = 111_320.0


@dataclass
class AreaBuildings:
    """An area's buildings (id to a point inside, lon and lat), the slivers apart."""

    buildings: dict[int, tuple[float, float]]
    slivers: dict[int, tuple[float, float]]


def buildings_in(area: BaseGeometry) -> AreaBuildings:
    """Every building whose point is inside the area (degrees)."""
    inside = prep(area)
    found = AreaBuildings({}, {})
    for building, outline in outlines_over(area.bounds).items():
        # A point inside the building, not its centre (an L-shaped one's centre is outside).
        point = outline.representative_point()
        if not inside.contains(point):
            continue
        kept = found.slivers if is_sliver(outline) else found.buildings
        kept[building] = (point.x, point.y)
    return found


def outlines_over(bounds: tuple[float, float, float, float]) -> dict[int, BaseGeometry]:
    """Each building of the zoom 15 tiles over a box, its pieces joined (degrees)."""
    pieces: dict[int, list[BaseGeometry]] = {}
    for tx, ty in tiles_over(bounds):
        for feature in full_tile(tx, ty):
            geom = area_only(shape(feature["geometry"]))
            if not geom.is_empty:
                pieces.setdefault(int(feature["id"]), []).append(to_degrees(geom, tx, ty))
    return {building: unary_union(parts) for building, parts in pieces.items()}


def is_sliver(outline: BaseGeometry) -> bool:
    """Whether no one could stand in it: narrower than MIN_WIDTH_M (its smallest
    enclosing rectangle's short side) or smaller than MIN_AREA_M2."""
    metres = in_metres(outline)
    if metres.area < MIN_AREA_M2:
        return True
    rectangle = shapely.oriented_envelope(metres)
    if not isinstance(rectangle, Polygon):
        return True
    corners = list(rectangle.exterior.coords)
    sides = [math.dist(corners[i], corners[i + 1]) for i in range(2)]
    return min(sides) < MIN_WIDTH_M


def in_metres(outline: BaseGeometry) -> BaseGeometry:
    """An outline in degrees, in metres around its own latitude (small: flat enough)."""
    lat = outline.centroid.y
    across = METRES_PER_DEGREE * math.cos(math.radians(lat))
    return shapely.transform(outline, lambda points: points * [across, METRES_PER_DEGREE])


def tiles_over(bounds: tuple[float, float, float, float]) -> list[tuple[int, int]]:
    """The zoom 15 tiles covering a box (west, south, east, north, degrees)."""
    west, south, east, north = bounds
    x0, y0 = tile_of(west, north)
    x1, y1 = tile_of(east, south)
    return [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
