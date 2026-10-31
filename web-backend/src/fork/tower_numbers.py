"""
Fork: number the towers (pylons) along each power line, for those without a ref:
"tower 23 of 61, Graffenstaden - Marlenheim, from Graffenstaden". Shown in a
tower's details (GET /grid/tower/<osm_id>, grid.py), as its label from zoom 16
(tegola/layers.fork.yml) and found by the search ("23 marlenheim", search.py).

Every line of the grid network (schema/grid.sql) is followed (line_trace.py) from
one of its stations, A: the one its name starts with, else the first by name. Its
towers are numbered by how far along the line they are. A tower on several lines
(shared pylons) has a number on each.

Run after the grid is built (scripts/build-region.sh, import-db.sh):

    uv run python -m src.fork.tower_numbers

Writes tower_line (one row per line), tower_line_edge (where each stretch of the
network is along its line) and tower_number (schema/tower-numbers.sql makes them
empty first, as Tegola serves tower_number). Uses DATABASE_URL, else the local
database.
"""

from __future__ import annotations

import asyncio
import heapq
import os
import re
import time
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from .line_trace import GridIndex, Trace, line_ends, load_index, place, trace_line

DEFAULT_URL = "postgresql+asyncpg://osm:osm@localhost:5432/osm"


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


async def write(database: AsyncConnection, lines: list[Line]) -> None:
    await database.execute(text("DROP TABLE IF EXISTS tower_number, tower_line_edge, tower_line"))
    await database.execute(
        text(
            """CREATE TABLE tower_line (line_id integer PRIMARY KEY, voltage integer,
                                        name text, start_name text, end_name text)"""
        )
    )
    await database.execute(
        text(
            """CREATE TABLE tower_line_edge (line_id integer, edge_id integer,
                                             start_m double precision, backwards boolean)"""
        )
    )
    raw = (await database.get_raw_connection()).driver_connection
    assert raw is not None
    await raw.copy_records_to_table(
        "tower_line", records=[(x.line_id, x.voltage, x.name, x.start, x.end) for x in lines]
    )
    await raw.copy_records_to_table(
        "tower_line_edge",
        records=[(x.line_id, e, m, back) for x in lines for e, (m, back) in x.edges.items()],
    )
    # What the search matches ("23 marlenheim"): the line's name and stations, plain.
    await database.execute(text("ALTER TABLE tower_line ADD COLUMN search text"))
    await database.execute(
        text("UPDATE tower_line SET search = lower(unaccent(concat_ws(' ', name, start_name, end_name)))")
    )
    await database.execute(text("CREATE INDEX ON tower_line_edge (edge_id)"))
    await database.execute(text("ANALYZE tower_line_edge"))
    # Each tower on a stretch of a line: how far along the line it is, then its
    # number. The towers are points of the lines' ways (within a few cm).
    await database.execute(
        text(
            """CREATE TABLE tower_number AS
               WITH along AS (
                   SELECT DISTINCT ON (t.osm_id, le.line_id)
                          t.osm_id, le.line_id, t.geometry, t.tags ? 'ref' AS has_ref,
                          le.start_m + e.length_m * CASE WHEN le.backwards THEN 1 - f.f ELSE f.f END AS at_m
                     FROM osm_power_tower AS t
                     JOIN grid_edge AS e ON ST_DWithin(e.geom, t.geometry, 0.05)
                     JOIN tower_line_edge AS le ON le.edge_id = e.edge_id
                    CROSS JOIN LATERAL (SELECT ST_LineLocatePoint(e.geom, t.geometry) AS f) AS f
                    WHERE GeometryType(t.geometry) = 'POINT'
                    ORDER BY t.osm_id, le.line_id, at_m)
               , numbered AS (
                   SELECT a.osm_id, a.line_id, l.voltage, a.geometry, a.has_ref,
                          row_number() OVER (PARTITION BY a.line_id
                                             ORDER BY a.at_m, a.osm_id)::integer AS number,
                          count(*) OVER (PARTITION BY a.line_id)::integer AS total
                     FROM along AS a JOIN tower_line AS l USING (line_id))
               -- A line can be followed twice, from two ways side by side near a
               -- substation: a tower keeps one number per voltage, on the longest.
               , kept AS (
                   SELECT DISTINCT ON (osm_id, voltage) *
                     FROM numbered
                    ORDER BY osm_id, voltage, total DESC, line_id)
               -- On the map (from zoom 16), a tower without a ref shows its number on
               -- its highest voltage line.
               SELECT osm_id, line_id, voltage, number, total,
                      geometry::geometry(Point, 3857) AS geometry,
                      NOT has_ref AND row_number() OVER (PARTITION BY osm_id
                                                         ORDER BY voltage DESC, total DESC) = 1 AS label
                 FROM kept"""
        )
    )
    await database.execute(text("CREATE INDEX ON tower_number (osm_id)"))
    await database.execute(text("CREATE INDEX ON tower_number (number)"))
    await database.execute(text("CREATE INDEX ON tower_number USING gist (geometry) WHERE label"))
    await database.execute(text("ANALYZE tower_number"))


async def main() -> None:
    engine = create_async_engine(os.environ.get("DATABASE_URL", DEFAULT_URL))
    began = time.monotonic()
    async with engine.begin() as database:
        index = await load_index(database)
        lines = all_lines(index)
        print(f"{len(lines):,} lines followed in {time.monotonic() - began:.0f} s.")
        await write(database, lines)
        count = (await database.execute(text("SELECT count(*) FROM tower_number"))).scalar()
    await engine.dispose()
    print(f"{count:,} towers numbered in {time.monotonic() - began:.0f} s.")


if __name__ == "__main__":
    asyncio.run(main())
