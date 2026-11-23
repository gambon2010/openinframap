"""Fork: routes between stations (src/fork/grid.py), without a database."""

import json
from types import SimpleNamespace

import pytest
from starlette.exceptions import HTTPException

from src.fork import grid
from src.fork.grid import build_graph, describe, distinct_paths, parse_station


def edge(edge_id, source, target, length_m, voltage=220000, name=None, tag=None, junctions=()):
    """A stretch between two stations, unless they're in `junctions`."""
    line = [[source, 0], [target, 0]]
    return {
        "edge_id": edge_id,
        "source": source,
        "target": target,
        "voltage": voltage,
        "voltage_tag": tag,
        "source_station": source not in junctions,
        "target_station": target not in junctions,
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
    assert graph[1][2]["circuits"] == [(1, 220000), (2, 220000)]
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
    info: dict = {}
    # Node 2 is a junction (a pylon where two lines join), at 220 kV.
    graph = build_graph(
        rows(
            edge(1, 1, 2, 4000, junctions={2}),
            edge(2, 2, 3, 6000, junctions={2}),
            edge(3, 2, 3, 6500, junctions={2}, tag="380000;220000", voltage=380000),
        ),
        info,
    )
    names = {
        1: {"kind": "substation", "osm_id": 10, "name": "A"},
        3: {"kind": "plant", "osm_id": 30, "name": "C"},
    }
    out = describe([1, (2, 220000), 3], graph, info, names)
    assert out["length_km"] == 10.0
    assert out["voltages_kv"] == [220]
    assert [s["name"] for s in out["stations"]] == ["A", "C"]
    assert out["segments"] == [
        {
            "from": {"kind": "substation", "osm_id": 10, "name": "A"},
            "to": {"kind": "plant", "osm_id": 30, "name": "C"},
            "length_km": 10.0,
            "voltages_kv": [220],
        }
    ]
    # Both parallel lines between 2 and 3 are drawn (the 220 kV circuit of the double way).
    assert len(out["geometry"]["coordinates"]) == 3


def test_describe_ending_at_a_junction():
    info: dict = {}
    graph = build_graph(rows(edge(1, 1, 2, 2500, junctions={2})), info)
    out = describe([1, (2, 220000)], graph, info, {1: {"kind": "substation", "osm_id": 1, "name": "A"}})
    assert out["segments"][0]["to"] is None


def test_lines_of_different_voltages_meet_only_at_stations():
    info: dict = {}
    # 1 -(225 kV)- pylon 2 -(63 kV)- 3: no transformer at the pylon, no route.
    graph = build_graph(
        rows(edge(1, 1, 2, 1000, 225000, junctions={2}), edge(2, 2, 3, 1000, 63000, junctions={2})), info
    )
    assert distinct_paths(graph, 1, 3, 1) == []
    # Through a substation (2) they connect.
    graph = build_graph(rows(edge(1, 1, 2, 1000, 225000), edge(2, 2, 3, 1000, 63000)), info)
    assert distinct_paths(graph, 1, 3, 1) == [[1, 2, 3]]


def test_a_way_with_two_voltages_carries_each():
    info: dict = {}
    # 1 -(225/63 kV double way)- pylon 2, then 63 kV on to 3 and 225 kV on to 4.
    graph = build_graph(
        rows(
            edge(1, 1, 2, 1000, 225000, tag="225000;63000", junctions={2}),
            edge(2, 2, 3, 1000, 63000, junctions={2}),
            edge(3, 2, 4, 1000, 225000, junctions={2}),
        ),
        info,
    )
    assert distinct_paths(graph, 1, 3, 1) == [[1, (2, 63000), 3]]
    assert distinct_paths(graph, 1, 4, 1) == [[1, (2, 225000), 4]]
    # The backbone (110 kV and more) leaves the 63 kV circuit out.
    backbone = build_graph(rows(edge(1, 1, 2, 1000, 225000, tag="225000;63000", junctions={2})), info, 110000)
    assert (2, 63000) not in backbone and (2, 225000) in backbone


def test_which_circuit_of_a_way_a_line_is():
    assert grid.circuit_of("63000;20000", 63000) == {"index": 1, "count": 2}
    assert grid.circuit_of("400000;225000", 225000) == {"index": 2, "count": 2}
    assert grid.circuit_of("225000", 225000) == {"index": 1, "count": 1}
    assert grid.circuit_of(None, 225000) == {"index": 1, "count": 1}


def test_route_params():
    from types import SimpleNamespace

    from starlette.exceptions import HTTPException

    from src.fork.grid.route import MAX_PATHS, route_params

    def ask(**params):
        return route_params(SimpleNamespace(query_params=params))  # type: ignore[arg-type]

    assert ask(**{"from": "substation/1", "to": "plant/2"}) == (("substation", 1), ("plant", 2), 3)
    assert ask(**{"from": "substation/1", "to": "plant/2", "paths": "99"})[2] == MAX_PATHS
    assert ask(**{"from": "substation/1", "to": "plant/2", "paths": "0"})[2] == 1
    for bad in ({"from": "substation/1", "to": "plant/2", "paths": "x"}, {"from": "road/1", "to": "plant/2"}):
        with pytest.raises(HTTPException) as e:
            ask(**bad)
        assert e.value.status_code == 400
