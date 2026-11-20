"""Fork: the tram, metro and light rail lines, for LOOM (loom_input.py). Which lines
run on each track comes from OpenStreetMap's routes: a route is one line (its letter
or number, its colour), its ways the tracks it runs on.

A line keeps its colour as tagged on its route (the operator's, as on its signs);
without one, a colour from PALETTE picked by its letter or number, so line A is the
same colour wherever it has none.
"""

from __future__ import annotations

import re
import zlib
from typing import Any

TRANSIT_KINDS = ("tram", "subway", "light_rail")
COLOUR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
PALETTE = (
    "#e2001a",
    "#0072bc",
    "#00a650",
    "#f7a600",
    "#8e44ad",
    "#00b5e2",
    "#e5007d",
    "#8b6c42",
    "#ff6f00",
    "#2e7d32",
)

# A line: its letter or number, and its colour.
Line = tuple[str, str]


def is_transit(props: dict[str, Any]) -> bool:
    return props.get("kind") in TRANSIT_KINDS


def line_of(tags: dict[str, str]) -> Line | None:
    """A route's line (its ref, else its name; its colour); None if it isn't a
    tram, metro or light rail route, or has no name."""
    if tags.get("type") != "route" or tags.get("route") not in TRANSIT_KINDS:
        return None
    ref = tags.get("ref") or tags.get("name")
    if not ref:
        return None
    tagged = tags.get("colour", "")
    return ref, tagged if COLOUR.match(tagged) else PALETTE[zlib.crc32(ref.encode()) % len(PALETTE)]


def in_order(lines: set[Line]) -> tuple[Line, ...]:
    """The lines on a track in order: by letter or number, numbers as numbers (2
    before 10)."""

    def natural(line: Line) -> list:
        return [int(part) if part.isdigit() else part for part in re.split(r"(\d+)", line[0])]

    return tuple(sorted(lines, key=natural))
