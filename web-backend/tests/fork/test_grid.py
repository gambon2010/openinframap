"""Fork: routes between stations (src/fork/grid.py), without a database."""

import json
from types import SimpleNamespace

import pytest
from starlette.exceptions import HTTPException

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
