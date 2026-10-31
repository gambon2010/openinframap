"""Fork: routes between stations (src/fork/grid.py), without a database."""

import json
from types import SimpleNamespace

import pytest
from starlette.exceptions import HTTPException

from src.fork import grid
from src.fork.grid import build_graph, describe, distinct_paths, parse_station


def edge(edge_id, source, target, length_m, voltage=220000, name=None):
    line = [[source, 0], [target, 0]]
    return {
        "edge_id": edge_id,
        "source": source,
        "target": target,
        "voltage": voltage,
        "name": name,
        "length_m": length_m,
        "geometry": json.dumps({"type": "LineString", "coordinates": line}),
    }


def rows(*edges):
    return [SimpleNamespace(_mapping=e) for e in edges]


def test_parse_station():
    assert parse_station("substation/123", "from") == ("substation", 123)
    assert parse_station("plant/-45", "to") == ("plant", -45)
    for bad in (None, "", "substation", "tower/1", "plant/abc", "plant/1/2"):
        with pytest.raises(HTTPException) as e:
            parse_station(bad, "from")
        assert e.value.status_code == 400


def test_parallel_lines_are_one_hop_with_the_shortest_length():
    info: dict = {}
    graph = build_graph(rows(edge(1, 1, 2, 1000), edge(2, 1, 2, 900), edge(3, 2, 3, 500)), info)
    assert graph[1][2]["length"] == 900
    assert graph[1][2]["edges"] == [1, 2]
    assert set(info) == {1, 2, 3}


def test_distinct_paths_skip_near_duplicates():
    # 1 -> 4 directly via 2 (short), a near-copy via 5 that shares the long hop,
    # and a separate route via 3.
    info: dict = {}
    graph = build_graph(
        rows(
            edge(1, 1, 2, 10_000),
            edge(2, 2, 4, 1_000),
            edge(3, 1, 3, 12_000),
            edge(4, 3, 4, 2_000),
            edge(5, 2, 5, 600),
            edge(6, 5, 4, 600),
        ),
        info,
    )
    paths = distinct_paths(graph, 1, 4, 3)
    assert paths[0] == [1, 2, 4]
    assert [1, 2, 5, 4] not in paths  # shares 10 of its 11.2 km with the first
    assert [1, 3, 4] in paths


def test_no_path():
    info: dict = {}
    graph = build_graph(rows(edge(1, 1, 2, 1000), edge(2, 3, 4, 1000)), info)
    assert distinct_paths(graph, 1, 4, 3) == []
    assert distinct_paths(graph, 1, 99, 3) == []


def test_describe_splits_at_stations_and_passes_junctions():
    info = {e["edge_id"]: e for e in (edge(1, 1, 2, 4000), edge(2, 2, 3, 6000, 380000), edge(3, 2, 3, 6500))}
    names = {
        1: {"kind": "substation", "osm_id": 10, "name": "A"},
        3: {"kind": "plant", "osm_id": 30, "name": "C"},
    }  # node 2 is a junction between lines
    out = describe([1, 2, 3], info, names)
    assert out["length_km"] == 10.0
    assert out["voltages_kv"] == [380, 220]
    assert [s["name"] for s in out["stations"]] == ["A", "C"]
    assert out["segments"] == [
        {
            "from": {"kind": "substation", "osm_id": 10, "name": "A"},
            "to": {"kind": "plant", "osm_id": 30, "name": "C"},
            "length_km": 10.0,
            "voltages_kv": [380, 220],
        }
    ]
    # Both parallel lines between 2 and 3 are drawn.
    assert len(out["geometry"]["coordinates"]) == 3


def test_describe_ending_at_a_junction():
    info = {1: edge(1, 1, 2, 2500)}
    out = describe([1, 2], info, {1: {"kind": "substation", "osm_id": 1, "name": "A"}})
    assert out["segments"][0]["to"] is None
    assert out["segments"][0]["length_km"] == 2.5


def _edge(edge_id, way, source, target, name=None):
    return {"edge_id": edge_id, "line_osm_id": way, "source": source, "target": target, "name": name}


def test_a_line_continues_along_its_own_way():
    taken = {1: _edge(1, 100, 0, 5)}
    candidates = [_edge(2, 100, 5, 6), _edge(3, 200, 5, 7), _edge(4, 200, 8, 5)]
    # Way 200 passes through the same pylon (a line on shared pylons): left out.
    assert [e["edge_id"] for e in grid.continuing_edges(5, taken, candidates, set())[0]] == [2]


def test_a_named_line_keeps_to_its_name():
    taken = {1: _edge(1, 100, 0, 5, "Batzendorf - Marlenheim")}
    candidates = [
        _edge(2, 300, 5, 6, "Batzendorf - Marlenheim"),
        _edge(3, 400, 5, 7, "Batzendorf - Reichstett"),
    ]
    names = {"Batzendorf - Marlenheim"}
    assert [e["edge_id"] for e in grid.continuing_edges(5, taken, candidates, names)[0]] == [2]


def test_an_unnamed_line_continues_into_the_way_starting_where_it_ends():
    taken = {1: _edge(1, 100, 0, 5)}
    assert [e["edge_id"] for e in grid.continuing_edges(5, taken, [_edge(2, 300, 5, 6)], set())[0]] == [2]


def test_a_branch_stops_the_line():
    taken = {1: _edge(1, 100, 0, 5)}
    # Two ways start here, which one continues the line can't be told: both are
    # shown, neither followed.
    both, further = grid.continuing_edges(5, taken, [_edge(2, 300, 5, 6), _edge(3, 400, 5, 7)], set())
    assert [e["edge_id"] for e in both] == [2, 3] and not further
    # A differently named line starting here is another line.
    named = {1: _edge(1, 100, 0, 5, "A - B")}
    assert grid.continuing_edges(5, named, [_edge(2, 300, 5, 6, "C - D")], {"A - B"})[0] == []


def test_a_named_line_goes_on_unnamed_beside_another_line():
    # Graffenstaden - Marlenheim: its named way ends at a pylon where it goes on
    # unnamed, and where Graffenstaden - Reichstett starts too.
    taken = {1: _edge(1, 100, 0, 5, "Graffenstaden - Marlenheim")}
    candidates = [_edge(2, 300, 5, 6), _edge(3, 400, 5, 7, "Graffenstaden - Reichstett")]
    continuing, further = grid.continuing_edges(5, taken, candidates, {"Graffenstaden - Marlenheim"})
    assert [e["edge_id"] for e in continuing] == [2] and further


def test_line_names_compare_by_their_places():
    assert grid.line_ends("Liaison 225 kV n°1 Graffenstaden - Marlenheim") == grid.line_ends(
        "graffenstaden - marlenheim"
    )
    shared = grid.line_ends("Liaison 400 kV n°1 Marlenheim - Vigy;Liaison 400 kV Bergholz - Marlenheim")
    assert frozenset({"marlenheim", "vigy"}) in shared and len(shared) == 2
    assert grid.line_ends(None) == set() and grid.line_ends("Ligne du Rhin") == set()


def _geo_edge(edge_id, way, source, target, coords, name=None):
    e = _edge(edge_id, way, source, target, name)
    e["geometry"] = json.dumps({"type": "LineString", "coordinates": coords})
    return e


def test_turns():
    assert grid.turn((-1, 0), (1, 0)) == 0  # in from the west, out to the east: straight
    assert round(grid.turn((-1, 0), (0, 1))) == 90


def test_where_a_line_splits_in_two_the_straightest_way_goes_on():
    # Arrives from the west at node 5 (7.0, 48.0); one way goes on east, the other
    # turns north.
    taken = {1: _geo_edge(1, 100, 0, 5, [[6.9, 48.0], [7.0, 48.0]], "A - B")}
    east = _geo_edge(2, 300, 5, 6, [[7.0, 48.0], [7.1, 48.01]])
    north = _geo_edge(3, 400, 5, 7, [[7.0, 48.0], [7.0, 48.1]])
    assert [e["edge_id"] for e in grid.continuing_edges(5, taken, [east, north], {"A - B"})[0]] == [2]
    # Both bend the same way: it can't be told, the line stops there.
    ne = _geo_edge(2, 300, 5, 6, [[7.0, 48.0], [7.05, 48.05]])
    se = _geo_edge(3, 400, 5, 7, [[7.0, 48.0], [7.05, 47.95]])
    both, further = grid.continuing_edges(5, taken, [ne, se], {"A - B"})
    assert len(both) == 2 and not further
