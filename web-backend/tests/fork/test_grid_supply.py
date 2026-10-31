from src.fork import grid_supply as gs
from src.fork import line_trace as lt


def _index(nodes, edges):
    """nodes: {id: kind}; edges: (way, source, target, voltages...)."""
    index = lt.GridIndex()
    for node, kind in nodes.items():
        index.nodes[node] = lt.Node(kind, node, None)
    for i, (way, source, target, *voltages) in enumerate(edges):
        index.add(lt.Edge(i, way, source, target, frozenset(voltages), None, 1000, (1, 0), (-1, 0)))
    return index


def _supply(index, sources, lost_edges=(), lost_points=()):
    graph = gs.build(index)
    graph.baseline = gs.best_paths(graph, sources, set(), set())
    best = gs.best_paths(graph, sources, set(lost_edges), set(lost_points))
    return {n: gs.state(n, best, graph.baseline) for n in graph.station_voltage}


# Plant 1 -400 kV- A (2) -400 kV- B (3); A -63 kV- C (4) -63 kV- B: B is fed at 400 kV,
# and through 63 kV lines if its 400 kV line is lost.
NODES = {1: "plant", 2: "substation", 3: "substation", 4: "substation"}
EDGES = [(10, 1, 2, 400000), (11, 2, 3, 400000), (12, 2, 4, 63000), (13, 4, 3, 63000)]


def test_nothing_lost_everything_green():
    assert set(_supply(_index(NODES, EDGES), {1}).values()) == {"green"}


def test_fed_through_lower_voltages_is_orange():
    states = _supply(_index(NODES, EDGES), {1}, lost_edges={1})
    assert states[3] == "orange" and states[2] == "green" and states[4] == "green"


def test_cut_off_is_red():
    states = _supply(_index(NODES, EDGES), {1}, lost_points={2})
    assert states[3] == "red" and states[4] == "red"


def test_voltages_meet_only_at_stations():
    # 1 -400 kV- pylon 5 -63 kV- substation 6: no transformer at the pylon.
    index = _index({1: "plant", 5: "junction", 6: "substation"}, [(10, 1, 5, 400000), (11, 5, 6, 63000)])
    # Not reached even with nothing lost: missing data, not coloured.
    assert _supply(index, {1})[6] == "unknown"
    # A way carrying both voltages reaches the 63 kV line at the pylon.
    index = _index(
        {1: "plant", 5: "junction", 6: "substation"}, [(10, 1, 5, 400000, 63000), (11, 5, 6, 63000)]
    )
    assert _supply(index, {1})[6] == "green"
