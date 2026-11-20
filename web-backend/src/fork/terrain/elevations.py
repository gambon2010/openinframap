"""Fork: the terrain's elevations as height grids (numpy), read from the terrain files
(files.py): Mapterhorn's tiles are 512 x 512 lossless WebP, each pixel's height
Terrarium encoded (red * 256 + green + blue / 256 - 32768 metres), to zoom 13.

The one place the backend reads elevations (contours.py; the radio mode planned)."""

from __future__ import annotations

import io
from dataclasses import dataclass
from functools import lru_cache

import numpy as np
from PIL import Image

from . import files

TILE_PIXELS = 512
FINEST_ZOOM = 13  # scripts/offline_maps/terrain.py MAX_ZOOM
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
