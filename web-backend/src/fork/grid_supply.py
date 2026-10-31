"""
Fork: power supply mode (docs/plans/feature-status.md, step 4): what the statuses of
map features mean for the supply of the grid.

    GET /grid/supply[?pessimistic=1]
    GET /grid/supply/unconnected      what no source reaches anyway (grey)

Power comes from plants of SOURCE_OUTPUT and more (or the substation they're in),
and from where lines leave the built region (they go on outside). What's lost: the
power lines, substations, plants and towers whose status is Destroyed or Damaged
(and Suspected damage, pessimistic). Then, over the grid network (schema/grid.sql;
voltages meet only at stations, as for routes):
- red: no supply, nothing reaches it from a source any more;
- orange: less power, reached only through lower voltages than before (a 225 kV
  substation now fed through 63 kV lines): the best path's lowest voltage dropped;
- green: as before.
What no source reaches even with nothing lost (lines OpenStreetMap doesn't connect,
often 20 kV) isn't coloured: that's missing data, not lost supply.
"""

from __future__ import annotations

import gzip
import heapq
import json
from collections import Counter
from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import Request, get_db
from .grid_check import REGION_EDGE, region_outline
from .line_trace import GridIndex, load_index

# Plants this big (W) are sources; smaller ones count as consumers' neighbours.
SOURCE_OUTPUT = 10e6
# A big plant's substation: within this distance (EPSG:3857 units).
PLANT_SUBSTATION = 1000
LOST = ("destroyed", "damaged")
LOST_PESSIMISTIC = (*LOST, "suspected_damage")
# A source's own "voltage" on its best path (higher than any line).
UNLIMITED = 10**9

# A point of the graph: a station (node id; every voltage meets there) or a
# junction at one voltage ((node id, voltage)), as in grid.py.
Point = int | tuple[int, int]


@dataclass
class SupplyGraph:
    version: tuple
    # point -> [(other point, edge id, voltage)]
    around: dict[Point, list[tuple[Point, int, int]]] = field(default_factory=dict)
    # edge id -> its (point, point) at each of its voltages
    ends: dict[int, list[tuple[Point, Point, int]]] = field(default_factory=dict)
    sources: set[Point] = field(default_factory=set)
    # Stations: node id -> highest voltage of their lines.
    station_voltage: dict[int, int] = field(default_factory=dict)
    # The best path's lowest voltage to each point with nothing lost.
    baseline: dict[Point, int] = field(default_factory=dict)


def point(index: GridIndex, node: int, voltage: int) -> Point:
    return node if index.nodes[node].kind != "junction" else (node, voltage)


def build(index: GridIndex) -> SupplyGraph:
    graph = SupplyGraph(version=index.version)
    for e in index.edges.values():
        for voltage in e.voltages:
            a, b = point(index, e.source, voltage), point(index, e.target, voltage)
            graph.around.setdefault(a, []).append((b, e.edge_id, voltage))
            graph.around.setdefault(b, []).append((a, e.edge_id, voltage))
            graph.ends.setdefault(e.edge_id, []).append((a, b, voltage))
            for node in (e.source, e.target):
                if index.nodes[node].kind != "junction":
                    graph.station_voltage[node] = max(graph.station_voltage.get(node, 0), voltage)
    return graph


def best_paths(
    graph: SupplyGraph, sources: set[Point], lost_edges: set[int], lost_points: set[Point]
) -> dict[Point, int]:
    """For each point reached from a source: the highest "lowest voltage" of the
    paths reaching it (the widest path)."""
    best: dict[Point, int] = {}
    queue: list[tuple[int, int, Point]] = []
    for n, p in enumerate(sources - lost_points):
        best[p] = UNLIMITED
        queue.append((-UNLIMITED, n, p))
    heapq.heapify(queue)
    counter = len(queue)
    while queue:
        width, _, p = heapq.heappop(queue)
        width = -width
        if width < best.get(p, -1):
            continue
        for other, edge, voltage in graph.around.get(p, ()):
            if edge in lost_edges or other in lost_points:
                continue
            through = min(width, voltage)
            if through > best.get(other, -1):
                best[other] = through
                counter += 1
                heapq.heappush(queue, (-through, counter, other))
    return best


def state(point_: Point, best: dict[Point, int], baseline: dict[Point, int]) -> str:
    """red, orange or green; "unknown" if no source reaches it even with nothing lost
    (lines OpenStreetMap doesn't connect to the grid, often 20 kV ones)."""
    if point_ not in baseline:
        return "unknown"
    if point_ not in best:
        return "red"
    return "orange" if best[point_] < baseline[point_] else "green"


_graph: SupplyGraph | None = None


async def load_graph(database: AsyncConnection) -> SupplyGraph:
    """The supply graph, its sources and its baseline, made again after a rebuild."""
    global _graph
    index = await load_index(database)
    if _graph is not None and _graph.version == index.version:
        return _graph
    graph = build(index)
    # Big plants, or the substation each is in (its lines meet there).
    rows = await database.execute(
        text(
            """SELECT p.osm_id AS plant,
                      (SELECT n.node_id FROM grid_node AS n
                        WHERE n.kind = 'substation' AND ST_DWithin(n.geom, p.geometry, :near)
                        ORDER BY n.geom <-> p.geometry LIMIT 1) AS substation
                 FROM power_plant AS p
                WHERE convert_power(p.output) >= :output"""
        ),
        {"output": SOURCE_OUTPUT, "near": PLANT_SUBSTATION},
    )
    plant_nodes = {n.osm_id: id_ for id_, n in index.nodes.items() if n.kind == "plant"}
    for plant, substation in rows:
        node = plant_nodes.get(plant, substation)
        if node is not None and node in graph.around:
            graph.sources.add(node)
    # Line ends at the edge of the region (or beyond it): power comes from outside.
    outline = await region_outline(database)
    if outline:
        ends = [
            n for n, edges in index.at_node.items() if len(edges) == 1 and index.nodes[n].kind == "junction"
        ]
        rows = await database.execute(
            text(
                # Metres from the edge: EPSG:3857 units scaled by the latitude (as
                # grid_check.py); only the line ends are measured.
                """WITH region AS (
                       SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:outline), 4326), 3857) AS g)
                   SELECT n.node_id FROM grid_node AS n, region AS r
                    WHERE n.node_id = ANY(:ids)
                      AND (NOT ST_Contains(r.g, n.geom)
                           OR ST_Distance(ST_Boundary(r.g), n.geom)
                              * cos(radians(ST_Y(ST_Transform(n.geom, 4326)))) < :edge)"""
            ),
            {"outline": outline, "ids": ends, "edge": REGION_EDGE},
        )
        for (node,) in rows:
            for e in index.at_node[node]:
                for voltage in index.edges[e].voltages:
                    graph.sources.add((node, voltage))
    graph.baseline = best_paths(graph, graph.sources, set(), set())
    _graph = graph
    return graph


async def lost_features(
    database: AsyncConnection, index: GridIndex, statuses: tuple[str, ...]
) -> tuple[set[int], set[int], int]:
    """The edges and station nodes lost to the statuses, and how many features."""
    if not (
        await database.execute(text("SELECT to_regclass('userdata.feature_status') IS NOT NULL"))
    ).scalar():
        return set(), set(), 0
    rows = (
        await database.execute(
            text("SELECT source, feature_id FROM userdata.feature_status WHERE status = ANY(:statuses)"),
            {"statuses": list(statuses)},
        )
    ).all()
    edges: set[int] = set()
    stations: set[int] = set()
    by_station = {(n.kind, n.osm_id): id_ for id_, n in index.nodes.items() if n.kind != "junction"}
    towers = []
    for source, feature_id in rows:
        if source == "osm_power_line":
            edges.update(index.by_way.get(feature_id, []))
        elif source in ("substation", "power_plant"):
            node = by_station.get(("substation" if source == "substation" else "plant", feature_id))
            if node is not None:
                stations.add(node)
        elif source == "osm_power_tower":
            towers.append(feature_id)
    if towers:
        # A tower down cuts the lines it carries.
        cut = await database.execute(
            text(
                """SELECT e.edge_id FROM osm_power_tower AS t
                     JOIN grid_edge AS e ON ST_DWithin(e.geom, t.geometry, 0.05)
                    WHERE t.osm_id = ANY(:ids)"""
            ),
            {"ids": towers},
        )
        edges.update(r[0] for r in cut)
    return edges, stations, len(rows)


WORSE = {"green": 0, "grey": 1, "orange": 2, "red": 3}


def worst(a: str | None, b: str) -> str:
    return b if a is None or WORSE[b] > WORSE[a] else a


async def circuit_states(
    database: AsyncConnection, by_way: dict[int, dict[int, str]]
) -> dict[str, dict[str, str]]:
    """{way: {voltage: state}} as the map draws ways: by circuit, in the tiles' order
    (line_voltages(): highest first, one per circuit; power_line_1/2/3): {"123":
    {"s1": "red", "s2": "green"}}. A way's circuits of the same voltage share it."""
    out: dict[str, dict[str, str]] = {}
    if not by_way:
        return out
    rows = await database.execute(
        text("SELECT osm_id, line_voltages(voltage, circuits) FROM osm_power_line WHERE osm_id = ANY(:ids)"),
        {"ids": list(by_way)},
    )
    for way, voltages_kv in rows:
        states = {
            f"s{i}": by_way[way][round(kv * 1000)]
            for i, kv in enumerate((voltages_kv or [])[:3], start=1)
            if round(kv * 1000) in by_way[way]
        }
        if states:
            out[str(way)] = states
    return out


def grid_key(graph: SupplyGraph) -> str:
    """Names the grid build (its edges' count and highest id)."""
    return "-".join(str(v) for v in graph.version)


def station_key(kind: str, osm_id: int) -> str:
    """As the tiles name a station: its layer ("power_substation", "power_plant")
    and id (the point layers, "…_point", have the same ids)."""
    return f"{'power_substation' if kind == 'substation' else 'power_plant'}:{osm_id}"


async def supply(request: Request) -> Response:
    """Which lines (by circuit) and stations aren't green: ids and states, for the map
    to colour its own layers (feature state); and counts.

        {"lost": 2, "counts": {"red": {"400": 2}, "orange": {...}},
         "lines": {"<way>": {"s1": "red"}}, "stations": {"power_substation:<id>": "red"},
         "features": {"power_line:<way>": "red", ...}}   (the worst, for My layers)
    """
    database = get_db(request)
    if not (await database.execute(text("SELECT to_regclass('grid_edge') IS NOT NULL"))).scalar():
        return JSONResponse({"error": "The grid network hasn't been built"}, status_code=503)
    index = await load_index(database)
    graph = await load_graph(database)
    pessimistic = request.query_params.get("pessimistic") == "1"
    lost_edges, lost_stations, lost_count = await lost_features(
        database, index, LOST_PESSIMISTIC if pessimistic else LOST
    )
    best = (
        best_paths(graph, graph.sources, lost_edges, set(lost_stations))
        if lost_edges or lost_stations
        else graph.baseline
    )

    stations: dict[int, str] = {}
    for node in graph.station_voltage:
        s_ = state(node, best, graph.baseline)
        if s_ != "unknown" and node in lost_stations:
            s_ = "red"
        if s_ in ("red", "orange"):
            stations[node] = s_
    # Each way at each of its voltages: the worst of its stretches.
    by_way: dict[int, dict[int, str]] = {}
    for edge_id, pairs in graph.ends.items():
        way = index.edges[edge_id].way
        for a, b, voltage in pairs:
            if a not in graph.baseline and b not in graph.baseline:
                continue  # not connected to a source even before (grey)
            if edge_id in lost_edges or (a not in best and b not in best):
                s_ = "red"
            elif min(best.get(a, 0), best.get(b, 0)) < min(
                graph.baseline.get(a, 0), graph.baseline.get(b, 0)
            ):
                s_ = "orange"
            else:
                s_ = "green"
            circuits = by_way.setdefault(way, {})
            circuits[voltage] = worst(circuits.get(voltage), s_)
    not_green = {
        way: {v: s_ for v, s_ in circuits.items() if s_ != "green"}
        for way, circuits in by_way.items()
        if any(s_ != "green" for s_ in circuits.values())
    }

    counts: dict[str, Counter[int]] = {"red": Counter(), "orange": Counter()}
    for node, s_ in stations.items():
        counts[s_][graph.station_voltage[node] // 1000] += 1
    station_states = {
        station_key(index.nodes[n].kind, index.nodes[n].osm_id or 0): s_ for n, s_ in stations.items()
    }
    features: dict[str, str] = dict(station_states)
    for way, circuits in not_green.items():
        for s_ in circuits.values():
            features[f"power_line:{way}"] = worst(features.get(f"power_line:{way}"), s_)
    return JSONResponse(
        {
            # The grid build: GET /grid/supply/unconnected?grid=<this> (a new address
            # per build, so a browser never uses a copy cached from another one).
            "grid": grid_key(graph),
            "lost": lost_count,
            "pessimistic": pessimistic,
            "counts": {
                k: {str(kv): n for kv, n in sorted(c.items(), reverse=True)} for k, c in counts.items()
            },
            "lines": await circuit_states(database, not_green),
            "stations": station_states,
            "features": features,
        }
    )


# What no source reaches even with nothing lost, as gzipped JSON, per grid version.
_unconnected: tuple[tuple, bytes] | None = None


async def unconnected(request: Request) -> Response:
    """The lines (by circuit) and stations no source reaches even with nothing lost
    (missing in OpenStreetMap, often 20 kV), grey in power supply mode: ids only, as
    GET /grid/supply. The same until the grid is rebuilt: made once, gzipped.

        GET /grid/supply/unconnected?grid=<build>   {"lines": {...}, "stations": {...}}

    Cached by the browser for a day: its address changes with the grid build.
    """
    global _unconnected
    database = get_db(request)
    index = await load_index(database)
    graph = await load_graph(database)
    if _unconnected is None or _unconnected[0] != graph.version:
        # A way's circuit is grey if none of its stretches is reached.
        reached: dict[int, dict[int, bool]] = {}
        for edge_id, pairs in graph.ends.items():
            circuits = reached.setdefault(index.edges[edge_id].way, {})
            for a, b, voltage in pairs:
                circuits[voltage] = circuits.get(voltage, False) or a in graph.baseline or b in graph.baseline
        grey = {
            way: {v: "grey" for v, ok in circuits.items() if not ok}
            for way, circuits in reached.items()
            if not all(circuits.values())
        }
        body = {
            "lines": await circuit_states(database, grey),
            "stations": {
                station_key(index.nodes[n].kind, index.nodes[n].osm_id or 0): "grey"
                for n in graph.station_voltage
                if n not in graph.baseline
            },
        }
        _unconnected = (graph.version, gzip.compress(json.dumps(body).encode(), compresslevel=6))
    return Response(
        _unconnected[1],
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Cache-Control": "max-age=86400"},
    )


routes = [
    Route("/grid/supply", endpoint=supply),
    Route("/grid/supply/unconnected", endpoint=unconnected),
]
