"""Fork: tile geometry for the zoomed out build (zoomed_out.py): where a tile is in
web Mercator metres, how its ground stretches, and the tiles' grid."""

from __future__ import annotations

import gzip
import math

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


def line_tiles(layer: str, lines: np.ndarray, props: list, z: int, tiles=None) -> list[tuple[int, bytes]]:
    """A zoom's tiles (tile id, gzip) of one layer of lines, each with its properties;
    `tiles` the (x, y) to make, by default every one a line reaches."""
    if not len(lines):
        return []
    tree = shapely.STRtree(lines)
    out = []
    for x, y in tiles if tiles is not None else reached(lines, z):
        data = encode_lines(layer, lines, props, tree, z, x, y)
        if data:
            out.append((zxy_to_tileid(z, x, y), data))
    return out


def reached(lines: np.ndarray, z: int) -> list[tuple[int, int]]:
    """The tiles of a zoom that any of the lines reaches."""
    size = tile_size(z)
    half = size * 2**z / 2
    found = set()
    for west, south, east, north in shapely.bounds(lines):
        for x in range(int((west + half) // size), int((east + half) // size) + 1):
            for y in range(int((half - north) // size), int((half - south) // size) + 1):
                found.add((x, y))
    return sorted(found)


def encode_lines(
    layer: str, lines: np.ndarray, props: list, tree: shapely.STRtree, z: int, x: int, y: int
) -> bytes | None:
    """One tile: the lines cut to it and its buffer, encoded and zipped."""
    bounds = tile_bounds(z, x, y)
    margin = BUFFER / EXTENT * (bounds[2] - bounds[0])
    rect = (bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
    found = tree.query(shapely.box(*rect))
    if not len(found):
        return None
    cut = shapely.clip_by_rect(lines[found], *rect)
    in_units = in_tile_units(cut, bounds)
    features = [
        {"geometry": line, "properties": props[i]}
        for i, line in zip(found, in_units)
        if not line.is_empty and shapely.get_type_id(line) in (1, 5)
    ]
    if not features:
        return None
    data = mapbox_vector_tile.encode(
        [{"name": layer, "features": features}], default_options={"extents": EXTENT}
    )
    return zipped(data)


def zipped(tile: bytes) -> bytes:
    """A tile gzipped as stored in the companion (the same bytes every build)."""
    return gzip.compress(tile, compresslevel=6, mtime=0)
