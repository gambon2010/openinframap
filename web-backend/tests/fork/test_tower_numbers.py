from src.fork import line_trace as lt
from src.fork import tower_numbers as tn
from src.fork.search import TOWER_QUERY, plain

E = (1, 0)


def _index(nodes, edges):
    """nodes: {id: kind or (kind, name)}; edges: (way, source, target, name, length)."""
    index = lt.GridIndex()
    for node, info in nodes.items():
        kind, name = info if isinstance(info, tuple) else (info, None)
        index.nodes[node] = lt.Node(kind, node, name)
    for i, (way, source, target, name, length) in enumerate(edges):
        index.add(lt.Edge(i, way, source, target, frozenset({225000}), name, length, E, (-1, 0)))
    return index


def test_a_line_is_counted_from_the_station_its_name_starts_with():
    index = _index(
        {1: ("substation", "Poste de Bezaumont"), 2: "junction", 3: ("substation", "Poste de Marlenheim")},
        # Drawn from Marlenheim to Bezaumont.
        [
            (10, 3, 2, "Liaison 225 kV Bezaumont - Marlenheim", 300),
            (10, 2, 1, "Liaison 225 kV Bezaumont - Marlenheim", 700),
        ],
    )
    line = tn.number_line(index, lt.trace_line(index, 10), 1)
    assert line.start == "Poste de Bezaumont" and line.end == "Poste de Marlenheim"
    # The stretch from Bezaumont starts there; the other 700 m along, and runs backwards.
    assert line.edges == {1: (0.0, True), 0: (700.0, True)}


def test_an_unnamed_line_is_counted_from_a_substation_first_by_name():
    index = _index(
        {
            1: ("plant", "Parc éolien"),
            2: "junction",
            3: ("substation", "Poste B"),
            4: ("substation", "Poste A"),
        },
        [(10, 1, 2, None, 100), (10, 2, 3, None, 100), (11, 2, 4, None, 100)],
    )
    trace = lt.trace_line(index, 10)
    assert index.nodes[tn.start_station(index, [], {1, 3})].name == "Poste B"
    assert tn.number_line(index, trace, 1).start == "Poste B"


def test_a_line_takes_a_name_for_its_own_voltage():
    trace = lt.Trace(voltage=225000, names={"Liaison 400 kV A - B", "Liaison 225 kV A - B n°1"})
    assert tn.line_name(trace) == "Liaison 225 kV A - B n°1"
    assert tn.line_name(lt.Trace(voltage=225000, names={"Liaison 400 kV A - B"})) is None
    assert tn.line_name(lt.Trace(voltage=225000, names={"A - B"})) == "A - B"


def test_a_line_followed_twice_is_kept_once():
    # Two ways side by side into substation 1: following either gives the same line.
    index = _index(
        {1: "substation", 2: "junction", 3: "junction", 4: "substation"},
        [(10, 1, 2, None, 50), (11, 1, 2, None, 50), (12, 2, 3, None, 1000), (12, 3, 4, None, 1000)],
    )
    assert len(tn.all_lines(index)) == 1


def test_tower_search_queries():
    def parse(query):
        match = TOWER_QUERY.match(plain(query))
        return (match.group(1), match.group(2)) if match else None

    assert parse("23 Marlenheim") == ("23", "marlenheim")
    assert parse("Pylône n°23 Reichstett") == ("23", "reichstett")
    assert parse("tower 7 a - b") == ("7", "a - b")
    assert parse("23a marlenheim") == ("23a", "marlenheim")
    assert parse("Marlenheim") is None


def test_a_new_line_is_numbered_from_1():
    used: set[str] = set()
    assert tn.label_towers([10, 11, 12], {}, used) == ([10, 11, 12], ["1", "2", "3"])
    assert used == {"1", "2", "3"}


def test_numbered_towers_keep_their_numbers():
    known = {10: "1", 11: "2", 12: "3"}
    assert tn.label_towers([10, 11, 12], known, set(known.values()))[1] == ["1", "2", "3"]


def test_a_tower_added_between_two_gets_a_letter():
    known = {10: "1", 11: "2", 12: "3"}
    # 20 and 21 put between 1 and 2, 22 after the last one, 23 before the first.
    towers, labels = tn.label_towers([23, 10, 20, 21, 11, 12, 22], known, set(known.values()))
    assert labels == ["0a", "1", "1a", "1b", "2", "3", "4"]


def test_a_number_is_never_given_again():
    # Tower 11 ("2") was removed; 4 had been given to a tower removed too.
    known = {10: "1", 12: "3"}
    used = {"1", "2", "3", "4"}
    towers, labels = tn.label_towers([10, 20, 12, 21], known, used)
    assert labels == ["1", "1a", "3", "5"]


def test_the_line_is_counted_the_way_it_was():
    known = {10: "1", 11: "2", 12: "3"}
    # Followed from the other end this time.
    towers, labels = tn.label_towers([12, 11, 20, 10], known, set(known.values()))
    assert towers == [10, 20, 11, 12] and labels == ["1", "1a", "2", "3"]


def test_letters_go_on_past_y():
    letters = tn.letters()
    first = [next(letters) for _ in range(27)]
    assert first[:2] == ["a", "b"] and first[24] == "y" and first[25:] == ["za", "zb"]
    assert sorted(first) == first
