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


# At a junction: the stretches continuing the line, whether to follow them further,
# and if none, why ("" when nothing's wrong).
Decision = tuple[list[Edge], bool, str]


@dataclass
class Junction:
    """What _continuing's rules look at, at one junction of a trace."""

    index: GridIndex
    trace: Trace
    node: int
    # The stretches here not taken yet, and those the trace arrived by.
    here: list[Edge]
    arrived_edges: list[Edge]
    # Does the line's way end here (one stretch here), or pass through (two)?
    ends_here: bool
    # The stretches here by way; the places the line's names join.
    by_way: dict[int, list[Edge]]
    wanted: set
    # Filled in by the rules as they go: the ways starting here that could continue
    # the line, the whole of each, and the stations each touches.
    starting: list[Edge] = field(default_factory=list)
    ways: list[list[Edge]] = field(default_factory=list)
    ends: list[set[int]] = field(default_factory=list)


def _junction(index: GridIndex, trace: Trace, node: int) -> Junction:
    here = [e for e in index.meeting(node, trace.voltage) if e.edge_id not in trace.edges]
    arrived_edges = [index.edges[i] for i in index.at_node.get(node, []) if i in trace.edges]
    arrived = {e.way for e in arrived_edges}
    by_way: dict[int, list[Edge]] = {}
    for e in here:
        by_way.setdefault(e.way, []).append(e)
    return Junction(
        index,
        trace,
        node,
        here,
        arrived_edges,
        ends_here=any(sum(1 for e in arrived_edges if e.way == way) == 1 for way in arrived),
        by_way=by_way,
        wanted={ends for name in trace.names for ends in line_ends(name)},
    )


def _same_line(j: Junction) -> Decision | None:
    """The same OSM way going on, or a way with the same name (compared by places)."""
    arrived = {e.way for e in j.arrived_edges}
    taken = [e for way, es in j.by_way.items() if way in arrived for e in es]
    taken += [
        e
        for way, es in j.by_way.items()
        if way not in arrived
        and es[0].name
        and (es[0].name in j.trace.names or same_line(line_ends(es[0].name), j.wanted))
        for e in es
    ]
    return (taken, True, "") if taken else None


def _passing_through(j: Junction) -> Decision | None:
    """Passing a pylon it shares with other lines: nothing to take there."""
    return None if j.ends_here else ([], True, "")


def _open_end(j: Junction) -> Decision | None:
    """Nothing else here: the line ends at nothing."""
    return None if j.by_way else ([], True, "open end")


def _ends_on_a_line_through(j: Junction) -> Decision | None:
    """It ends on another line passing through (a tee): connected."""
    return ([], True, "tap") if all(len(es) == 2 for es in j.by_way.values()) else None


def _ways_starting(j: Junction) -> Decision | None:
    """The ways starting here (one passing through meets the junction twice, a
    stretch on each side). A named line goes on into an unnamed way, not into
    another line's name, unless that line goes to one of its places too (shared
    pylons into the same substation)."""
    starting = [es[0] for es in j.by_way.values() if len(es) == 1]
    if j.trace.names:
        unnamed = [e for e in starting if not e.name or not line_ends(e.name)]
        sharing = [e for e in starting if e.name and shares_a_place(line_ends(e.name), j.wanted)]
        starting = unnamed or sharing
    j.starting = starting
    return None if starting else ([], True, "other line")


def _only_one(j: Junction) -> Decision | None:
    return (j.starting, True, "") if len(j.starting) == 1 else None


def _all_of_one_line(j: Junction) -> Decision | None:
    """Clicked on an unnamed part, going on into ways all of one line."""
    named = {e.name for e in j.starting}
    if not j.trace.names and None not in named and len(named) == 1:
        return j.starting, True, ""
    return None


def _into_a_station_it_names(j: Junction) -> Decision | None:
    """A named line: the way leading to a station named after one of its places not
    reached yet (it goes into that substation, not past it)."""
    index, trace = j.index, j.trace
    j.ways = [_whole_way(index, trace, first) for first in j.starting]
    j.ends = [_stations(index, way) for way in j.ways]
    places = {p for name in trace.names for pair, _ in line_ends(name) for p in pair}
    reached = " ".join(place(index.nodes[n].name or "") for n in trace.stations)
    places = {p for p in places if p not in reached}
    into = [
        way
        for way, stations in zip(j.ways, j.ends)
        if any(any(p in place(index.nodes[n].name or "") for p in places) for n in stations)
    ]
    return (into[0], True, "") if len(into) == 1 else None


def _straightest(j: Junction) -> Decision | None:
    """Else the straightest, if clearly so. A way turning back alongside the line
    (the other circuit of a double line, going back) isn't it."""
    if not j.arrived_edges:
        return None
    node, starting, ways, ends = j.node, j.starting, j.ways, j.ends
    arriving = j.arrived_edges[0].away_from(node)
    turns = sorted((turn(arriving, e.away_from(node)), i) for i, e in enumerate(starting))
    if turns[0][0] <= BACK_TURN:
        turns = [(t, i) for t, i in turns if t <= BACK_TURN]
    if len(turns) == 1:
        return ways[turns[0][1]], True, ""
    if turns[0][0] <= MAX_TURN and turns[1][0] - turns[0][0] >= CLEAR_MARGIN:
        return [starting[turns[0][1]]], True, ""
    if all(ends) and len(set().union(*ends)) == 1:
        # All lead to the same station (a double line splitting at its gate): the
        # straightest.
        return ways[turns[0][1]], True, ""
    if turns[0][0] > MAX_TURN and _goes_through(node, starting):
        # It ends beside another line passing through, cut into two ways there.
        return [], True, "tap"
    if turns[0][0] <= MAX_TURN:
        # Side by side, nothing tells them apart: the straightest, a guess.
        return [starting[turns[0][1]]], True, "guessed split"
    return None


# What continues a line at a junction: the first rule that decides. A new rule is a
# function here, in its place.
RULES = [
    _same_line,
    _passing_through,
    _open_end,
    _ends_on_a_line_through,
    _ways_starting,
    _only_one,
    _all_of_one_line,
    _into_a_station_it_names,
    _straightest,
]


def _continuing(index: GridIndex, trace: Trace, node: int) -> Decision:
    """At a junction: the stretches continuing the line, whether to follow them
    further, and if none, why. None of the rules decides: the line splits in ways
    nothing tells apart; their first stretches are shown, not followed."""
    j = _junction(index, trace, node)
    for rule in RULES:
        decision = rule(j)
        if decision is not None:
            return decision
    return j.starting, False, "unclear split"


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
