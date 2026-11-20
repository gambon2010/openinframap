"""Fork: the terrain's elevations as height grids (numpy), read from the terrain files
(files.py): Mapterhorn's tiles are 512 x 512 lossless WebP, each pixel's height
Terrarium encoded (red * 256 + green + blue / 256 - 32768 metres), to zoom 13.

The one place the backend reads elevations (contours.py; the radio mode planned)."""

from __future__ import annotations

import io
import math
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from PIL import Image

from . import files

TILE_PIXELS = 512
FINEST_ZOOM = 13  # scripts/offline_maps/terrain.py MAX_ZOOM
EARTH_CIRCUMFERENCE = 40_075_016.686  # metres, at the equator (web Mercator)
# Decoded tiles kept (1 MB each).
CACHED_TILES = 96


def decode(webp: bytes) -> np.ndarray:
    """A Terrarium tile's heights in metres (float32, rows from the north)."""
    rgb = np.asarray(Image.open(io.BytesIO(webp)).convert("RGB"), dtype=np.float32)
    return rgb[:, :, 0] * 256 + rgb[:, :, 1] + rgb[:, :, 2] / 256 - 32768


@lru_cache(maxsize=CACHED_TILES)
def tile_heights(z: int, x: int, y: int, version: str) -> np.ndarray | None:
    """A terrain tile's heights, None where no file has it (`version`: the files'
    version, so a rebuilt file is read again)."""
    data = files.TERRAIN_FILES.tile(z, x, y)
    return decode(data) if data else None


@dataclass(frozen=True)
class Window:
    """Heights around a map tile: the grid, and where the tile sits in it (its
    top-left corner and width, in grid pixels)."""

    heights: np.ndarray
    left: float
    top: float
    width: float


def window(z: int, x: int, y: int, margin: int) -> Window | None:
    """The heights under a map tile and `margin` pixels around it (from its
    neighbours; NaN where none), at the terrain's own resolution: past zoom 13, a
    part of the zoom 13 tile it's in. None where there's no terrain under it."""
    source_zoom = min(z, FINEST_ZOOM)
    parts = 2 ** (z - source_zoom)  # the map tile's share of a terrain tile, across
    tx, ty = x // parts, y // parts
    version = files.TERRAIN_FILES.version()
    mosaic = np.full((3 * TILE_PIXELS, 3 * TILE_PIXELS), np.nan, dtype=np.float32)
    found = False
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            heights = neighbour(source_zoom, tx + dx, ty + dy, version)
            if heights is None:
                continue
            found = found or (dx, dy) == (0, 0)
            row, col = (dy + 1) * TILE_PIXELS, (dx + 1) * TILE_PIXELS
            mosaic[row : row + TILE_PIXELS, col : col + TILE_PIXELS] = heights
    if not found:
        return None
    width = TILE_PIXELS / parts
    left = TILE_PIXELS + (x % parts) * width
    top = TILE_PIXELS + (y % parts) * width
    first_col, first_row = int(left) - margin, int(top) - margin
    last_col, last_row = int(np.ceil(left + width)) + margin, int(np.ceil(top + width)) + margin
    cut = mosaic[first_row:last_row, first_col:last_col]
    return Window(cut, left - first_col, top - first_row, width)


def neighbour(z: int, x: int, y: int, version: str) -> np.ndarray | None:
    """A terrain tile beside another (wrapping round the world east and west), None
    past the poles or where there's none."""
    if not 0 <= y < 2**z:
        return None
    return tile_heights(z, x % 2**z, y, version)


def tile_position(lon: float, lat: float, z: int) -> tuple[float, float]:
    """Where a point is in the terrain's pixels at a zoom, across the whole world
    (web Mercator: column and row, fractional)."""
    pixels = TILE_PIXELS * 2**z
    column = (lon + 180) / 360 * pixels
    sin = math.sin(math.radians(max(-85.0511, min(85.0511, lat))))
    row = (0.5 - math.log((1 + sin) / (1 - sin)) / (4 * math.pi)) * pixels
    return column, row


def pixel_height(column: int, row: int, version: str) -> float:
    """One terrain pixel's height at zoom 13, by its column and row across the whole
    world; NaN where there's no terrain."""
    tile = neighbour(FINEST_ZOOM, column // TILE_PIXELS, row // TILE_PIXELS, version)
    return math.nan if tile is None else float(tile[row % TILE_PIXELS, column % TILE_PIXELS])


def elevation(lon: float, lat: float) -> float | None:
    """The ground's height at a point, metres (from zoom 13's pixels, interpolated
    between the four around it), None where there's no terrain."""
    column, row = tile_position(lon, lat, FINEST_ZOOM)
    # Pixel values are at pixel centres: half a pixel in from their edges.
    gx, gy = column - 0.5, row - 0.5
    c, r = math.floor(gx), math.floor(gy)
    version = files.TERRAIN_FILES.version()
    corners = np.array([[pixel_height(c + dx, r + dy, version) for dx in (0, 1)] for dy in (0, 1)])
    return bilinear(corners, gx - c, gy - r)


def bilinear(corners: np.ndarray, fx: float, fy: float) -> float | None:
    """The value a fraction (fx across, fy down) between four corners (2 x 2), None
    if any is unknown."""
    if np.isnan(corners).any():
        return None
    top = corners[0, 0] * (1 - fx) + corners[0, 1] * fx
    bottom = corners[1, 0] * (1 - fx) + corners[1, 1] * fx
    return float(top * (1 - fy) + bottom * fy)


def ground_metres_per_pixel(lat: float, z: int) -> float:
    """A terrain pixel's width on the ground at a latitude (web Mercator)."""
    return EARTH_CIRCUMFERENCE * math.cos(math.radians(lat)) / (TILE_PIXELS * 2**z)


def slope(lon: float, lat: float) -> float | None:
    """The ground's slope at a point, degrees (0 flat, 90 a wall): Horn's method on
    the 3 x 3 pixels around it, as GDAL's gdaldem slope computes it; None where
    there's no terrain."""
    column, row = tile_position(lon, lat, FINEST_ZOOM)
    c, r = int(column), int(row)
    version = files.TERRAIN_FILES.version()
    cells = np.array([[pixel_height(c + dx, r + dy, version) for dx in (-1, 0, 1)] for dy in (-1, 0, 1)])
    if np.isnan(cells).any():
        return None
    return horn_slope(cells, ground_metres_per_pixel(lat, FINEST_ZOOM))


def horn_slope(cells: np.ndarray, pixel_metres: float) -> float:
    """Horn's slope (degrees) of the middle of 3 x 3 heights (rows from the north)."""
    (a, b, c), (d, _, f), (g, h, i) = cells
    east = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * pixel_metres)
    north = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * pixel_metres)
    return float(math.degrees(math.atan(math.hypot(east, north))))
