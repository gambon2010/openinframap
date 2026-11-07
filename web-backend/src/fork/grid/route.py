"""
Fork: paths through the power grid between two stations (grid/__init__.py).

Uses the grid_node / grid_edge tables built by schema/grid.sql (lines of 10 kV
and more). Routes run over lines of 110 kV and more; a station only on a lower
voltage (e.g. a wind farm on a 65 kV line) gets an "access" leg to the nearest
station on that grid.

    GET /grid/route?from=substation/123&to=plant/456&paths=3
"""

import json
from typing import Any, Optional

import networkx as nx
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from ..line_trace import voltages_of

MAX_PATHS = 5
# Simple paths examined when looking for distinct ones: in a meshed grid there
# are far too many to list, and most differ by a detour of one line.
CANDIDATES = 200
# A path sharing more than this fraction of its length with an already chosen
# one is a near-duplicate (e.g. the same route with one hop on a parallel line).
MAX_OVERLAP = 0.7
# Routes run over lines of this voltage and more. A station that isn't on that
# grid is first connected to it over lower-voltage lines (an "access" leg) of at
# most ACCESS_MAX metres, searched within ACCESS_RADIUS metres. (Distances here are
# real metres; schema/distances.sql turns them into map units.)
BACKBONE_VOLTAGE = 110000
ACCESS_MAX = 50000
ACCESS_RADIUS = 40000
# A station with no line of known voltage at all may use the nearest station
# with one, this close (metres).
NEAREST_STATION = 5000
# A grid station closer than this (metres) is the same station mapped twice in
# OpenStreetMap (e.g. a substation's outline and its site relation): no notice.
SAME_STATION = 300
STATION_KINDS = ("substation", "plant")


def parse_station(value: Optional[str], param: str) -> tuple[str, int]:
    """'substation/123' -> ('substation', 123)."""
    try:
        kind, osm_id = (value or "").split("/")
        if kind not in STATION_KINDS:
            raise ValueError
        return kind, int(osm_id)
    except ValueError:
        raise HTTPException(400, f"'{param}' must look like substation/<osm_id> or plant/<osm_id>")


async def find_node(database: AsyncConnection, kind: str, osm_id: int) -> tuple[dict, Optional[str]]:
    """The grid node for a station, or the nearest station on the grid (with a notice)."""
    row = (
        await database.execute(
            text(
                """SELECT node_id, kind, osm_id, name, geom FROM grid_node
                    WHERE kind = :kind AND osm_id = :osm_id"""
            ),
            {"kind": kind, "osm_id": osm_id},
        )
    ).first()
    if row:
        return dict(row._mapping), None

    table = "substation" if kind == "substation" else "power_plant"
    station = (
        await database.execute(
            text(f"SELECT name, geometry FROM {table} WHERE osm_id = :osm_id LIMIT 1"), {"osm_id": osm_id}
        )
    ).first()
    if not station:
        raise HTTPException(404, f"{kind} {osm_id} isn't in the database")

    nearest = (
        await database.execute(
            text(
                """SELECT n.node_id, n.kind, n.osm_id, n.name, n.geom,
                          ST_Distance(ST_Transform(n.geom, 4326)::geography,
                                      ST_Transform(ST_PointOnSurface(s.geom), 4326)::geography) AS distance
                     FROM grid_node AS n, (SELECT CAST(:geom AS geometry) AS geom) AS s
                    WHERE n.kind <> 'junction'
                      AND ST_DWithin(n.geom, s.geom, :radius * oim_max_stretch())
                      AND ST_DWithin(n.geom, s.geom, oim_units(:radius, s.geom))
                    ORDER BY n.geom <-> s.geom
                    LIMIT 1"""
            ),
            {"geom": station._mapping["geometry"], "radius": NEAREST_STATION},
        )
    ).first()
    label = station._mapping["name"] or f"this {kind}"
    if not nearest:
        raise HTTPException(
            404, f"No power line of known voltage reaches {label}, and there's no station with one nearby."
        )
    node = dict(nearest._mapping)
    distance = node.pop("distance")
    if distance < SAME_STATION:
        return node, None
    notice = (
        f"No power line of known voltage reaches {label}; using the nearest station with one, "
        f"{node['name'] or 'an unnamed ' + node['kind']} ({distance / 1000:.1f} km away)."
    )
    return node, notice


EDGE_COLUMNS = """e.edge_id, e.line_osm_id, e.source, e.target, e.voltage, e.voltage_tag, e.name, e.length_m,
                  sa.kind <> 'junction' AS source_station, sb.kind <> 'junction' AS target_station,
                  ST_AsGeoJSON(ST_Transform(e.geom, 4326)) AS geometry"""


EDGE_FROM = """grid_edge AS e JOIN grid_node AS sa ON sa.node_id = e.source
                             JOIN grid_node AS sb ON sb.node_id = e.target"""


# A point of the route graph: a station (its node id), where every voltage meets
# (through its transformers); or a junction at one voltage, (node id, voltage): at
# a pylon only lines of the same voltage connect, and a way carrying several
# ("225000;63000") is one line per voltage.
Point = int | tuple[int, int]


def point(node: int, station: bool, voltage: int) -> Point:
    return node if station else (node, voltage)


def node_of(p: Point) -> int:
    return p if isinstance(p, int) else p[0]


def build_graph(rows: Any, edge_info: dict[int, dict], min_voltage: int = 0) -> "nx.Graph[Point]":
    """The route graph from edge rows, at each voltage of each way (min_voltage and
    more); parallel lines become one hop (shortest as weight). A hop's "circuits"
    are its (edge_id, voltage)."""
    graph: nx.Graph[Point] = nx.Graph()
    # In the edges' order, not the database's (which varies): parallel lines, and
    # so the route's pieces, come out the same each time.
    for row in sorted(rows, key=lambda r: r._mapping["edge_id"]):
        e = dict(row._mapping)
        edge_info[e["edge_id"]] = e
        for voltage in voltages_of(e.get("voltage_tag"), e["voltage"]):
            if voltage < min_voltage:
                continue
            u = point(e["source"], e.get("source_station", True), voltage)
            v = point(e["target"], e.get("target_station", True), voltage)
            if graph.has_edge(u, v):
                data = graph[u][v]
                data["circuits"].append((e["edge_id"], voltage))
                data["length"] = min(data["length"], e["length_m"])
            else:
                graph.add_edge(u, v, length=e["length_m"], circuits=[(e["edge_id"], voltage)])
    return graph


async def load_backbone(
    database: AsyncConnection, a: dict, b: dict, edge_info: dict[int, dict]
) -> "nx.Graph[Point]":
    """Lines of 110 kV and more around both ends."""
    rows = await database.execute(
        text(
            f"""SELECT {EDGE_COLUMNS}
                 FROM {EDGE_FROM}
                WHERE e.voltage >= :min_voltage
                  AND e.geom && ST_Expand(
                          ST_MakeLine(CAST(:a AS geometry), CAST(:b AS geometry)),
                          GREATEST(oim_units(65000, CAST(:a AS geometry)),
                                   ST_Distance(CAST(:a AS geometry), CAST(:b AS geometry)) / 2))"""
        ),
        {"a": a["geom"], "b": b["geom"], "min_voltage": BACKBONE_VOLTAGE},
    )
    return build_graph(rows, edge_info, BACKBONE_VOLTAGE)


async def access_leg(
    database: AsyncConnection, node: dict, backbone: "nx.Graph[Point]", edge_info: dict[int, dict]
) -> Optional[tuple[list[Point], "nx.Graph[Point]"]]:
    """Shortest path over lines of any voltage from a station that isn't on the
    ≥110 kV grid (e.g. a wind farm on a 65 kV line) to the nearest point that is,
    and the graph it's in. [node] if it's already on that grid, None if no such
    point is within reach."""
    if node["node_id"] in backbone:
        return [node["node_id"]], backbone
    rows = await database.execute(
        text(
            f"""SELECT {EDGE_COLUMNS}
                 FROM {EDGE_FROM}
                WHERE e.geom && ST_Expand(CAST(:geom AS geometry),
                                          oim_units(:radius, CAST(:geom AS geometry)))"""
        ),
        {"geom": node["geom"], "radius": ACCESS_RADIUS},
    )
    local = build_graph(rows, edge_info)
    if node["node_id"] not in local:
        return None
    lengths = nx.single_source_dijkstra_path_length(
        local, node["node_id"], cutoff=ACCESS_MAX, weight="length"
    )
    reachable = [n for n in lengths if n in backbone]
    if not reachable:
        return None
    entry = min(reachable, key=lambda n: lengths[n])
    return list(nx.dijkstra_path(local, node["node_id"], entry, weight="length")), local


async def node_names(database: AsyncConnection, node_ids: set[int]) -> dict[int, dict]:
    rows = await database.execute(
        text(
            """SELECT node_id, kind, osm_id, name FROM grid_node
                WHERE node_id = ANY(:ids) AND kind <> 'junction'"""
        ),
        {"ids": list(node_ids)},
    )
    return {row._mapping["node_id"]: dict(row._mapping) for row in rows}


def distinct_paths(graph: "nx.Graph[Point]", source: Point, target: Point, count: int) -> list[list[Point]]:
    """Up to `count` short paths that don't mostly overlap each other."""
    chosen: list[tuple[list[Point], dict[frozenset[Point], float]]] = []
    try:
        candidates = nx.shortest_simple_paths(graph, source, target, weight="length")
        for examined, path in enumerate(candidates):
            if examined >= CANDIDATES or len(chosen) >= count:
                break
            hops = {frozenset(pair): graph[pair[0]][pair[1]]["length"] for pair in zip(path, path[1:])}
            total = sum(hops.values())
            if all(
                sum(length for hop, length in hops.items() if hop in other) <= MAX_OVERLAP * total
                for _, other in chosen
            ):
                chosen.append((path, hops))
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        pass
    return [path for path, _ in chosen]


def station_summary(node: dict) -> dict[str, Any]:
    return {"kind": node["kind"], "osm_id": node["osm_id"], "name": node["name"]}


def describe(
    path: list[Point], graph: "nx.Graph[Point]", edge_info: dict[int, dict], names: dict[int, dict]
) -> dict[str, Any]:
    """Length, voltages, stations and geometry of a path (all parallel lines drawn)."""
    hops = list(zip(path, path[1:]))
    circuits = [graph[u][v]["circuits"] for u, v in hops]

    # Stretches between consecutive stations; junctions between lines are passed
    # through. "to" is None when the path ends at a junction (e.g. a line tap).
    segments: list[dict[str, Any]] = []
    start = names.get(node_of(path[0])) if path else None
    length = 0.0
    voltages: set[int] = set()
    for (u, v), parallel in zip(hops, circuits):
        length += graph[u][v]["length"]
        voltages.update(voltage // 1000 for _, voltage in parallel)
        node = node_of(v)
        if node in names or v == path[-1]:
            segments.append(
                {
                    "from": station_summary(start) if start else None,
                    "to": station_summary(names[node]) if node in names else None,
                    "length_km": round(length / 1000, 1),
                    "voltages_kv": sorted(voltages, reverse=True),
                }
            )
            start, length, voltages = names.get(node), 0.0, set()

    edges = list(dict.fromkeys(edge_id for parallel in circuits for edge_id, _ in parallel))
    return {
        "length_km": round(sum(graph[u][v]["length"] for u, v in hops) / 1000, 1),
        "voltages_kv": sorted(
            {voltage // 1000 for parallel in circuits for _, voltage in parallel}, reverse=True
        ),
        "stations": [station_summary(names[node_of(n)]) for n in path if node_of(n) in names],
        "segments": segments,
        "geometry": {
            "type": "MultiLineString",
            "coordinates": [json.loads(edge_info[e]["geometry"])["coordinates"] for e in edges],
        },
    }


async def route(request: Request) -> Response:
    database = get_db(request)
    if not (await database.execute(text("SELECT to_regclass('grid_edge') IS NOT NULL"))).scalar():
        raise HTTPException(
            503, "The grid network hasn't been built yet: rebuild the region with build-region.sh"
        )
    from_kind, from_id = parse_station(request.query_params.get("from"), "from")
    to_kind, to_id = parse_station(request.query_params.get("to"), "to")
    try:
        count = max(1, min(int(request.query_params.get("paths", "3")), MAX_PATHS))
    except ValueError:
        raise HTTPException(400, "Invalid number of paths")

    a, notice_a = await find_node(database, from_kind, from_id)
    b, notice_b = await find_node(database, to_kind, to_id)
    notices = [n for n in (notice_a, notice_b) if n]
    if a["node_id"] == b["node_id"]:
        raise HTTPException(400, "Both ends are the same station on the grid")

    edge_info: dict[int, dict] = {}
    backbone = await load_backbone(database, a, b, edge_info)
    legs: list[Optional[list[Point]]] = []
    leg_graphs: list[Optional["nx.Graph[Point]"]] = []
    for end, node in (("from", a), ("to", b)):
        found = await access_leg(database, node, backbone, edge_info)
        if found is None:
            notices.append(
                f"{node['name'] or 'This ' + node['kind']} isn't connected to the grid of 110 kV and "
                f"more within {ACCESS_MAX // 1000} km along lines of known voltage."
            )
        legs.append(found[0] if found else None)
        leg_graphs.append(found[1] if found else None)

    paths: list[list[Point]] = []
    # Both ends reach the ≥110 kV grid at the same point: the access legs are the whole connection.
    same_entry = bool(legs[0] and legs[1] and legs[0][-1] == legs[1][-1])
    if legs[0] and legs[1] and not same_entry:
        paths = distinct_paths(backbone, legs[0][-1], legs[1][-1], count)

    all_nodes = {node_of(n) for path in paths for n in path} | {
        node_of(n) for leg in legs if leg for n in leg
    }
    names = await node_names(database, all_nodes)
    access = []
    for end, leg, leg_graph in zip(("from", "to"), legs, leg_graphs):
        if leg and leg_graph is not None and len(leg) > 1:
            path = leg if end == "from" else list(reversed(leg))
            access.append({"end": end, **describe(path, leg_graph, edge_info, names)})
    results = [describe(path, backbone, edge_info, names) for path in paths]
    if not results and legs[0] and legs[1] and not same_entry:
        notices.append(
            "No connection found over lines of 110 kV or more. OpenStreetMap may be missing a line, "
            "or the stations aren't connected at this voltage within the built region."
        )
    return JSONResponse(
        {
            "from": station_summary(a),
            "to": station_summary(b),
            "notices": notices,
            "access": access,
            "paths": results,
        }
    )
