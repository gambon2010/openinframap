"""Fork: lines running close together drawn as one (zoomed_railways.py: the tracks
of a double-track line; zoomed_roads.py: the carriageways of a motorway). Drawn side
by side at a zoom where they're closer than their width, two lines blur into one
unclear band, their dashes (railways, tunnels) out of step."""

from __future__ import annotations

from collections import Counter
from typing import Any

import numpy as np
import shapely


def one_line_where_close(
    lines: np.ndarray, props: list[dict[str, Any]], priority: list, distance: float
) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """Each line less what lies within `distance` of what's kept of the lines before
    it (the smaller `priority` first); bits left beside them dropped. Against what's
    kept, not the whole lines: in a station a track has dozens of tracks before it,
    of which only one or two are still drawn there. Returns single lines and their
    properties."""
    order = sorted(range(len(lines)), key=lambda i: priority[i])
    place = np.empty(len(lines), dtype=int)
    place[order] = np.arange(len(lines))
    near_line, near_other = shapely.STRtree(lines).query(lines, predicate="dwithin", distance=distance)
    before: dict[int, list[int]] = {}
    for i, j in zip(near_line, near_other):
        if place[j] < place[i]:
            before.setdefault(int(i), []).append(int(j))
    # How many lines after each one are compared with it.
    waiting = Counter(j for earlier in before.values() for j in earlier)
    kept: dict[int, list] = {}
    # Each kept piece's surroundings, made once, alone: buffering the pieces near a
    # line together merges their areas, nearly all of the time on a big area. Only
    # while a later line still needs them: a whole country's would fill the memory.
    surroundings: dict[int, np.ndarray] = {}
    for i in order:
        near = [area for j in before.get(i, []) for area in surroundings[j]]
        kept[i] = kept_of(lines[i], near, distance)
        if waiting[i]:
            surroundings[i] = shapely.buffer(np.array(kept[i], dtype=object), distance)
        for j in before.get(i, []):
            waiting[j] -= 1
            if not waiting[j]:
                del surroundings[j]
    out_lines = [piece for i in range(len(lines)) for piece in kept[i]]
    out_props = [props[i] for i in range(len(lines)) for _ in kept[i]]
    return np.array(out_lines, dtype=object), out_props


# Only what runs alongside for this many times the distance is left out: a line
# crossing another, or meeting it, keeps its part near the other (a gap otherwise).
ALONGSIDE = 4


def kept_of(line: shapely.Geometry, near: list, distance: float) -> list:
    """What's left of a line beside the lines drawn near it (`near`: the areas within
    `distance` of them): its single lines, those longer than `distance` (shorter
    ones are bits where lines meet)."""
    if not near:
        return list(shapely.get_parts(line))
    bits_beside = shapely.union_all(shapely.intersection(line, near))
    beside = shapely.get_parts(shapely.line_merge(bits_beside))
    alongside = [p for p in beside if shapely.length(p) > ALONGSIDE * distance]
    if not alongside:
        return list(shapely.get_parts(line))
    # A hair wider than the parts themselves, so the cut is clean.
    removed = shapely.buffer(shapely.multilinestrings(list(shapely.get_parts(alongside))), distance / 100)
    left = shapely.get_parts(shapely.difference(line, removed))
    return [p for p in left if shapely.get_type_id(p) == 1 and shapely.length(p) > distance]
