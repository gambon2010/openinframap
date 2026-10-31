"""
Fork: following a power line through the grid network (schema/grid.sql), from a
clicked piece to the stations at its ends: GET /grid/line (grid.py) and the check of
the whole network (grid_check.py).

The network (lines of 10 kV and more, split into stretches between junctions) is
loaded once into memory (`GridIndex`) and reloaded when the grid is rebuilt. A way
carrying several voltages ("225000;63000", two lines on the same pylons) belongs to
each of them.

A line is followed through junctions (pylons where OSM ways join, or that lines
share), never through stations, and only along what continues it:
- the same OSM way;
- a way with the same name, compared by the places it joins ("Liaison 225 kV n°1
  A - B" = "a - b"; ";" separates the lines of shared pylons);
- where its way ends: the single way starting there that has no other line's name,
  or where several start (a double line splitting in two near a substation), the
  straightest if clearly so, else the one leading to a station named after one of
  its places. If none can be told, the first stretch of each is shown, not followed.
Every place the trace stops at something other than a station is a loose end, with
the reason (`Trace.loose`): those are where the map's data is probably wrong.
"""

from __future__ import annotations

import math
import re
import unicodedata
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# Several ways start where a line ends: the straightest one is its continuation if
# it turns less than this, and clearly less than the next one (degrees).
MAX_TURN = 45
CLEAR_MARGIN = 15
# Two ways leaving a junction this straight (degrees) are one line passing through.
THROUGH_TURN = 30
# Two ways leaving a junction this close (degrees) run side by side.
PARALLEL_TURN = 10
# Stretches followed before giving up (a corridor looping through junctions).
MAX_EDGES = 5000

Vector = tuple[float, float]


@dataclass(slots=True)
class Edge:
    edge_id: int
    way: int
    source: int
    target: int
    voltages: frozenset[int]
    name: str | None
    length_m: float
    # Direction leaving the source, and leaving the target (east, north).
    out_source: Vector
    out_target: Vector

    def away_from(self, node: int) -> Vector:
        return self.out_source if node == self.source else self.out_target

    def other(self, node: int) -> int:
        return self.target if node == self.source else self.source


@dataclass(slots=True)
class Node:
    kind: str  # substation, plant or junction
    osm_id: int | None
    name: str | None


def voltages_of(tag: str | None, fallback: int) -> frozenset[int]:
    """The voltages of a way's tag ("225000;63000"), or the one given."""
    values = set()
    for value in (tag or "").split(";"):
        try:
            values.add(int(float(value.strip())))
        except ValueError:
            pass
    return frozenset(values or {fallback})


LineEnds = tuple[frozenset[str], int | None]
# A circuit number: "n°1", "N° 2", "No 3", "N0 1" (a zero typed for the °).
CIRCUIT = re.compile(r"(?i)\bn\s*[°º0o]\.?\s*(\d+)\b")


def place(text: str) -> str:
    """A place name compared loosely: lower case, no accents, "St-" = "Saint-"."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"\bste?\b\.?", lambda m: "sainte" if m.group(0).startswith("ste") else "saint", text)
    return " ".join(re.sub(r"[-'’]", " ", text).split())


def line_ends(name: str | None) -> set[LineEnds]:
    """The places a line's name joins, and its circuit number if it says:
    "Liaison 225 kV n°1 Graffenstaden - Marlenheim" gives ({graffenstaden,
    marlenheim}, 1), "graffenstaden - marlenheim" the same places and no number; a
    line with a tee names three ("A - B - C"); a name for several lines on shared
    pylons ("…;…") gives each."""
    found = set()
    for part in (name or "").split(";"):
        number = re.search(CIRCUIT, part)
        part = re.sub(r"(?i)\b(liaisons?|lignes?|et)\b|\b\d+([.,]\d+)?\s*kv\b", " ", CIRCUIT.sub(" ", part))
        places = [place(p) for p in re.split(r"\s+-\s+|\s*[–—]\s*", part)]
        places = [p for p in places if p]
        if len(places) >= 2:
            found.add((frozenset(places), int(number.group(1)) if number else None))
    return found


def same_line(a: set[LineEnds], b: set[LineEnds]) -> bool:
    """Whether two names are of the same line: the same places (or one naming part
    of the other's: "A - B" of "A - B - C"), and the same circuit number when both
    give one (n°1 and n°2 are two lines)."""
    return any(
        (pa <= pb or pb <= pa) and (na is None or nb is None or na == nb) for pa, na in a for pb, nb in b
    )


def shares_a_place(a: set[LineEnds], b: set[LineEnds]) -> bool:
    """Whether two lines' names have a place in common (two lines going into the
    same substation on shared pylons)."""
    return any(pa & pb for pa, _ in a for pb, _ in b)


def turn(arriving: Vector, leaving: Vector) -> float:
    """How much a line turns (degrees, 0 = straight on) going in along `arriving`
    (pointing away from the node) and out along `leaving`."""
    angle = math.degrees(math.atan2(leaving[1], leaving[0]) - math.atan2(arriving[1], arriving[0]))
    return abs(180 - abs((angle + 180) % 360 - 180))


@dataclass
class GridIndex:
    edges: dict[int, Edge] = field(default_factory=dict)
    nodes: dict[int, Node] = field(default_factory=dict)
    at_node: dict[int, list[int]] = field(default_factory=dict)
    by_way: dict[int, list[int]] = field(default_factory=dict)
    version: tuple = ()

    def add(self, edge: Edge) -> None:
        self.edges[edge.edge_id] = edge
        self.at_node.setdefault(edge.source, []).append(edge.edge_id)
        self.at_node.setdefault(edge.target, []).append(edge.edge_id)
        self.by_way.setdefault(edge.way, []).append(edge.edge_id)

    def meeting(self, node: int, voltage: int) -> list[Edge]:
        return [self.edges[i] for i in self.at_node.get(node, []) if voltage in self.edges[i].voltages]


_index: GridIndex | None = None


async def grid_version(database: AsyncConnection) -> tuple:
    row = (await database.execute(text("SELECT count(*), max(edge_id) FROM grid_edge"))).one()
    return tuple(row)


async def load_index(database: AsyncConnection) -> GridIndex:
    """The network in memory, loaded again when the grid has been rebuilt."""
    global _index
    version = await grid_version(database)
    if _index is not None and _index.version == version:
        return _index
    index = GridIndex(version=version)
    rows = await database.execute(
        text(
            """SELECT edge_id, line_osm_id, source, target, voltage, voltage_tag, name, length_m,
                      ST_X(a) AS ax, ST_Y(a) AS ay, ST_X(b) AS bx, ST_Y(b) AS by,
                      ST_X(c) AS cx, ST_Y(c) AS cy, ST_X(d) AS dx, ST_Y(d) AS dy
                 FROM (SELECT *, ST_PointN(geom, 1) AS a, ST_PointN(geom, 2) AS b,
                              ST_PointN(geom, -1) AS c, ST_PointN(geom, -2) AS d
                         FROM grid_edge) AS e"""
        )
    )
    for r in rows:
        index.add(
            Edge(
                r.edge_id,
                r.line_osm_id,
                r.source,
                r.target,
                voltages_of(r.voltage_tag, r.voltage),
                r.name,
                r.length_m,
                (r.bx - r.ax, r.by - r.ay),
                (r.dx - r.cx, r.dy - r.cy),
            )
        )
    for r in await database.execute(text("SELECT node_id, kind, osm_id, name FROM grid_node")):
        index.nodes[r.node_id] = Node(r.kind, r.osm_id, r.name)
    _index = index
    return index


@dataclass
class Trace:
    voltage: int
    edges: set[int] = field(default_factory=set)
    # Ways only begun where the line splits unclearly: drawn as far as taken.
    stubs: set[int] = field(default_factory=set)
    stations: set[int] = field(default_factory=set)
    # Junctions where the trace stops at something other than a station, and why:
    # "open end" (the line ends at nothing), "unclear split", "other line".
    loose: dict[int, str] = field(default_factory=dict)
    complete: bool = True
    names: set[str] = field(default_factory=set)

    def ways(self, index: GridIndex) -> set[int]:
        return {index.edges[e].way for e in self.edges}


def _continuing(index: GridIndex, trace: Trace, node: int) -> tuple[list[Edge], bool, str]:
    """At a junction: the stretches continuing the line, whether to follow them
    further, and if none, why."""
    here = [e for e in index.meeting(node, trace.voltage) if e.edge_id not in trace.edges]
    arrived_edges = [index.edges[i] for i in index.at_node.get(node, []) if i in trace.edges]
    arrived = {e.way for e in arrived_edges}
    # Does the line's way end here (one stretch here), or pass through (two)?
    ends_here = any(sum(1 for e in arrived_edges if e.way == way) == 1 for way in arrived)
    by_way: dict[int, list[Edge]] = {}
    for e in here:
        by_way.setdefault(e.way, []).append(e)
    wanted = {ends for name in trace.names for ends in line_ends(name)}
    taken = [e for way, es in by_way.items() if way in arrived for e in es]
    taken += [
        e
        for way, es in by_way.items()
        if way not in arrived
        and es[0].name
        and (es[0].name in trace.names or same_line(line_ends(es[0].name), wanted))
        for e in es
    ]
    if taken:
        return taken, True, ""
    if not ends_here:
        # Passing a pylon it shares with other lines: nothing to take there.
        return [], True, ""
    if not by_way:
        return [], True, "open end"
    if all(len(es) == 2 for es in by_way.values()):
        # It ends on another line passing through (a tee): connected.
        return [], True, "tap"
    # A way passing through meets the junction twice (a stretch on each side); one
    # that starts or ends here, once.
    starting = [es[0] for es in by_way.values() if len(es) == 1]
    if trace.names:
        # A named line goes on into an unnamed way, not into another line's name,
        # unless that line goes to one of its places too (shared pylons into the
        # same substation).
        unnamed = [e for e in starting if not e.name or not line_ends(e.name)]
        sharing = [e for e in starting if e.name and shares_a_place(line_ends(e.name), wanted)]
        starting = unnamed or sharing
    if not starting:
        return [], True, "other line"
    if len(starting) == 1:
        return starting, True, ""
    named = {e.name for e in starting}
    if not trace.names and None not in named and len(named) == 1:
        # Clicked on an unnamed part, going on into ways all of one line.
        return starting, True, ""
    # Several start here: the straightest, if clearly so.
    if arrived_edges:
        arriving = arrived_edges[0].away_from(node)
        turns = sorted((turn(arriving, e.away_from(node)), i) for i, e in enumerate(starting))
        if turns[0][0] <= MAX_TURN and turns[1][0] - turns[0][0] >= CLEAR_MARGIN:
            return [starting[turns[0][1]]], True, ""
        straight = [starting[i] for t, i in turns if t <= MAX_TURN]
        if len(straight) == 2 and _goes_through(node, straight, PARALLEL_TURN, same_way=True):
            # A double line parting into its two circuits, side by side: both.
            return straight, True, ""
        if turns[0][0] > MAX_TURN and _goes_through(node, starting):
            # It ends beside another line passing through, cut into two ways there.
            return [], True, "tap"
    # Or all of them, if they all lead to the same station (a double line
    # splitting in two at the substation's gate).
    ways = [_whole_way(index, trace, first) for first in starting]
    ends = [_stations(index, way) for way in ways]
    if all(ends) and len(set().union(*ends)) == 1:
        return [e for way in ways for e in way], True, ""
    # Or the one leading to a station named after one of the line's places.
    places = {p for name in trace.names for pair, _ in line_ends(name) for p in pair}
    reached = " ".join(place(index.nodes[n].name or "") for n in trace.stations)
    places = {p for p in places if p not in reached}
    if places:
        for way, stations in zip(ways, ends):
            if any(any(p in place(index.nodes[n].name or "") for p in places) for n in stations):
                return way, True, ""
    return starting, False, "unclear split"


def _goes_through(node: int, edges: list[Edge], within: float = 0, same_way: bool = False) -> bool:
    """Whether two of these stretches leave the junction in a straight line (or, with
    `same_way`, side by side), give or take `within` degrees."""
    within = within or THROUGH_TURN
    return any(
        (
            180 - turn(a.away_from(node), b.away_from(node))
            if same_way
            else turn(a.away_from(node), b.away_from(node))
        )
        <= within
        for i, a in enumerate(edges)
        for b in edges[i + 1 :]
    )


def _whole_way(index: GridIndex, trace: Trace, first: Edge) -> list[Edge]:
    """Every stretch of a stretch's OSM way, at the line's voltage."""
    return [index.edges[i] for i in index.by_way[first.way] if trace.voltage in index.edges[i].voltages]


def _stations(index: GridIndex, way: list[Edge]) -> set[int]:
    """The stations a way touches."""
    return {n for e in way for n in (e.source, e.target) if index.nodes[n].kind != "junction"}


def trace_line(index: GridIndex, way: int, voltage: int | None = None) -> Trace | None:
    """Follow the line an OSM way is part of (at one of its voltages, by default
    its highest) to the stations at its ends. None if the way isn't in the network."""
    start = [index.edges[i] for i in index.by_way.get(way, [])]
    if not start:
        return None
    voltage = voltage or max(max(e.voltages) for e in start)
    start = [e for e in start if voltage in e.voltages]
    trace = Trace(voltage=voltage)
    trace.edges = {e.edge_id for e in start}
    trace.names = {e.name for e in start if e.name}
    frontier = {n for e in start for n in (e.source, e.target)}
    seen: set[int] = set()
    while frontier:
        if len(trace.edges) >= MAX_EDGES:
            trace.complete = False
            break
        next_frontier: set[int] = set()
        for node in frontier - seen:
            seen.add(node)
            if index.nodes[node].kind != "junction":
                trace.stations.add(node)
                continue
            taking, further, why = _continuing(index, trace, node)
            if not trace.names and any(e.name for e in taking):
                # Clicked on an unnamed part: the line's name is the one it goes on into.
                trace.names = {e.name for e in taking if e.name}
            if why:
                trace.loose[node] = why
            if not further:
                trace.stubs.update(e.way for e in taking)
            for e in taking:
                trace.edges.add(e.edge_id)
                ends = {e.source, e.target} - {node}
                if further:
                    next_frontier |= ends
                else:
                    # A stub: where it ends is only noted.
                    trace.stations |= {n for n in ends if index.nodes[n].kind != "junction"}
        frontier = next_frontier
    return trace
