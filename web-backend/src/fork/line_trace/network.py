"""Fork: following a line (line_trace/__init__.py): the network in memory: its
stretches (Edge) and points (Node), loaded once and again when the grid is rebuilt."""

from __future__ import annotations

from dataclasses import dataclass, field

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

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
