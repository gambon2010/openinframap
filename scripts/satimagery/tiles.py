"""Fork: satellite imagery. Web-mercator tile maths and region outlines: which tiles cover an outline (in blocks, over several outlines)."""

from __future__ import annotations

import json
import math
import sys
from collections.abc import Iterator
from pathlib import Path

# --- Tile maths ---------------------------------------------------------------


def tile_of(lon: float, lat: float, zoom: int) -> tuple[int, int]:
    """The web-mercator tile (x, y) containing a point."""
    n = 2**zoom
    lat = max(min(lat, 85.0511), -85.0511)
    x = int((lon + 180.0) / 360.0 * n)
    y = int((1.0 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2.0 * n)
    return min(max(x, 0), n - 1), min(max(y, 0), n - 1)


def tile_bounds(x: int, y: int, zoom: int) -> tuple[float, float, float, float]:
    """(west, south, east, north) of a tile, in degrees."""
    n = 2**zoom

    def lat(row: int) -> float:
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * row / n))))

    return x / n * 360.0 - 180.0, lat(y + 1), (x + 1) / n * 360.0 - 180.0, lat(y)


def tiles_in_bbox(
    bbox: tuple[float, float, float, float], zoom: int
) -> Iterator[tuple[int, int]]:
    west, south, east, north = bbox
    x0, y0 = tile_of(west, north, zoom)
    x1, y1 = tile_of(east, south, zoom)
    for x in range(x0, x1 + 1):
        for y in range(y0, y1 + 1):
            yield x, y


# --- Outlines -----------------------------------------------------------------

Ring = list[tuple[float, float]]


def outline_rings(geojson: dict) -> list[Ring]:
    """The outer rings of every polygon in a GeoJSON (holes ignored)."""
    rings: list[Ring] = []

    def add(geometry: dict) -> None:
        kind = geometry.get("type")
        if kind == "Polygon":
            rings.append([(c[0], c[1]) for c in geometry["coordinates"][0]])
        elif kind == "MultiPolygon":
            for polygon in geometry["coordinates"]:
                rings.append([(c[0], c[1]) for c in polygon[0]])
        elif kind == "GeometryCollection":
            for g in geometry["geometries"]:
                add(g)

    if geojson.get("type") == "FeatureCollection":
        for feature in geojson["features"]:
            add(feature["geometry"])
    elif geojson.get("type") == "Feature":
        add(geojson["geometry"])
    else:
        add(geojson)
    return rings


def rings_bbox(rings: list[Ring]) -> tuple[float, float, float, float]:
    lons = [p[0] for r in rings for p in r]
    lats = [p[1] for r in rings for p in r]
    return min(lons), min(lats), max(lons), max(lats)


def point_in_rings(lon: float, lat: float, rings: list[Ring]) -> bool:
    """Ray casting over every ring (holes ignored)."""
    for ring in rings:
        inside = False
        j = len(ring) - 1
        for i in range(len(ring)):
            xi, yi = ring[i]
            xj, yj = ring[j]
            if (yi > lat) != (yj > lat) and lon < (xj - xi) * (lat - yi) / (
                yj - yi
            ) + xi:
                inside = not inside
            j = i
        if inside:
            return True
    return False


def box_touches_rings(
    box: tuple[float, float, float, float], rings: list[Ring]
) -> bool:
    """Whether a box overlaps the outline: a corner or the centre inside it, or a
    vertex of the outline inside the box (enough for tiles and 1° cells)."""
    west, south, east, north = box
    points = [
        (west, south),
        (west, north),
        (east, south),
        (east, north),
        ((west + east) / 2, (south + north) / 2),
    ]
    if any(point_in_rings(x, y, rings) for x, y in points):
        return True
    return any(west <= x <= east and south <= y <= north for r in rings for x, y in r)


Segment = tuple[float, float, float, float]


def segment_touches_box(seg: Segment, box: tuple[float, float, float, float]) -> bool:
    """Whether a segment of the outline crosses or lies in a box (Liang-Barsky)."""
    x1, y1, x2, y2 = seg
    west, south, east, north = box
    if (
        max(x1, x2) < west
        or min(x1, x2) > east
        or max(y1, y2) < south
        or min(y1, y2) > north
    ):
        return False
    dx, dy = x2 - x1, y2 - y1
    t0, t1 = 0.0, 1.0
    for p, q in (
        (-dx, x1 - west),
        (dx, east - x1),
        (-dy, y1 - south),
        (dy, north - y1),
    ):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


Block = tuple[int, int, int]  # x, y, size: tiles x..x+size-1, y..y+size-1


def tile_blocks(outlines: list[list[Ring]], zoom: int) -> list[Block]:
    """The tiles of a zoom level inside every outline (e.g. a region and the country
    a source covers), as square blocks. A quadtree from zoom 0: only tiles an
    outline crosses are split (with the segments that cross them); a tile wholly
    inside every outline is one block, however many tiles it holds. France at zoom
    17 (17.8 million tiles) takes seconds and little memory."""
    segments: list[list[Segment]] = [
        [(*a, *b) for ring in rings for a, b in zip(ring, ring[1:] + ring[:1])]
        for rings in outlines
    ]
    out: list[Block] = []

    def visit(x: int, y: int, z: int, segs: list[list[Segment]]) -> None:
        box = tile_bounds(x, y, z)
        west, south, east, north = box
        crossing = []
        for rings, outline_segs in zip(outlines, segs):
            here = [seg for seg in outline_segs if segment_touches_box(seg, box)]
            # Not crossed: wholly inside or wholly outside, the centre says which.
            if not here and not point_in_rings(
                (west + east) / 2, (south + north) / 2, rings
            ):
                return
            crossing.append(here)
        if not any(crossing):
            n = 2 ** (zoom - z)
            out.append((x * n, y * n, n))
            return
        if z == zoom:
            out.append((x, y, 1))
            return
        for cx in (2 * x, 2 * x + 1):
            for cy in (2 * y, 2 * y + 1):
                visit(cx, cy, z + 1, crossing)

    visit(0, 0, 0, segments)
    return out


def block_count(blocks: list[Block]) -> int:
    return sum(n * n for _, _, n in blocks)


def block_tiles(blocks: list[Block], zoom: int) -> Iterator[tuple[int, int, int]]:
    for x0, y0, n in blocks:
        for x in range(x0, x0 + n):
            for y in range(y0, y0 + n):
                yield zoom, x, y


def tiles_in_outline(rings: list[Ring], zoom: int) -> list[tuple[int, int]]:
    """The tiles of a zoom level that overlap the outline."""
    return sorted((x, y) for _, x, y in block_tiles(tile_blocks([rings], zoom), zoom))


def box_ring(bbox: tuple[float, float, float, float]) -> list[Ring]:
    west, south, east, north = bbox
    return [[(west, south), (east, south), (east, north), (west, north)]]


def area_km2(rings: list[Ring]) -> float:
    """Approximate area of the outline (shoelace on an equirectangular projection)."""
    total = 0.0
    for ring in rings:
        lat0 = sum(p[1] for p in ring) / len(ring)
        kx = 111.32 * math.cos(math.radians(lat0))
        s = 0.0
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            s += (x1 * kx) * (y2 * 110.57) - (x2 * kx) * (y1 * 110.57)
        total += abs(s) / 2
    return total


def load_rings(path: str) -> list[Ring]:
    rings = outline_rings(json.loads(Path(path).read_text()))
    if not rings:
        sys.exit(f"No polygon in {path}")
    return rings
