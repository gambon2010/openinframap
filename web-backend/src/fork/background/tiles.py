"""Fork: tile geometry for the zoomed out build (zoomed_out.py): where a tile is in
web Mercator metres, how its ground stretches, and the tiles' grid."""

from __future__ import annotations

import math

import shapely

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
