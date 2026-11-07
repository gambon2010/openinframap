"""Fork: following a line (line_trace/__init__.py) through junctions to the stations at
its ends: at each junction, what continues it (_continuing)."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from .names import line_ends, place, same_line, shares_a_place
from .network import Edge, GridIndex, Vector

# Several ways start where a line ends: the straightest one is its continuation if
# it turns less than this, and clearly less than the next one (degrees).
MAX_TURN = 45
CLEAR_MARGIN = 15
# A way leaving a junction this close to where the line came from (degrees, 180 =
# straight back) turns back alongside it.
BACK_TURN = 150
# Two ways leaving a junction this straight (degrees) are one line passing through.
THROUGH_TURN = 30
# Stretches followed before giving up (a corridor looping through junctions).
MAX_EDGES = 5000


def turn(arriving: Vector, leaving: Vector) -> float:
    """How much a line turns (degrees, 0 = straight on) going in along `arriving`
    (pointing away from the node) and out along `leaving`."""
    angle = math.degrees(math.atan2(leaving[1], leaving[0]) - math.atan2(arriving[1], arriving[0]))
    return abs(180 - abs((angle + 180) % 360 - 180))


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
    ways = [_whole_way(index, trace, first) for first in starting]
    ends = [_stations(index, way) for way in ways]
    # A named line: the way leading to a station named after one of its places not
    # reached yet (it goes into that substation, not past it).
    places = {p for name in trace.names for pair, _ in line_ends(name) for p in pair}
    reached = " ".join(place(index.nodes[n].name or "") for n in trace.stations)
    places = {p for p in places if p not in reached}
    into = [
        way
        for way, stations in zip(ways, ends)
        if any(any(p in place(index.nodes[n].name or "") for p in places) for n in stations)
    ]
    if len(into) == 1:
        return into[0], True, ""
    # Else the straightest, if clearly so. A way turning back alongside the line
    # (the other circuit of a double line, going back) isn't it.
    if arrived_edges:
        arriving = arrived_edges[0].away_from(node)
        turns = sorted((turn(arriving, e.away_from(node)), i) for i, e in enumerate(starting))
        if turns[0][0] <= BACK_TURN:
            turns = [(t, i) for t, i in turns if t <= BACK_TURN]
        if len(turns) == 1:
            return ways[turns[0][1]], True, ""
        if turns[0][0] <= MAX_TURN and turns[1][0] - turns[0][0] >= CLEAR_MARGIN:
            return [starting[turns[0][1]]], True, ""
        if all(ends) and len(set().union(*ends)) == 1:
            # All lead to the same station (a double line splitting at its gate):
            # the straightest.
            return ways[turns[0][1]], True, ""
        if turns[0][0] > MAX_TURN and _goes_through(node, starting):
            # It ends beside another line passing through, cut into two ways there.
            return [], True, "tap"
        if turns[0][0] <= MAX_TURN:
            # Side by side, nothing tells them apart: the straightest, a guess.
            return [starting[turns[0][1]]], True, "guessed split"
    return starting, False, "unclear split"


def _goes_through(node: int, edges: list[Edge]) -> bool:
    """Whether two of these stretches leave the junction in a straight line."""
    return any(
        turn(a.away_from(node), b.away_from(node)) <= THROUGH_TURN
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
    its highest) to the stations at its ends. None if the way isn't in the network.
    A way without a name takes the name of the line it goes on into, and the line
    is followed again knowing it."""
    trace = _trace(index, way, voltage, set())
    if trace and trace.names and not any(index.edges[i].name for i in index.by_way[way]):
        trace = _trace(index, way, trace.voltage, trace.names)
    return trace


def _trace(index: GridIndex, way: int, voltage: int | None, names: set[str]) -> Trace | None:
    start = [index.edges[i] for i in index.by_way.get(way, [])]
    if not start:
        return None
    voltage = voltage or max(max(e.voltages) for e in start)
    start = [e for e in start if voltage in e.voltages]
    trace = Trace(voltage=voltage)
    trace.edges = {e.edge_id for e in start}
    trace.names = {e.name for e in start if e.name} or set(names)
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
