"""Fork: tile geometry for the zoomed out build (zoomed_out.py): where a tile is in
web Mercator metres, how its ground stretches, and the tiles' grid."""

from __future__ import annotations

import gzip
import math
from dataclasses import dataclass, field
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from pmtiles.tile import zxy_to_tileid

EXTENT = 4096  # a tile's units across
BUFFER = 64  # tile units drawn past each edge, as Protomaps' tiles
PIXELS = 512  # a tile is drawn this many pixels wide
HALF = 20037508.342789244  # web Mercator's half width, metres


def tile_bounds(z: int, x: int, y: int) -> tuple[float, float, float, float]:
    """A tile's square in web Mercator metres (west, south, east, north)."""
    size = 2 * HALF / 2**z
    west, north = -HALF + x * size, HALF - y * size
    return west, north - size, west + size, north


def ground_stretch(z: int, y: int) -> float:
    """Ground metres per web Mercator metre in a tile's row (squared for areas)."""
    lat = math.atan(math.sinh(math.pi * (1 - 2 * (y + 0.5) / 2**z)))
    return math.cos(lat)


def map_units(metres: float, y: float) -> float:
    """Ground metres in web Mercator metres at a north-south position (y, metres)."""
    lat = math.atan(math.sinh(y / HALF * math.pi))
    return metres / math.cos(lat)


def children(z: int, x: int, y: int, at: int) -> list[tuple[int, int]]:
    """The tiles of zoom `at` inside a tile of zoom `z`."""
    n = 1 << (at - z)
    return [(cx, cy) for cx in range(x * n, (x + 1) * n) for cy in range(y * n, (y + 1) * n)]


def in_tile_units(geometries, bounds: tuple[float, float, float, float]):
    """Geometries in metres moved into a tile's units (y up, as the vector tile
    encoder takes them), all in one go: the encoder's own conversion (its
    quantize_bounds) goes point by point, a third of the time making tiles."""
    west, south, east, _ = bounds
    scale = EXTENT / (east - west)
    return shapely.transform(geometries, lambda xy: (xy - [west, south]) * scale)


def tile_size(z: int) -> float:
    """A tile's width at a zoom, in metres."""
    west, _, east, _ = tile_bounds(z, 0, 0)
    return east - west


@dataclass
class TileLayer:
    """A layer to cut into tiles: its name, its shapes (lines or areas, in metres)
    and each one's properties, and feature id (buildings: to join their pieces)."""

    name: str
    shapes: np.ndarray
    props: list[dict[str, Any]]
    ids: list[int] | None = None
    tree: shapely.STRtree = field(init=False)

    def __post_init__(self) -> None:
        self.tree = shapely.STRtree(self.shapes)


def layer_tiles(layer: TileLayer, z: int, tiles=None) -> list[tuple[int, bytes]]:
    """A zoom's tiles (tile id, gzip) of a layer; `tiles` the (x, y) to make, by
    default every one a shape reaches. Tiles with nothing are left out."""
    if not len(layer.shapes):
        return []
    out = []
    for x, y in tiles if tiles is not None else reached(layer.shapes, z):
        data = encode_tile(layer, z, x, y)
        if data:
            out.append((zxy_to_tileid(z, x, y), data))
    return out


def reached(shapes: np.ndarray, z: int) -> list[tuple[int, int]]:
    """The tiles of a zoom that any of the shapes reaches."""
    size = tile_size(z)
    half = size * 2**z / 2
    found = set()
    for west, south, east, north in shapely.bounds(shapes):
        for x in range(int((west + half) // size), int((east + half) // size) + 1):
            for y in range(int((half - north) // size), int((half - south) // size) + 1):
                found.add((x, y))
    return sorted(found)


# What a tile holds: lines and areas.
DRAWN_TYPES = (
    shapely.GeometryType.LINESTRING,
    shapely.GeometryType.MULTILINESTRING,
    shapely.GeometryType.POLYGON,
    shapely.GeometryType.MULTIPOLYGON,
)


def cut_to(shapes: np.ndarray, rect: tuple[float, float, float, float]) -> np.ndarray:
    """The shapes cut to a rectangle. clip_by_rect is quick but fails on some
    polygons (a ring left with three points); then the exact intersection."""
    try:
        return shapely.clip_by_rect(shapes, *rect)
    except shapely.errors.GEOSException:
        return shapely.intersection(shapes, shapely.box(*rect))


def drawable(shape: shapely.Geometry) -> shapely.Geometry | None:
    """What a cut shape leaves for a tile: its lines or areas, without the points
    and lines an exact cut can add along the edge; None if nothing."""
    if shapely.is_empty(shape):
        return None
    if shapely.get_type_id(shape) in DRAWN_TYPES:
        return shape
    parts = shapely.get_parts(shape)
    dimensions = shapely.get_dimensions(parts)
    widest = dimensions.max()
    if widest == 0:
        return None
    return shapely.union_all(parts[dimensions == widest])


def encode_tile(layer: TileLayer, z: int, x: int, y: int) -> bytes | None:
    """One tile: the layer's shapes cut to it and its buffer, encoded and zipped."""
    bounds = tile_bounds(z, x, y)
    margin = BUFFER / EXTENT * (bounds[2] - bounds[0])
    rect = (bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
    found = layer.tree.query(shapely.box(*rect))
    if not len(found):
        return None
    in_units = in_tile_units(cut_to(layer.shapes[found], rect), bounds)
    features = []
    for i, cut in zip(found, in_units):
        shape = drawable(cut)
        if shape is None:
            continue
        feature = {"geometry": shape, "properties": layer.props[i]}
        if layer.ids is not None:
            feature["id"] = layer.ids[i]
        features.append(feature)
    if not features:
        return None
    data = mapbox_vector_tile.encode(
        [{"name": layer.name, "features": features}], default_options={"extents": EXTENT}
    )
    return zipped(data)


def zipped(tile: bytes) -> bytes:
    """A tile gzipped as stored in the companion (the same bytes every build)."""
    return gzip.compress(tile, compresslevel=6, mtime=0)
