"""Fork: what a traced contour line is, beyond its height (contours.py), as on US
military maps (FM 3-25.26, Map Reading and Land Navigation, ch. 10) and the USGS's US
Topo specifications (elevation):

- **supplementary contours**: lines at half the interval, kept only where the ground
  is fairly level, "where there is very little change in elevation" (FM 3-25.26):
  where the regular lines would be far apart on screen, more than FLAT_SPACING
  pixels (an inch: the rule of thumb USGS mapping used; tuned by eye);
- **depression contours**: a closed line with lower ground inside it (a doline, a
  quarry, a crater), its ticks pointing to the lower ground (US Topo: index,
  intermediate and supplementary lines alike). Its points are put in the order that
  has the inside on the line's right, so the map draws the ticks there.

A depression is only seen when its whole line lies inside the heights traced (the
tile and its margin): a bigger one stays an ordinary line."""

from __future__ import annotations

import numpy as np
import shapely

# Regular lines further apart than this on screen (pixels) mean level ground, where
# supplementary lines are drawn.
FLAT_SPACING = 96
# A tile is drawn this many pixels wide.
TILE_PIXELS = 512
EARTH_CIRCUMFERENCE = 40_075_016.686  # metres, at the equator (web Mercator)


def ground_metres_per_pixel(z: int, y: int) -> float:
    """A screen pixel's width on the ground in a tile row (web Mercator)."""
    lat = np.arctan(np.sinh(np.pi * (1 - 2 * (y + 0.5) / 2**z)))
    return float(EARTH_CIRCUMFERENCE * np.cos(lat) / 2**z / TILE_PIXELS)


def flattest_slope(interval: int, z: int, y: int) -> float:
    """The steepest slope (metres a metre) still counted level ground at this zoom:
    regular lines `interval` apart would be FLAT_SPACING pixels apart there."""
    return interval / (FLAT_SPACING * ground_metres_per_pixel(z, y))


def slopes(heights: np.ndarray, pixel_metres: float) -> np.ndarray:
    """Each grid point's slope (metres a metre), from its neighbours."""
    rows, columns = np.gradient(heights, pixel_metres)
    return np.hypot(rows, columns)


def on_level_ground(points: np.ndarray, slope: np.ndarray, flattest: float) -> np.ndarray:
    """For each of a line's points (grid columns, rows): whether the ground there is
    level (its slope below `flattest`)."""
    columns = np.clip(np.rint(points[:, 0]).astype(int), 0, slope.shape[1] - 1)
    rows = np.clip(np.rint(points[:, 1]).astype(int), 0, slope.shape[0] - 1)
    return slope[rows, columns] < flattest


def level_stretches(points: np.ndarray, slope: np.ndarray, flattest: float) -> list[np.ndarray]:
    """The runs of a line's points where the ground is level."""
    level = on_level_ground(points, slope, flattest)
    runs, start = [], None
    for i, flat in enumerate(level):
        if flat and start is None:
            start = i
        elif not flat and start is not None:
            runs.append(points[start:i])
            start = None
    if start is not None:
        runs.append(points[start:])
    return [run for run in runs if len(run) >= 2]


def is_depression(points: np.ndarray, level: float, heights: np.ndarray) -> bool:
    """Whether a line is closed round lower ground: its inside's heights (a point
    well inside it) below its own."""
    if len(points) < 4 or not np.allclose(points[0], points[-1]):
        return False
    ring = shapely.Polygon(points)
    if not ring.is_valid or ring.area < 1:
        return False
    inside = ring.representative_point()
    height = heights[int(round(inside.y)), int(round(inside.x))]
    return bool(height < level)


def inside_on_the_right(points: np.ndarray) -> np.ndarray:
    """A closed line's points in the order that has its inside on the right when
    walking it, on screen (rows grow downwards): shapely's counter-clockwise, as
    shapely counts with rows growing upwards."""
    ring = shapely.LinearRing(points)
    return points if ring.is_ccw else points[::-1]
