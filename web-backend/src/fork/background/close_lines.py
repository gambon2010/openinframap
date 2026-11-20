"""Fork: tracks running close together drawn as one (zoomed_railways.py: the tracks
of a double-track line, a tram's two). Drawn side by side at a zoom where they're
closer than their width, two tracks blur into one unclear band, their white dashes
out of step. (Roads aren't: zoomed_roads.py.) Planetiler has nothing for this: its
`FeatureMerge.mergeLineStrings` joins lines end to end, not side by side."""

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
        drawn_near = [piece for j in before.get(i, []) for piece in kept[j]]
        kept[i] = kept_of(lines[i], near, drawn_near, distance)
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


def kept_of(line: shapely.Geometry, near: list, drawn_near: list, distance: float) -> list:
    """What's left of a line beside the lines drawn near it (`drawn_near`; `near`:
    the areas within `distance` of them): its single lines, those longer than
    `distance` (shorter ones are bits where lines meet), each joined back to the
    line it ran beside."""
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
    pieces = [p for p in left if shapely.get_type_id(p) == 1 and shapely.length(p) > distance]
    return [joined_back(p, drawn_near, distance) for p in pieces]


# A piece's end this many times the distance from the line it ran beside, or nearer,
# is where it was cut: it's carried on to meet that line.
REACH = 1.5


def joined_back(piece: shapely.LineString, drawn_near: list, distance: float) -> shapely.LineString:
    """A piece left where its line ran beside another, each cut end carried on to
    the nearest point of that line: the two meet, instead of one stopping short of
    the other (a gap where tracks join)."""
    others = shapely.multilinestrings(drawn_near)
    coords = list(piece.coords)
    for end in (0, -1):
        cut_end = shapely.Point(coords[end])
        if shapely.distance(cut_end, others) > REACH * distance:
            continue
        meeting = shapely.shortest_line(cut_end, others).coords[-1]
        if end == 0:
            coords.insert(0, meeting)
        else:
            coords.append(meeting)
    return shapely.LineString(coords)
