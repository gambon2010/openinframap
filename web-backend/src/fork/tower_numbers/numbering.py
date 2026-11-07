"""Fork: tower numbers (tower_numbers/__init__.py): the lines of the network, followed
(line_trace/), and how far along its line each stretch is."""

from __future__ import annotations

import heapq
import re
from dataclasses import dataclass

from ..line_trace import GridIndex, Trace, line_ends, place, trace_line


@dataclass
class Line:
    line_id: int
    voltage: int
    name: str | None
    start: str | None
    end: str | None
    # edge_id -> (metres from the start to its nearer end, whether it runs backwards)
    edges: dict[int, tuple[float, bool]]


def start_station(index: GridIndex, names: list[str], stations: set[int]) -> int | None:
    """Where to count from: the station named after the place the line's name starts
    with ("A - B": A), else after another of its places, else a substation (rather
    than a plant), the first by name."""
    if not stations:
        return None
    for name in names:
        first = name.split(";")[0]
        for ends, _ in line_ends(first):
            for p in sorted(ends, key=lambda p: place(first).find(p)):
                for s in sorted(stations):
                    if p in place(index.nodes[s].name or ""):
                        return s
    return min(
        stations,
        key=lambda s: (index.nodes[s].kind != "substation", index.nodes[s].name or "\uffff", s),
    )


def line_name(trace: Trace) -> str | None:
    """The line's name: of its ways' names, one for its voltage ("Liaison 225 kV"),
    not another line's on the same pylons ("Liaison 400 kV"); the shortest."""
    kv = re.compile(r"(\d+(?:[.,]\d+)?)\s*kv", re.IGNORECASE)

    def fits(name: str) -> bool:
        said = {float(v.replace(",", ".")) for v in kv.findall(name)}
        return not said or trace.voltage / 1000 in said

    names = sorted((n for n in trace.names if fits(n)), key=len)
    return names[0] if names else None


def number_line(index: GridIndex, trace: Trace, line_id: int) -> Line | None:
    """How far along the line each of its stretches is, from its start station (or
    from one of its ends if it reaches none)."""
    edges = [index.edges[i] for i in trace.edges if index.edges[i].way not in trace.stubs]
    if not edges:
        return None
    around: dict[int, list] = {}
    for e in edges:
        around.setdefault(e.source, []).append(e)
        around.setdefault(e.target, []).append(e)
    stations = {n for n in around if index.nodes[n].kind != "junction"}
    name = line_name(trace)
    start = start_station(index, [name] if name else [], stations)
    if start is None:
        ends = [n for n, es in around.items() if len(es) == 1]
        start = min(ends or around)
    # Shortest distance along the line from the start to each point.
    distance = {start: 0.0}
    queue = [(0.0, start)]
    while queue:
        d, node = heapq.heappop(queue)
        if d > distance[node]:
            continue
        for e in around[node]:
            other = e.other(node)
            if d + e.length_m < distance.get(other, float("inf")):
                distance[other] = d + e.length_m
                heapq.heappush(queue, (distance[other], other))
    along = {}
    for e in edges:
        a, b = distance.get(e.source), distance.get(e.target)
        if a is None or b is None:
            continue  # cut off from the start (shouldn't happen)
        along[e.edge_id] = (min(a, b), b < a)
    end = max(stations - {start}, key=lambda s: distance.get(s, -1), default=None)
    return Line(
        line_id,
        trace.voltage,
        name,
        index.nodes[start].name if start in stations else None,
        index.nodes[end].name if end is not None else None,
        along,
    )


def all_lines(index: GridIndex) -> list[Line]:
    """Every line of the network, once per voltage it's at. A line can be followed
    again from a way beside it (two ways side by side into a substation): the
    longest is kept, and one mostly on stretches already kept is left out."""
    found: list[Line] = []
    done: set[tuple[int, int]] = set()
    for way, edge_ids in sorted(index.by_way.items()):
        voltages = set().union(*(index.edges[i].voltages for i in edge_ids))
        for voltage in sorted(voltages, reverse=True):
            if (way, voltage) in done:
                continue
            trace = trace_line(index, way, voltage)
            if trace is None:
                continue
            done |= {
                (index.edges[i].way, voltage) for i in trace.edges if index.edges[i].way not in trace.stubs
            }
            done.add((way, voltage))
            line = number_line(index, trace, 0)
            if line:
                found.append(line)
    lines: list[Line] = []
    kept: set[tuple[int, int]] = set()
    for line in sorted(found, key=lambda x: -sum(index.edges[e].length_m for e in x.edges)):
        stretches = {(e, line.voltage) for e in line.edges}
        if len(stretches & kept) > len(stretches) / 2:
            continue
        kept |= stretches
        line.line_id = len(lines) + 1
        lines.append(line)
    return lines
