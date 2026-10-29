"""
Fork (prototype): paths through the power grid between two stations.

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
from starlette.routing import Route

from .. import Request, get_db

MAX_PATHS = 5
# Simple paths examined when looking for distinct ones: in a meshed grid there
# are far too many to list, and most differ by a detour of one line.
CANDIDATES = 200
# A path sharing more than this fraction of its length with an already chosen
# one is a near-duplicate (e.g. the same route with one hop on a parallel line).
MAX_OVERLAP = 0.7
# Routes run over lines of this voltage and more. A station that isn't on that
# grid is first connected to it over lower-voltage lines (an "access" leg) of at
# most ACCESS_MAX metres, searched within ACCESS_RADIUS (EPSG:3857 units).
BACKBONE_VOLTAGE = 110000
ACCESS_MAX = 50000
ACCESS_RADIUS = 60000
# A station with no line of known voltage at all may use the nearest station
# with one, this close (EPSG:3857 units, roughly 4-7 km in Europe).
NEAREST_STATION = 7500
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
                    WHERE n.kind <> 'junction' AND ST_DWithin(n.geom, s.geom, :radius)
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


EDGE_COLUMNS = """e.edge_id, e.source, e.target, e.voltage, e.name, e.length_m,
                  ST_AsGeoJSON(ST_Transform(e.geom, 4326)) AS geometry"""


def build_graph(rows: Any, edge_info: dict[int, dict]) -> "nx.Graph[int]":
    """A simple graph from edge rows; parallel lines become one hop (shortest as weight)."""
    graph: nx.Graph[int] = nx.Graph()
    for row in rows:
        e = dict(row._mapping)
        edge_info[e["edge_id"]] = e
        u, v = e["source"], e["target"]
        if graph.has_edge(u, v):
            data = graph[u][v]
            data["edges"].append(e["edge_id"])
            data["length"] = min(data["length"], e["length_m"])
        else:
            graph.add_edge(u, v, length=e["length_m"], edges=[e["edge_id"]])
    return graph


async def load_backbone(
    database: AsyncConnection, a: dict, b: dict, edge_info: dict[int, dict]
) -> "nx.Graph[int]":
    """Lines of 110 kV and more around both ends."""
    rows = await database.execute(
        text(
            f"""SELECT {EDGE_COLUMNS}
                 FROM grid_edge AS e
                WHERE e.voltage >= :min_voltage
                  AND e.geom && ST_Expand(
                          ST_MakeLine(CAST(:a AS geometry), CAST(:b AS geometry)),
                          GREATEST(100000, ST_Distance(CAST(:a AS geometry), CAST(:b AS geometry)) / 2))"""
        ),
        {"a": a["geom"], "b": b["geom"], "min_voltage": BACKBONE_VOLTAGE},
    )
    return build_graph(rows, edge_info)


async def access_leg(
    database: AsyncConnection, node: dict, backbone: "nx.Graph[int]", edge_info: dict[int, dict]
) -> Optional[list[int]]:
    """Shortest path over lines of any voltage from a station that isn't on the
    ≥110 kV grid (e.g. a wind farm on a 65 kV line) to the nearest node that is.
    [node] if it's already on that grid, None if no such node is within reach."""
    if node["node_id"] in backbone:
        return [node["node_id"]]
    rows = await database.execute(
        text(
            f"""SELECT {EDGE_COLUMNS}
                 FROM grid_edge AS e
                WHERE e.geom && ST_Expand(CAST(:geom AS geometry), :radius)"""
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
    return list(nx.dijkstra_path(local, node["node_id"], entry, weight="length"))


async def node_names(database: AsyncConnection, node_ids: set[int]) -> dict[int, dict]:
    rows = await database.execute(
        text(
            """SELECT node_id, kind, osm_id, name FROM grid_node
                WHERE node_id = ANY(:ids) AND kind <> 'junction'"""
        ),
        {"ids": list(node_ids)},
    )
    return {row._mapping["node_id"]: dict(row._mapping) for row in rows}


def distinct_paths(graph: "nx.Graph[int]", source: int, target: int, count: int) -> list[list[int]]:
    """Up to `count` short paths that don't mostly overlap each other."""
    chosen: list[tuple[list[int], dict[frozenset[int], float]]] = []
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


def describe(path: list[int], edge_info: dict[int, dict], names: dict[int, dict]) -> dict[str, Any]:
    """Length, voltages, stations and geometry of a node path (all parallel lines drawn)."""
    hops = list(zip(path, path[1:]))
    by_pair: dict[frozenset[int], list[dict]] = {}
    for e in edge_info.values():
        by_pair.setdefault(frozenset((e["source"], e["target"])), []).append(e)
    edges = [e for u, v in hops for e in by_pair.get(frozenset((u, v)), [])]

    # Stretches between consecutive stations; junctions between lines are passed
    # through. "to" is None when the path ends at a junction (e.g. a line tap).
    segments: list[dict[str, Any]] = []
    start = names.get(path[0]) if path else None
    length = 0.0
    voltages: set[int] = set()
    for u, v in hops:
        parallel = by_pair[frozenset((u, v))]
        length += min(e["length_m"] for e in parallel)
        voltages.update(e["voltage"] // 1000 for e in parallel)
        if v in names or v == path[-1]:
            segments.append(
                {
                    "from": station_summary(start) if start else None,
                    "to": station_summary(names[v]) if v in names else None,
                    "length_km": round(length / 1000, 1),
                    "voltages_kv": sorted(voltages, reverse=True),
                }
            )
            start, length, voltages = names.get(v), 0.0, set()

    return {
        "length_km": round(
            sum(min(e["length_m"] for e in by_pair[frozenset((u, v))]) for u, v in hops) / 1000, 1
        ),
        "voltages_kv": sorted({e["voltage"] // 1000 for e in edges}, reverse=True),
        "stations": [station_summary(names[n]) for n in path if n in names],
        "segments": segments,
        "geometry": {
            "type": "MultiLineString",
            "coordinates": [json.loads(e["geometry"])["coordinates"] for e in edges],
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
    legs = []
    for end, node in (("from", a), ("to", b)):
        leg = await access_leg(database, node, backbone, edge_info)
        if leg is None:
            notices.append(
                f"{node['name'] or 'This ' + node['kind']} isn't connected to the grid of 110 kV and "
                f"more within {ACCESS_MAX // 1000} km along lines of known voltage."
            )
        legs.append(leg)

    paths: list[list[int]] = []
    # Both ends reach the ≥110 kV grid at the same station: the access legs are the whole connection.
    same_entry = bool(legs[0] and legs[1] and legs[0][-1] == legs[1][-1])
    if legs[0] and legs[1] and not same_entry:
        paths = distinct_paths(backbone, legs[0][-1], legs[1][-1], count)

    all_nodes = {n for path in paths for n in path} | {n for leg in legs if leg for n in leg}
    names = await node_names(database, all_nodes)
    access = []
    for end, leg in zip(("from", "to"), legs):
        if leg and len(leg) > 1:
            path = leg if end == "from" else list(reversed(leg))
            access.append({"end": end, **describe(path, edge_info, names)})
    results = [describe(path, edge_info, names) for path in paths]
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


# Stretches of line followed from a clicked line before giving up (a very long
# corridor without substations, or a data error looping through junctions).
MAX_LINE_EDGES = 2000


async def line(request: Request) -> Response:
    """Where a power line goes: the clicked line plus every connected stretch of
    the same voltage, through junctions, up to the stations at its ends.

        GET /grid/line/<osm_id>
    """
    database = get_db(request)
    try:
        osm_id = int(request.path_params["osm_id"])
    except ValueError:
        raise HTTPException(400, "Invalid line id")

    has_grid = (await database.execute(text("SELECT to_regclass('grid_edge') IS NOT NULL"))).scalar()
    edges: dict[int, dict] = {}
    if has_grid:
        start = await database.execute(
            text(f"SELECT {EDGE_COLUMNS} FROM grid_edge AS e WHERE e.line_osm_id = :osm_id"),
            {"osm_id": osm_id},
        )
        edges = {row._mapping["edge_id"]: dict(row._mapping) for row in start}

    if not edges:
        # Not in the network (no known voltage, or below 10 kV): just the line itself.
        rows = await database.execute(
            text(
                """SELECT ST_AsGeoJSON(ST_Transform(geometry, 4326)) AS geometry,
                          ST_Length(ST_Transform(geometry, 4326)::geography) AS length_m
                     FROM osm_power_line WHERE osm_id = :osm_id"""
            ),
            {"osm_id": osm_id},
        )
        found = [dict(r._mapping) for r in rows]
        if not found:
            raise HTTPException(404, "Line not found")
        return JSONResponse(
            {
                "stations": [],
                "length_km": round(sum(r["length_m"] for r in found) / 1000, 1),
                "voltages_kv": [],
                "complete": True,
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [json.loads(r["geometry"])["coordinates"] for r in found],
                },
            }
        )

    voltage = max(e["voltage"] for e in edges.values())
    nodes = await database.execute(
        text("SELECT node_id, kind, osm_id, name FROM grid_node WHERE node_id = ANY(:ids)"),
        {"ids": list({n for e in edges.values() for n in (e["source"], e["target"])})},
    )
    node_info = {r._mapping["node_id"]: dict(r._mapping) for r in nodes}
    # Follow the line through junctions (pylons shared with other lines, branch
    # points) but not through stations.
    frontier = [n for n, info in node_info.items() if info["kind"] == "junction"]
    seen = set(frontier)
    complete = True
    while frontier:
        if len(edges) >= MAX_LINE_EDGES:
            complete = False
            break
        rows = await database.execute(
            text(
                f"""SELECT {EDGE_COLUMNS} FROM grid_edge AS e
                     WHERE (e.source = ANY(:ids) OR e.target = ANY(:ids)) AND e.voltage = :voltage"""
            ),
            {"ids": frontier, "voltage": voltage},
        )
        new_nodes: set[int] = set()
        for row in rows:
            e = dict(row._mapping)
            if e["edge_id"] not in edges:
                edges[e["edge_id"]] = e
                new_nodes.update((e["source"], e["target"]))
        new_nodes -= seen
        if not new_nodes:
            break
        found_nodes = await database.execute(
            text("SELECT node_id, kind, osm_id, name FROM grid_node WHERE node_id = ANY(:ids)"),
            {"ids": list(new_nodes)},
        )
        for r in found_nodes:
            node_info[r._mapping["node_id"]] = dict(r._mapping)
        seen |= new_nodes
        frontier = [n for n in new_nodes if node_info[n]["kind"] == "junction"]

    stations = [station_summary(info) for info in node_info.values() if info["kind"] != "junction"]
    # Parallel circuits between the same two points count once in the length.
    by_pair: dict[frozenset[int], float] = {}
    for e in edges.values():
        pair = frozenset((e["source"], e["target"]))
        by_pair[pair] = min(by_pair.get(pair, e["length_m"]), e["length_m"])
    return JSONResponse(
        {
            "stations": sorted(stations, key=lambda s: s["name"] or ""),
            "length_km": round(sum(by_pair.values()) / 1000, 1),
            "voltages_kv": [voltage // 1000],
            "complete": complete,
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [json.loads(e["geometry"])["coordinates"] for e in edges.values()],
            },
        }
    )


routes = [Route("/grid/route", endpoint=route), Route("/grid/line/{osm_id}", endpoint=line)]

__all__ = ["routes"]
