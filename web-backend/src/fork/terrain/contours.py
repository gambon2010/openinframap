"""Fork: contour lines as vector tiles, made from the terrain's elevations as tiles are
asked for (docs/plans/terrain.md, steps 4 and 5), drawn as on US military maps (FM
3-25.26, Map Reading and Land Navigation, ch. 10): every fifth line an index contour
(heavier, its height written on it), the four between intermediate ones, dashed
supplementary ones at half the interval on level ground, and depressions marked
(contour_marks.py); the interval (the height between two lines) as on the maps'
scales: 100 m at zooms 9-10 (1:250,000), 50 m at 11, 20 m at 12-13 (1:50,000), 10 m
from 14 (1:25,000).

A tile's lines are traced (marching squares, contourpy) on its heights and a margin
of its neighbours', so they run on across tile edges, then cut to the tile and its
buffer. Past zoom 13 they come from zoom 13's heights (the terrain's finest).

Like a paper map's, they're generalised: the heights are smoothed first with a
Gaussian (SciPy), as OpenTopography does before contouring (the LiDAR sees every
ditch and embankment: on flat ground the lines came out ragged and broken), and
scraps too short to read are dropped."""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache
from typing import cast

import contourpy
import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from scipy.ndimage import gaussian_filter  # type: ignore[import-untyped]

from . import contour_marks as marks
from . import elevations, files

EXTENT = 4096  # a tile's units across
BUFFER = 64  # tile units drawn past each edge, as the background map's tiles
LAYER = "contours"
FIRST_ZOOM = 9
LAST_ZOOM = 16
# Supplementary lines from the 1:50,000 sheets' zooms.
FIRST_SUPPLEMENTARY_ZOOM = 12
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


@dataclass(frozen=True)
class Contour:
    level: int  # metres
    line: shapely.LineString  # tile units, rows down
    kind: str  # "index", "intermediate" or "supplementary"
    depression: bool  # closed round lower ground: its inside on the line's right


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


class TileFrame:
    """Where a window's grid sits in its tile: grid points to tile units."""

    def __init__(self, window: elevations.Window):
        self.scale = EXTENT / window.width
        self.shift = np.array([window.left, window.top])

    def cut(self, points: np.ndarray) -> list[shapely.LineString]:
        """A traced line (grid columns, rows) in tile units, simplified, cut to the
        tile and its buffer; nothing if it's too short to read."""
        # Grid indices are pixel centres: half a pixel in from their edges.
        line = shapely.LineString((points + 0.5 - self.shift) * self.scale).simplify(SIMPLIFY)
        if line.length < SHORTEST:
            return []
        return pieces(shapely.clip_by_rect(line, -BUFFER, -BUFFER, EXTENT + BUFFER, EXTENT + BUFFER))


def tile_lines(window: elevations.Window, z: int, y: int) -> list[Contour]:
    """Every contour across a tile (`y`: its row, for the ground's scale)."""
    if np.isnan(window.heights).all():
        return []
    smooth = smoothed(window.heights, SMOOTHING)
    heights = np.ma.masked_invalid(smooth)
    tracer = contourpy.contour_generator(z=heights, line_type=contourpy.LineType.Separate)
    frame = TileFrame(window)
    step = interval(z)
    found = []
    for level in levels(heights.compressed(), step):
        kind = "index" if level % (step * INDEX_EVERY) == 0 else "intermediate"
        for points in traced(tracer, level):
            found += contour_pieces(points, level, kind, smooth, frame)
    if z >= FIRST_SUPPLEMENTARY_ZOOM:
        pixel_metres = marks.ground_metres_per_pixel(z, y) * marks.TILE_PIXELS / window.width
        flattest = marks.flattest_slope(step, z, y)
        slope = marks.slopes(smooth, pixel_metres)
        for level in levels(heights.compressed(), step // 2):
            if level % step:
                for points in traced(tracer, level):
                    found += supplementary_pieces(points, level, smooth, slope, flattest, frame)
    return found


def contour_pieces(
    points: np.ndarray, level: int, kind: str, smooth: np.ndarray, frame: TileFrame
) -> list[Contour]:
    """A traced regular line, marked a depression if it is one, cut to the tile."""
    depression = marks.is_depression(points, level, smooth)
    if depression:
        points = marks.inside_on_the_right(points)
    return [Contour(level, part, kind, depression) for part in frame.cut(points)]


def supplementary_pieces(
    points: np.ndarray, level: int, smooth: np.ndarray, slope: np.ndarray, flattest: float, frame: TileFrame
) -> list[Contour]:
    """A traced half-interval line, only its stretches on level ground (a depression
    on level ground whole), cut to the tile."""
    depression = marks.is_depression(points, level, smooth)
    if depression:
        points = marks.inside_on_the_right(points)
        wholly_level = marks.on_level_ground(points, slope, flattest).all()
        stretches = [points] if wholly_level else []
    else:
        stretches = marks.level_stretches(points, slope, flattest)
    return [Contour(level, part, "supplementary", depression) for run in stretches for part in frame.cut(run)]


def smoothed(heights: np.ndarray, spread: float) -> np.ndarray:
    """Heights blurred by a Gaussian; where there are none (NaN) they stay none, and
    don't pull their neighbours down (each point's blur divided by how much of it
    fell on known heights: normalised convolution)."""
    known = ~np.isnan(heights)
    values = gaussian_filter(np.where(known, heights, 0.0), spread, mode="nearest")
    weights = gaussian_filter(known.astype(np.float64), spread, mode="nearest")
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(known, values / weights, np.nan)


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


def encode(contours: list[Contour]) -> bytes:
    """The lines as a vector tile: each with its height, kind and whether it's a
    depression."""
    features = [
        {
            "geometry": c.line,
            "properties": {"ele": c.level, "kind": c.kind, "depression": c.depression},
        }
        for c in contours
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
    lines = tile_lines(window, z, y)
    return encode(lines) if lines else None


def tile(z: int, x: int, y: int) -> bytes | None:
    if not FIRST_ZOOM <= z <= LAST_ZOOM:
        return None
    return contour_tile(z, x, y, files.TERRAIN_FILES.version())
