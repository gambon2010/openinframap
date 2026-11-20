"""Fork: contour lines as vector tiles, made from the terrain's elevations as tiles are
asked for (docs/plans/terrain.md, step 4), drawn as on US military maps (FM 3-25.26,
Map Reading and Land Navigation, ch. 10): every fifth line an index contour (heavier,
its height written on it), the four between intermediate ones; the interval (the
height between two lines) as on the maps' scales: 100 m at zooms 9-10 (1:250,000), 50 m
at 11, 20 m at 12-13 (1:50,000), 10 m from 14 (1:25,000).

A tile's lines are traced (marching squares, contourpy) on its heights and a margin
of its neighbours', so they run on across tile edges, then cut to the tile and its
buffer. Past zoom 13 they come from zoom 13's heights (the terrain's finest).

Like a paper map's, they're generalised: the heights are smoothed first (the LiDAR
sees every ditch and embankment: on flat ground the lines came out ragged and
broken), and scraps too short to read are dropped."""

from __future__ import annotations

import math
from functools import lru_cache
from typing import cast

import contourpy
import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely

from . import elevations, files

EXTENT = 4096  # a tile's units across
BUFFER = 64  # tile units drawn past each edge, as the background map's tiles
LAYER = "contours"
FIRST_ZOOM = 9
LAST_ZOOM = 16
# Every fifth line is an index contour.
INDEX_EVERY = 5
# How much the heights are smoothed: a Gaussian's spread, in terrain pixels (6.6 m
# at zoom 13).
SMOOTHING = 3
# Heights read past the tile's edges, in terrain pixels: enough for its buffer and
# the smoothing's reach.
MARGIN = 12
# Lines shorter than this are dropped (tile units: 8 pixels of a 512-pixel tile).
SHORTEST = 64
# Points closer than this to a straight line between their neighbours are dropped
# (tile units: half a pixel of a 512-pixel tile): tiles a quarter of the size.
SIMPLIFY = 4
# Encoded tiles kept.
CACHED_TILES = 2048


def interval(z: int) -> int:
    """Metres between two lines at a zoom (the military maps' scales)."""
    if z <= 10:
        return 100
    if z == 11:
        return 50
    if z <= 13:
        return 20
    return 10


def levels(heights: np.ndarray, step: int) -> list[int]:
    """The heights of the lines a grid crosses: every `step` metres above sea level
    (the coast is drawn as the shore, not as a contour)."""
    low, high = np.nanmin(heights), np.nanmax(heights)
    first = max(step, math.ceil(low / step) * step)
    return list(range(first, int(math.floor(high)) + 1, step))


def tile_lines(window: elevations.Window, z: int) -> list[tuple[int, shapely.LineString]]:
    """(height, line in tile units, y down) of each contour across a tile."""
    if np.isnan(window.heights).all():
        return []
    heights = np.ma.masked_invalid(smoothed(window.heights, SMOOTHING))
    step = interval(z)
    tracer = contourpy.contour_generator(z=heights, line_type=contourpy.LineType.Separate)
    scale = EXTENT / window.width
    shift = np.array([window.left, window.top])
    clip = (-BUFFER, -BUFFER, EXTENT + BUFFER, EXTENT + BUFFER)
    found: list[tuple[int, shapely.LineString]] = []
    for level in levels(heights.compressed(), step):
        for points in traced(tracer, level):
            # Grid indices are pixel centres: half a pixel in from their edges.
            in_tile = (points + 0.5 - shift) * scale
            line = shapely.LineString(in_tile).simplify(SIMPLIFY)
            if line.length < SHORTEST:
                continue
            cut = shapely.clip_by_rect(line, *clip)
            found.extend((level, part) for part in pieces(cut))
    return found


def smoothed(heights: np.ndarray, spread: float) -> np.ndarray:
    """Heights blurred by a Gaussian (across rows, then columns); where there are
    none (NaN) they stay none, and don't pull their neighbours down."""
    reach = math.ceil(3 * spread)
    offsets = np.arange(-reach, reach + 1)
    kernel = np.exp(-(offsets**2) / (2 * spread**2))
    known = ~np.isnan(heights)
    values = np.where(known, heights, 0.0)
    weights = known.astype(np.float64)
    for axis in (0, 1):
        values = np.apply_along_axis(blurred, axis, values, kernel)
        weights = np.apply_along_axis(blurred, axis, weights, kernel)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(known, values / weights, np.nan)


def blurred(row: np.ndarray, kernel: np.ndarray) -> np.ndarray:
    """A row convolved with an odd-length kernel, as long as it was (whichever is
    longer: np.convolve's "same" gives the longer of the two)."""
    reach = len(kernel) // 2
    return np.convolve(row, kernel, mode="full")[reach : reach + len(row)]


def traced(tracer: contourpy.ContourGenerator, level: int) -> list[np.ndarray]:
    """A level's lines, each an (n, 2) array of grid columns and rows (a tracer made
    with LineType.Separate gives that shape; contourpy's type covers every shape)."""
    return cast(list[np.ndarray], tracer.lines(level))


def pieces(geometry) -> list[shapely.LineString]:
    """The lines left of a clipped line (none, one, or several)."""
    if geometry.is_empty:
        return []
    if isinstance(geometry, shapely.LineString):
        return [geometry]
    return [g for g in getattr(geometry, "geoms", []) if isinstance(g, shapely.LineString) and not g.is_empty]


def encode(lines: list[tuple[int, shapely.LineString]], step: int) -> bytes:
    """The lines as a vector tile: each with its height and whether it's an index
    contour (a multiple of five intervals)."""
    features = [
        {"geometry": line, "properties": {"ele": level, "index": level % (step * INDEX_EVERY) == 0}}
        for level, line in lines
    ]
    return mapbox_vector_tile.encode(
        [{"name": LAYER, "features": features}],
        default_options={"extents": EXTENT, "y_coord_down": True},
    )


@lru_cache(maxsize=CACHED_TILES)
def contour_tile(z: int, x: int, y: int, version: str) -> bytes | None:
    """A tile's contour lines, encoded; None where there's no terrain or no line
    (`version`: the terrain files', so a rebuilt file is traced again)."""
    window = elevations.window(z, x, y, MARGIN)
    if window is None:
        return None
    lines = tile_lines(window, z)
    return encode(lines, interval(z)) if lines else None


def tile(z: int, x: int, y: int) -> bytes | None:
    if not FIRST_ZOOM <= z <= LAST_ZOOM:
        return None
    return contour_tile(z, x, y, files.TERRAIN_FILES.version())
