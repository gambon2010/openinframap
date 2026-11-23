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
draws exactly what the answer used. Trees don't count as a sure stop (a signal
may pass through foliage, a gap may show the target): hidden only by trees, the
answer says so (`through_trees`), and what's named as hiding the target is the first
solid thing (the ground, a building) when there is one. Obstacles within END_CLEAR of either end are
left out: the observer and the target stand at a wood's edge, not inside it; and
only where the terrain is bare ground (bare_ground.py: France), not counted twice
where it already holds them."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass

from . import elevations, obstacles

EARTH_RADIUS = 6_371_008.8  # metres, the mean radius
# Curvature less refraction, for visible light (GDAL's default).
VISIBLE_LIGHT = 6 / 7
# At most this many samples along a line: one per terrain pixel to about 250 km at
# 48° N; longer lines are sampled more sparsely (a narrow crest may fall between).
MOST_SAMPLES = 40_000
# Obstacles this close to either end are left out (metres).
END_CLEAR = 30.0

# How steeply the line from the observer's eye rises to a height at a distance.
Rise = Callable[[float, float], float]
# What stands at each point along the line (obstacles.obstacles_at).
ObstaclesAt = Callable[[list[tuple[float, float]], obstacles.Heights], list[obstacles.Obstacle]]
# Whether the terrain at a point (lon, lat) is bare ground (bare_ground.py).
BareGround = Callable[[float, float], bool]


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
    # Metres from the observer to the first solid surface hiding the target (the first
    # trees if only trees hide it), and what that is: "ground", "building", "trees".
    blocked_at: float | None
    blocked_by: str | None = None
    # Metres the eye's line to the target clears everything by (< 0: how far what's
    # named as hiding it, solid or trees, rises above it).
    margin: float | None = None
    eye: float | None = None  # the eye's height (metres above sea level)
    target_top: float | None = None  # the target's top as seen from the eye (lowered)
    obstacles_counted: bool = False  # trees and buildings added somewhere along the line
    through_trees: bool = False  # hidden only by trees: it may still be seen


def along(a: tuple[float, float], b: tuple[float, float], f: float) -> tuple[float, float]:
    """The point a fraction `f` of the way from a to b (lon, lat; straight in
    degrees: lines of sight are short enough)."""
    return a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f


def ground_distance(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Metres between two points (haversine)."""
    lon1, lat1, lon2, lat2 = map(math.radians, (*a, *b))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_RADIUS * math.asin(math.sqrt(h))


def sample_count(length: float, lat: float) -> int:
    """How many samples a line gets: one per terrain pixel (its finest zoom's width
    at the line's latitude), so no crest falls between two (MOST_SAMPLES at most)."""
    pixel = elevations.ground_metres_per_pixel(lat, elevations.FINEST_ZOOM)
    return max(2, min(MOST_SAMPLES, math.ceil(length / pixel) + 1))


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
    assumed: obstacles.Heights = obstacles.Heights(),
    bare_ground: BareGround | None = None,
) -> Sight:
    """The profile from observer to target, what of it is seen, what first hides the
    target and by how much."""
    length = ground_distance(observer_at, target_at)
    count = sample_count(length, (observer_at[1] + target_at[1]) / 2)
    points = [along(observer_at, target_at, i / (count - 1)) for i in range(count)]
    heights = [elevations.elevation(*point) for point in points]
    distances = [length * i / (count - 1) for i in range(count)]
    if heights[0] is None or heights[-1] is None:
        return Sight([Sample(d, h, False) for d, h in zip(distances, heights)], None, None)
    on_bare = [True if bare_ground is None else bare_ground(*point) for point in points]
    standing = standing_on(
        points, distances, length, on_bare, assumed, obstacles_at or obstacles.obstacles_at
    )
    eye = heights[0] + observer

    def rise(height: float, distance: float) -> float:
        """How steeply the line from the eye rises to a height at a distance."""
        return (lowered(height, distance, coefficient) - eye) / distance

    samples = profile(heights, distances, standing, rise, coefficient)
    target_height = heights[-1] + target
    target_rise = rise(target_height, length)
    blocker = first_hiding(samples[1:-1], target_rise, rise, surface_rise)
    solid = first_hiding(samples[1:-1], target_rise, rise, solid_rise)
    named = solid or blocker
    target_top = lowered(target_height, length, coefficient)
    # The margin measures what the answer names: the solid things when they hide the
    # target, everything (trees too) otherwise.
    top = solid_apparent if solid else whole_apparent
    margin = clearance(samples[1:-1], eye, target_top, length, top)
    return Sight(
        samples,
        blocker is None,
        None if named is None else named.distance,
        None if named is None else blocked_by(named, target_rise, rise),
        margin,
        eye,
        target_top,
        any(on_bare),
        through_trees=blocker is not None and solid is None,
    )


def standing_on(
    points: list[tuple[float, float]],
    distances: list[float],
    length: float,
    on_bare: list[bool],
    assumed: obstacles.Heights,
    obstacles_at: ObstaclesAt,
) -> list[obstacles.Obstacle]:
    """What stands at each sample, but near either end (END_CLEAR) and where the
    terrain isn't bare ground (it holds them already)."""
    if not any(on_bare):
        return [obstacles.NOTHING] * len(points)
    found = obstacles_at(points, assumed)
    return [
        obstacle if bare and END_CLEAR <= d <= length - END_CLEAR else obstacles.NOTHING
        for d, obstacle, bare in zip(distances, found, on_bare)
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


def clearance(
    between: list[Sample],
    eye: float,
    target_top: float,
    length: float,
    top: Callable[[Sample], float | None],
) -> float | None:
    """How far the eye's straight line to the target passes over the highest top
    between them (`top`: a sample's whole surface or its solid part, as seen from the
    eye; < 0: that rises above the line, by that much); None if there's nothing
    between."""
    gaps = []
    for s in between:
        height = top(s)
        if height is not None:
            gaps.append(eye + (target_top - eye) * s.distance / length - height)
    return min(gaps) if gaps else None


def whole_apparent(sample: Sample) -> float | None:
    """A sample's surface as seen from the eye: the ground and all that stands on it."""
    return sample.apparent


def solid_apparent(sample: Sample) -> float | None:
    """A sample's solid top as seen from the eye: without trees."""
    if sample.apparent is None or sample.obstacle.kind != "trees":
        return sample.apparent
    return sample.apparent - sample.obstacle.height


def surface_rise(sample: Sample, rise: Rise) -> float:
    """How steeply the eye's line rises to a sample's surface (-inf: no terrain)."""
    if sample.ground is None:
        return -math.inf
    return rise(sample.ground + sample.obstacle.height, sample.distance)


def solid_rise(sample: Sample, rise: Rise) -> float:
    """How steeply the eye's line rises to a sample's solid top: the ground, and a
    building on it (not trees: foliage may let the line through)."""
    if sample.ground is None:
        return -math.inf
    building = sample.obstacle.height if sample.obstacle.kind == "building" else 0.0
    return rise(sample.ground + building, sample.distance)


def first_hiding(
    between: list[Sample], target_rise: float, rise: Rise, top_rise: Callable[[Sample, Rise], float]
) -> Sample | None:
    """The first sample whose top (`top_rise`: its whole surface, or only what's solid)
    rises above the eye's line to the target (the samples between the two: the
    target's own ground can't hide it); None if none."""
    for sample in between:
        if top_rise(sample, rise) > target_rise:
            return sample
    return None


def blocked_by(sample: Sample, target_rise: float, rise: Rise) -> str:
    """What hides the target there: the ground itself, or what stands on it."""
    if sample.ground is not None and rise(sample.ground, sample.distance) > target_rise:
        return "ground"
    return sample.obstacle.kind
