"""Fork: the background map's own roads beyond an area's zoom 15 tiles, for the
companion's tiles at the area's edge (zoomed_out.py).

The companion's roads come from the area's zoom 15 tiles only, and they replace
the background map's in a tile (background/__init__.py). A zoomed out tile reaching
past the area (across a border) would lose its roads there: in such a tile, the
background map's own roads at that zoom are kept beyond the area.
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import shapely

from ..pmtiles_files import Archive
from ..background import mvt, unzipped
from . import zoomed_roads as roads
from .tiles import EXTENT, tile_bounds, tile_size


def covered(present: Iterable[tuple[int, int]], z: int) -> shapely.Geometry:
    """Where an area's tiles of a zoom are (their x, y): one shape."""
    boxes = [shapely.box(*tile_bounds(z, x, y)) for x, y in present]
    return shapely.union_all(boxes) if boxes else shapely.Polygon()


def beyond(archive: Archive, z: int, x: int, y: int, area: shapely.Geometry) -> tuple[list, list]:
    """A tile's roads beyond the area, from the background map's tile at that zoom
    (in metres, with the properties the companion keeps); none if the area covers
    the tile."""
    box = shapely.box(*tile_bounds(z, x, y))
    if shapely.contains(area, box):
        return [], []
    outside = shapely.difference(box, area)
    data = archive.get(z, x, y)
    if shapely.is_empty(outside) or not data:
        return [], []
    lines, props = [], []
    for geometry, properties in map_roads(data, z, x, y):
        for line in shapely.get_parts(shapely.intersection(geometry, outside)):
            # Not a point or an empty line where a road only touches the area's edge.
            if shapely.get_type_id(line) == 1 and not shapely.is_empty(line):
                lines.append(line)
                props.append(properties)
    return lines, props


def map_roads(data: bytes, z: int, x: int, y: int) -> Iterable[tuple[shapely.Geometry, dict[str, Any]]]:
    """The roads shown at a zoom in the background map's tile there, in metres."""
    only_roads = mvt.keep(unzipped(data), {roads.LAYER})
    tile = mapbox_vector_tile.decode(only_roads, default_options={"y_coord_down": True})
    west, _, east, north = tile_bounds(z, x, y)
    scale = (east - west) / EXTENT
    for feature in tile.get(roads.LAYER, {}).get("features", []):
        props = feature.get("properties", {})
        if roads.from_zoom(props) > z:
            continue
        in_units = shapely.geometry.shape(feature["geometry"])
        in_metres = shapely.transform(in_units, lambda xy: xy * [scale, -scale] + [west, north])
        yield in_metres, {k: props[k] for k in roads.KEPT if k in props}


def beyond_in(
    archive: Archive, z: int, tiles: Iterable[tuple[int, int]], area: shapely.Geometry
) -> tuple[list, list]:
    """The roads beyond the area in some tiles of a zoom."""
    lines: list = []
    props: list = []
    for x, y in tiles:
        found_lines, found_props = beyond(archive, z, x, y, area)
        lines += found_lines
        props += found_props
    return lines, props


def edge_tiles(z: int, area: shapely.Geometry) -> list[tuple[int, int]]:
    """The tiles of a zoom the area's edge goes through."""
    if shapely.is_empty(area):
        return []
    size = tile_size(z)
    half = size * 2**z / 2
    west, south, east, north = shapely.bounds(area)
    edge = shapely.boundary(area)
    shapely.prepare(edge)
    found = []
    for x in range(int((west + half) // size), int((east + half) // size) + 1):
        for y in range(int((half - north) // size), int((half - south) // size) + 1):
            if shapely.intersects(edge, shapely.box(*tile_bounds(z, x, y))):
                found.append((x, y))
    return found
