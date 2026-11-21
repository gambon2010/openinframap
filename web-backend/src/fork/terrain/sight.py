"""Fork: line of sight between two points over the terrain (docs/plans/terrain.md,
step 6; docs/plans/archive/line-of-sight.md): the ground's profile along the line, what
stands on it (buildings, trees: obstacles.py), which of it the observer sees, what
first hides the target and by how much.

As GDAL's viewshed (gdal_viewshed): the ground further away is lowered for the
Earth's curvature, less the light's bending in the air, by
    coefficient × distance² / (2 × the Earth's radius),
the coefficient 6/7 for visible light (the standard refraction of 1/7; GDAL's
default; radio waves bend more: 0.75); the observer `observer` metres above the
ground (GDAL's default 2), the target `target` metres above it (0). A point is seen
when the line from the observer's eye to it rises at least as steeply as to every
surface before it (the classic profile test, as GRASS's r.los and viewsheds along a
ray). Each sample also says its surface as seen from the eye (lowered), so a chart
draws exactly what the answer used. Obstacles within END_CLEAR of either end are
left out: the observer and the target stand at a wood's edge, not inside it."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from . import elevations, obstacles

EARTH_RADIUS = 6_371_008.8  # metres, the mean radius
# Curvature less refraction, for visible light (GDAL's default).
VISIBLE_LIGHT = 6 / 7
# The terrain's pixel at zoom 13 in France: a sample every this many metres.
STEP = 6.0
# At most this many samples along a line (longer lines are sampled more sparsely).
MOST_SAMPLES = 4000
# Obstacles this close to either end are left out (metres).
END_CLEAR = 30.0

# How steeply the line from the observer's eye rises to a height at a distance.
Rise = Callable[[float, float], float]
# What stands at each point along the line (obstacles.obstacles_at).
ObstaclesAt = Callable[[list[tuple[float, float]]], list[obstacles.Obstacle]]


@dataclass(frozen=True)
class Sample:
    distance: float  # metres from the observer
    ground: float | None  # metres above sea level (None: no terrain there)
    seen: bool  # the ground there, by the observer
    obstacle: obstacles.Obstacle = obstacles.NOTHING
    apparent: float | None = None  # the surface's top as seen from the eye (lowered)


@dataclass(frozen=True)
class Sight:
    samples: list[Sample]
    target_seen: bool | None  # None: no terrain under one of the ends
    blocked_at: float | None  # metres from the observer to the first surface hiding the target
    blocked_by: str | None = None  # "ground", "building", "trees"
    margin: float | None = None  # metres the eye's line to the target clears everything by (< 0: what rises above it, by that much)
    eye: float | None = None  # the eye's height (metres above sea level)
    target_top: float | None = None  # the target's top as seen from the eye (lowered)


def along(a: tuple[float, float], b: tuple[float, float], f: float) -> tuple[float, float]:
    """The point a fraction `f` of the way from a to b (lon, lat; straight in
    degrees: lines of sight are short enough)."""
    return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f


def ground_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Metres between two points (haversine)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(h))


def lowered(height: float, distance: float, coefficient: float) -> float:
    """A height as seen from afar: lowered for the Earth's curvature, less refraction."""
    return height - coefficient * distance**2 / (2 * EARTH_RADIUS)


def line_of_sight(
    observer_at: tuple[float, float],
    target_at: tuple[float, float],
    observer: float = 2.0,
    target: float = 0.0,
    coefficient: float = VISIBLE_LIGHT,
    obstacles_at: ObstaclesAt | None = None,
) -> Sight:
    """The profile from observer to target, what of it is seen, what first hides the
    target and by how much."""
    length = ground_distance(observer_at, target_at)
    count = max(2, min(MOST_SAMPLES, int(length / STEP) + 1))
    points = [along(observer_at, target_at, i / (count - 1)) for i in range(count)]
    heights = [elevations.elevation(*point) for point in points]
    distances = [length * i / (count - 1) for i in range(count)]
    if heights[0] is None or heights[-1] is None:
        return Sight([Sample(d, h, False) for d, h in zip(distances, heights)], None, None)
    standing = standing_on(points, distances, length, obstacles_at or obstacles.obstacles_at)
    eye = heights[0] + observer

    def rise(height: float, distance: float) -> float:
        """How steeply the line from the eye rises to a height at a distance."""
        return (lowered(height, distance, coefficient) - eye) / distance

    samples = profile(heights, distances, standing, rise, coefficient)
    target_height = heights[-1] + target
    target_rise = rise(target_height, length)
    blocker = first_hiding(samples[1:-1], target_rise, rise)
    target_top = lowered(target_height, length, coefficient)
    margin = clearance(samples[1:-1], eye, target_top, length)
    return Sight(
        samples,
        blocker is None,
        None if blocker is None else blocker.distance,
        None if blocker is None else blocked_by(blocker, target_rise, rise),
        margin,
        eye,
        target_top,
    )


def standing_on(
    points: list[tuple[float, float]], distances: list[float], length: float, obstacles_at: ObstaclesAt
) -> list[obstacles.Obstacle]:
    """What stands at each sample, but near either end (END_CLEAR)."""
    found = obstacles_at(points)
    return [
        obstacles.NOTHING if d < END_CLEAR or length - d < END_CLEAR else obstacle
        for d, obstacle in zip(distances, found)
    ]


def profile(
    heights: list[float | None],
    distances: list[float],
    standing: list[obstacles.Obstacle],
    rise: Rise,
    coefficient: float,
) -> list[Sample]:
    """Each sample: its ground seen when the eye's line to it rises at least as
    steeply as to every surface (ground and what stands on it) before it; the
    observer's own ground is seen."""
    steepest = -math.inf
    samples = [Sample(0.0, heights[0], True, standing[0], heights[0])]
    for distance, height, obstacle in zip(distances[1:], heights[1:], standing[1:]):
        if height is None:
            samples.append(Sample(distance, None, False))
            continue
        seen = rise(height, distance) >= steepest
        top = height + obstacle.height
        samples.append(Sample(distance, height, seen, obstacle, lowered(top, distance, coefficient)))
        steepest = max(steepest, rise(top, distance))
    return samples


def clearance(between: list[Sample], eye: float, target_top: float, length: float) -> float | None:
    """How far the eye's straight line to the target passes over the highest surface
    between them, as seen from the eye (< 0: that surface rises above the line, by
    that much); None if there's nothing between."""
    gaps = [
        eye + (target_top - eye) * s.distance / length - s.apparent
        for s in between
        if s.apparent is not None
    ]
    return min(gaps) if gaps else None


def surface_rise(sample: Sample, rise: Rise) -> float:
    """How steeply the eye's line rises to a sample's surface (-inf: no terrain)."""
    if sample.ground is None:
        return -math.inf
    return rise(sample.ground + sample.obstacle.height, sample.distance)


def first_hiding(between: list[Sample], target_rise: float, rise: Rise) -> Sample | None:
    """The first sample whose surface rises above the eye's line to the target (the
    samples between the two: the target's own ground can't hide it); None if none."""
    for sample in between:
        if surface_rise(sample, rise) > target_rise:
            return sample
    return None


def blocked_by(sample: Sample, target_rise: float, rise: Rise) -> str:
    """What hides the target there: the ground itself, or what stands on it."""
    if sample.ground is not None and rise(sample.ground, sample.distance) > target_rise:
        return "ground"
    return sample.obstacle.kind
