"""Fork: each tram and metro line's stops, from OpenStreetMap's routes, so the map can
show a highlighted line's stops (loom_tiles.py puts them in the trams' tiles, layer
STOPS_LAYER; the map's modules/roads/lane-highlight.ts).

A route's stops are its stop members; a route listing none, its platforms. A stop's
positions (one per direction, a platform each side) are one: those of one name
within MERGE_M of each other.

A stop says which lines call there by their letter or number only (",A,D,"): a
route's kind may differ from its tracks' (a light rail route on tram tracks), and
the lanes the map highlights are named after the tracks. Lines of one letter in two
cities are far apart, so their stops don't mix on screen.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely

from .tiles import in_tile_units, map_units
from .transit_lines import line_of
from .zoomed_railways import mercator

STOPS_LAYER = "stops"
MERGE_M = 200
STOP_ROLES = ("stop", "stop_entry_only", "stop_exit_only")
PLATFORM_ROLES = ("platform", "platform_entry_only", "platform_exit_only")

# An OpenStreetMap object: its type ("n", "w") and id.
Member = tuple[str, int]


@dataclass
class Stop:
    """A stop: where (web Mercator metres; the mean of its positions), its name, and
    the lines calling there."""

    name: str
    xs: list[float] = field(default_factory=list)
    ys: list[float] = field(default_factory=list)
    lines: set[str] = field(default_factory=set)

    @property
    def point(self) -> shapely.Point:
        return shapely.Point(float(np.mean(self.xs)), float(np.mean(self.ys)))


@dataclass
class _Route:
    ref: str
    stops: list[Member] = field(default_factory=list)
    platforms: list[Member] = field(default_factory=list)

    def calls(self) -> list[Member]:
        """Where the route stops: its stops, else its platforms."""
        return self.stops or self.platforms


class _Reader(osmium.SimpleHandler):
    """Named nodes and ways (where they are, their name), and the routes' stops. A
    file's nodes and ways come before its relations: every named one is kept, the
    routes picking theirs at the end."""

    def __init__(self) -> None:
        super().__init__()
        self.places: dict[Member, tuple[float, float, str]] = {}
        self.routes: list[_Route] = []

    def node(self, n) -> None:
        name = n.tags.get("name")
        if name and n.location.valid():
            self.places[("n", n.id)] = (n.location.lon, n.location.lat, name)

    def way(self, w) -> None:
        name = w.tags.get("name")
        if not name:
            return
        try:
            points = np.array([(n.lon, n.lat) for n in w.nodes])
        except osmium.InvalidLocationError:
            return  # a node outside the extract
        lon, lat = points.mean(axis=0)
        self.places[("w", w.id)] = (float(lon), float(lat), name)

    def relation(self, r) -> None:
        line = line_of({t.k: t.v for t in r.tags})
        if line is None:
            return
        route = _Route(line[0])
        for member in r.members:
            if member.role in STOP_ROLES and member.type == "n":
                route.stops.append(("n", member.ref))
            elif member.role in PLATFORM_ROLES:
                route.platforms.append((member.type, member.ref))
        self.routes.append(route)


def stops(railways: Path) -> list[Stop]:
    """The stops of a railways file's tram and metro routes (railways.py)."""
    reader = _Reader()
    reader.apply_file(str(railways), locations=True)
    merged = _Merged()
    for route in reader.routes:
        for member in route.calls():
            if member in reader.places:
                merged.add(*reader.places[member], route.ref)
    return merged.stops


class _Merged:
    """Stops of one name within MERGE_M of each other, as one."""

    def __init__(self) -> None:
        self.stops: list[Stop] = []
        self.by_name: dict[str, list[Stop]] = {}

    def add(self, lon: float, lat: float, name: str, ref: str) -> None:
        x, y = mercator(np.array([[lon, lat]]))[0]
        reach = map_units(MERGE_M, y)
        same = self.by_name.setdefault(name, [])
        stop = next((s for s in same if s.point.distance(shapely.Point(x, y)) <= reach), None)
        if stop is None:
            stop = Stop(name)
            same.append(stop)
            self.stops.append(stop)
        stop.xs.append(x)
        stop.ys.append(y)
        stop.lines.add(ref)


def lines_text(lines: set[str]) -> str:
    """The lines calling at a stop as the map matches them: ",A,D," (a line is in it
    as ",A,")."""
    return "," + ",".join(sorted(lines)) + ","


class StopIndex:
    """The stops, found by tile."""

    def __init__(self, found: list[Stop]):
        self.stops = found
        self.points = np.array([s.point for s in found], dtype=object)
        self.tree = shapely.STRtree(self.points)

    def layer(self, bounds: tuple[float, float, float, float]) -> dict[str, Any] | None:
        """The stops in a tile (bounds in metres) as its STOPS_LAYER; None if none."""
        inside = self.tree.query(shapely.box(*bounds), "contains")
        if not len(inside):
            return None
        features = [
            {
                "geometry": in_tile_units(self.points[i], bounds),
                "properties": {"name": self.stops[i].name, "lines": lines_text(self.stops[i].lines)},
            }
            for i in sorted(inside)
        ]
        return {"name": STOPS_LAYER, "features": features}
