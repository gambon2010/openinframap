"""Fork: line of sight between two points over the terrain (docs/plans/terrain.md,
step 6): the ground's profile along the line, which of it the observer sees, and
whether the target is seen.

As GDAL's viewshed (gdal_viewshed): the ground further away is lowered for the
Earth's curvature, less the light's bending in the air, by
    coefficient × distance² / (2 × the Earth's radius),
the coefficient 6/7 for visible light (the standard refraction of 1/7; GDAL's
default; radio waves bend more: 0.75); the observer `observer` metres above the
ground (GDAL's default 2), the target `target` metres above it (0). A point is seen
when the line from the observer's eye to it rises at least as steeply as to every
point before it (the classic profile test, as GRASS's r.los and viewsheds along a
ray)."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from . import elevations

EARTH_RADIUS = 6_371_008.8  # metres, the mean radius
# Curvature less refraction, for visible light (GDAL's default).
VISIBLE_LIGHT = 6 / 7
# The terrain's pixel at zoom 13 in France: a sample every this many metres.
STEP = 6.0
# At most this many samples along a line (longer lines are sampled more sparsely).
MOST_SAMPLES = 4000

# How steeply the line from the observer's eye rises to a height at a distance.
Rise = Callable[[float, float], float]


@dataclass(frozen=True)
class Sample:
    distance: float  # metres from the observer
    ground: float | None  # metres above sea level (None: no terrain there)
    seen: bool


@dataclass(frozen=True)
class Sight:
    samples: list[Sample]
    target_seen: bool | None  # None: no terrain under one of the ends
    blocked_at: float | None  # metres from the observer to the first ground hiding the target


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
) -> Sight:
    """The profile from observer to target, what of it is seen, and whether the
    target is."""
    length = ground_distance(observer_at, target_at)
    count = max(2, min(MOST_SAMPLES, int(length / STEP) + 1))
    heights = [elevations.elevation(*along(observer_at, target_at, i / (count - 1))) for i in range(count)]
    distances = [length * i / (count - 1) for i in range(count)]
    if heights[0] is None or heights[-1] is None:
        return Sight([Sample(d, h, False) for d, h in zip(distances, heights)], None, None)
    eye = heights[0] + observer

    def rise(height: float, distance: float) -> float:
        """How steeply the line from the eye rises to a height at a distance."""
        return (lowered(height, distance, coefficient) - eye) / distance

    samples = profile(heights, distances, rise)
    target_rise = rise(heights[-1] + target, length)
    blocked_at = first_hiding(samples[1:-1], target_rise, rise)
    return Sight(samples, blocked_at is None, blocked_at)


def profile(heights: list[float | None], distances: list[float], rise: Rise) -> list[Sample]:
    """Each sample, seen when the eye's line to it rises at least as steeply as to
    every sample before it (the observer's own ground is seen)."""
    steepest = -math.inf
    samples = [Sample(0.0, heights[0], True)]
    for distance, height in zip(distances[1:], heights[1:]):
        if height is None:
            samples.append(Sample(distance, None, False))
            continue
        steepness = rise(height, distance)
        samples.append(Sample(distance, height, steepness >= steepest))
        steepest = max(steepest, steepness)
    return samples


def first_hiding(between: list[Sample], target_rise: float, rise: Rise) -> float | None:
    """How far from the observer the first ground rising above the eye's line to the
    target is (the samples between the two: the target's own ground can't hide it);
    None if nothing does."""
    for sample in between:
        if sample.ground is not None and rise(sample.ground, sample.distance) > target_rise:
            return sample.distance
    return None
