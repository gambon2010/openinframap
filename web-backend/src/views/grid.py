"""
Fork (prototype): paths through the power grid between two stations.

Uses the grid_node / grid_edge tables built by schema/grid.sql, which only
contain lines of 110 kV and more.

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
# How far a station without its own ≥110 kV line may be from one that has
# (EPSG:3857 units, roughly 4-7 km in Europe).
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
            404, f"No line of 110 kV or more reaches {label}, and there's no station on that grid nearby."
        )
    node = dict(nearest._mapping)
    distance = node.pop("distance")
    if distance < SAME_STATION:
        return node, None
    notice = (
        f"No line of 110 kV or more reaches {label}; using the nearest station on that grid, "
        f"{node['name'] or 'an unnamed ' + node['kind']} ({distance / 1000:.1f} km away)."
    )
    return node, notice


async def load_graph(database: AsyncConnection, a: dict, b: dict) -> tuple["nx.Graph[int]", dict[int, dict]]:
    """The grid around both stations: a simple graph (shortest of parallel lines as weight)."""
    edges = await database.execute(
        text(
            """SELECT e.edge_id, e.source, e.target, e.voltage, e.name, e.length_m,
                      ST_AsGeoJSON(ST_Transform(e.geom, 4326)) AS geometry
                 FROM grid_edge AS e
                WHERE e.geom && ST_Expand(
                          ST_MakeLine(CAST(:a AS geometry), CAST(:b AS geometry)),
                          GREATEST(100000, ST_Distance(CAST(:a AS geometry), CAST(:b AS geometry)) / 2))"""
        ),
        {"a": a["geom"], "b": b["geom"]},
    )
    graph: nx.Graph[int] = nx.Graph()
    edge_info: dict[int, dict] = {}
    for row in edges:
        e = dict(row._mapping)
        edge_info[e["edge_id"]] = e
        u, v = e["source"], e["target"]
        if graph.has_edge(u, v):
            data = graph[u][v]
            data["edges"].append(e["edge_id"])
            data["length"] = min(data["length"], e["length_m"])
        else:
            graph.add_edge(u, v, length=e["length_m"], edges=[e["edge_id"]])
    return graph, edge_info


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

    graph, edge_info = await load_graph(database, a, b)
    paths = distinct_paths(graph, a["node_id"], b["node_id"], count)
    names = await node_names(database, {node for path in paths for node in path})

    results = []
    for path in paths:
        edge_ids = [edge for u, v in zip(path, path[1:]) for edge in graph[u][v]["edges"]]
        results.append(
            {
                "length_km": round(sum(graph[u][v]["length"] for u, v in zip(path, path[1:])) / 1000, 1),
                "voltages_kv": sorted({edge_info[e]["voltage"] // 1000 for e in edge_ids}, reverse=True),
                "stations": [station_summary(names[n]) for n in path if n in names],
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [json.loads(edge_info[e]["geometry"])["coordinates"] for e in edge_ids],
                },
            }
        )
    if not results:
        notices.append(
            "No connection found over lines of 110 kV or more. OpenStreetMap may be missing a line, "
            "or the stations aren't connected at this voltage within the built region."
        )
    return JSONResponse(
        {"from": station_summary(a), "to": station_summary(b), "notices": notices, "paths": results}
    )


routes = [Route("/grid/route", endpoint=route)]

__all__ = ["routes"]
