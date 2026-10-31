from src.fork import line_trace as lt
from src.fork.grid_check import kind

# Directions leaving a node (east, north).
E, W, N, S, NE, SE = (1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1)


def _index(nodes, edges):
    """nodes: {id: kind or (kind, name)}; edges: (way, source, target, name,
    direction leaving the source[, voltages])."""
    index = lt.GridIndex()
    for node, info in nodes.items():
        kind_, name = info if isinstance(info, tuple) else (info, None)
        index.nodes[node] = lt.Node(kind_, node, name)
    for i, (way, source, target, name, out, *voltages) in enumerate(edges):
        back = (-out[0], -out[1])
        index.add(lt.Edge(i, way, source, target, frozenset(voltages or [225000]), name, 1000, out, back))
    return index


def _stations(index, trace):
    return {index.nodes[n].name or n for n in trace.stations}


def test_a_line_continues_along_its_own_way_not_another_passing_through():
    index = _index(
        {1: ("substation", "A"), 2: "junction", 3: ("substation", "B"), 4: "junction", 5: "junction"},
        [(10, 1, 2, None, E), (10, 2, 3, None, E), (20, 4, 2, None, S), (20, 2, 5, None, S)],
    )
    trace = lt.trace_line(index, 10)
    assert trace.ways(index) == {10} and _stations(index, trace) == {"A", "B"}
    assert trace.loose == {}


def test_a_named_line_keeps_to_its_name_and_its_circuit():
    index = _index(
        {1: ("substation", "A"), 2: "junction", 3: ("substation", "B"), 4: ("substation", "B2")},
        [
            (10, 1, 2, "Liaison 225 kV n°1 A - B", E),
            (11, 2, 3, "Liaison 225 kV n°2 A - B", E),
            (12, 2, 4, "Liaison 225 kV N0 1 A - B", NE),
        ],
    )
    assert lt.trace_line(index, 10).ways(index) == {10, 12}


def test_a_named_line_goes_on_unnamed_not_into_another_line():
    index = _index(
        {1: ("substation", "Graffenstaden"), 2: "junction", 3: ("substation", "Marlenheim"), 4: "substation"},
        [
            (10, 1, 2, "Graffenstaden - Marlenheim", E),
            (11, 2, 3, None, E),
            (12, 2, 4, "Reichstett - Strasbourg", N),
        ],
    )
    trace = lt.trace_line(index, 10)
    assert trace.ways(index) == {10, 11} and trace.loose == {}


def test_the_straightest_way_goes_on_where_two_start():
    index = _index(
        {1: "substation", 2: "junction", 3: "substation", 4: "substation"},
        [(10, 1, 2, None, E), (11, 2, 3, None, E), (12, 2, 4, None, N)],
    )
    assert lt.trace_line(index, 10).ways(index) == {10, 11}


def test_an_unclear_split_is_shown_but_not_followed():
    index = _index(
        {1: "substation", 2: "junction", 3: "junction", 4: "junction", 5: "substation", 6: "substation"},
        [
            (10, 1, 2, None, E),
            (11, 2, 3, None, NE),
            (12, 2, 4, None, SE),
            (11, 3, 5, None, E),
            (12, 4, 6, None, E),
        ],
    )
    trace = lt.trace_line(index, 10)
    assert trace.stubs == {11, 12} and trace.loose == {2: "unclear split"}
    assert {index.edges[e].way for e in trace.edges} == {10, 11, 12} and len(trace.edges) == 3


def test_a_split_into_one_station_takes_both():
    index = _index(
        {1: "substation", 2: "junction", 3: ("substation", "Flandre")},
        [(10, 1, 2, None, E), (11, 2, 3, None, NE), (12, 2, 3, None, SE)],
    )
    trace = lt.trace_line(index, 10)
    assert trace.ways(index) == {10, 11, 12} and not trace.stubs and trace.loose == {}


def test_a_double_line_parting_side_by_side_follows_both_circuits():
    index = _index(
        {1: "substation", 2: "junction", 3: "substation", 4: "substation"},
        [(10, 1, 2, "Liaisons n°1 et n°2 A - B", E), (11, 2, 3, None, E), (12, 2, 4, None, (1, 0.05))],
    )
    assert lt.trace_line(index, 10).ways(index) == {10, 11, 12}


def test_a_line_ending_on_another_is_a_tap():
    # The other line is one way passing through, or two ways meeting there.
    for through in ([(20, 3, 2, None, N), (20, 2, 4, None, N)], [(20, 3, 2, None, N), (21, 2, 4, None, N)]):
        index = _index(
            {1: "substation", 2: "junction", 3: "substation", 4: "substation"},
            [(10, 1, 2, None, E), *through],
        )
        trace = lt.trace_line(index, 10)
        assert trace.ways(index) == {10} and trace.loose == {2: "tap"}


def test_an_open_end_is_loose():
    index = _index({1: "substation", 2: "junction"}, [(10, 1, 2, None, E)])
    assert lt.trace_line(index, 10).loose == {2: "open end"}


def test_a_way_with_two_voltages_belongs_to_each():
    index = _index(
        {1: "substation", 2: "junction", 3: "substation", 4: "substation"},
        [(10, 1, 2, None, E, 225000, 63000), (11, 2, 3, None, E, 225000), (12, 2, 4, None, N, 63000)],
    )
    assert lt.trace_line(index, 10).ways(index) == {10, 11}
    assert lt.trace_line(index, 10, 63000).ways(index) == {10, 12}
    assert lt.trace_line(index, 99) is None


def test_line_names_compare_by_their_places():
    assert lt.line_ends("Liaison 225 kV n°1 Graffenstaden - Marlenheim") == {
        (frozenset({"graffenstaden", "marlenheim"}), 1)
    }
    assert lt.line_ends("Ligne No 3 St-Avold - Vigy") == {(frozenset({"saint avold", "vigy"}), 3)}
    assert lt.same_line(lt.line_ends("Échinghen - Sorrus"), lt.line_ends("Liaison 63 kV echinghen - Sorrus"))
    assert not lt.same_line(lt.line_ends("n°1 A - B"), lt.line_ends("n°2 A - B"))
    assert lt.same_line(lt.line_ends("A - B"), lt.line_ends("A - B - C"))
    shared = lt.line_ends("Liaison 400 kV n°1 Marlenheim - Vigy;Liaison 400 kV Bergholz - Marlenheim")
    assert len(shared) == 2
    assert lt.line_ends(None) == set() and lt.line_ends("Ligne du Rhin") == set()


def test_turns():
    assert lt.turn((-1, 0), (1, 0)) == 0  # in from the west, out to the east: straight
    assert round(lt.turn((-1, 0), (0, 1))) == 90


def test_survey_reasons_are_grouped():
    assert kind("not joined to a line 12 m away") == "not joined"
    assert kind("leaves the region") == "leaves the region"
