"""src/fork/background/transit_lines.py: tram and metro lines from OpenStreetMap's
routes, a strand each."""

import numpy as np
import shapely

from src.fork.background import transit_lines as tl


def test_a_route_is_a_line_with_its_colour_or_one_picked_by_its_name():
    route = {"type": "route", "route": "subway"}
    assert tl.line_of(route | {"ref": "4", "colour": "#BE418D"}) == ("4", "#BE418D")
    picked = tl.line_of(route | {"ref": "A", "colour": "purple-ish"})
    assert picked is not None and picked[1] in tl.PALETTE
    assert tl.line_of(route | {"ref": "A"}) == picked  # A the same colour everywhere
    assert tl.line_of({"type": "route", "route": "bus", "ref": "A"}) is None
    assert tl.line_of(route) is None


def test_lines_in_order_numbers_as_numbers():
    lines = {("10", "#000"), ("2", "#000"), ("T1", "#000"), ("A", "#000")}
    assert [ref for ref, _ in tl.in_order(lines)] == ["2", "10", "A", "T1"]


def test_a_track_once_per_line_on_it():
    track = shapely.LineString([(0, 0), (1, 0)])
    props = [{"kind": "tram", "lines": (("A", "#f00"), ("D", "#0f0"))}, {"kind": "tram"}]
    lines, out = tl.strands(np.array([track, track], dtype=object), props)
    assert len(lines) == 3
    assert out == [
        {"kind": "tram", "line": "A", "colour": "#f00", "slot": 0, "slots": 2},
        {"kind": "tram", "line": "D", "colour": "#0f0", "slot": 1, "slots": 2},
        {"kind": "tram"},
    ]
