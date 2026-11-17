"""src/fork/background/close_lines.py: lines running close together drawn as one,
lines crossing or meeting left whole."""

import numpy as np
import pytest
import shapely

from src.fork.background.close_lines import one_line_where_close


def run(*lines, distance=10.0):
    return one_line_where_close(
        np.array(lines, dtype=object),
        [{"n": i} for i in range(len(lines))],
        list(range(len(lines))),
        distance,
    )


def test_two_lines_side_by_side_are_one():
    lines, props = run(shapely.LineString([(0, 0), (1000, 0)]), shapely.LineString([(0, 5), (1000, 5)]))
    assert [p["n"] for p in props] == [0]


def test_a_line_crossing_or_meeting_another_stays_whole():
    main = shapely.LineString([(0, 0), (1000, 0)])
    crossing = shapely.LineString([(500, -500), (500, 500)])
    meeting = shapely.LineString([(700, 0), (700, 500)])
    lines, props = run(main, crossing, meeting)
    assert [p["n"] for p in props] == [0, 1, 2]
    assert shapely.length(lines[1]) == pytest.approx(1000)
    assert shapely.length(lines[2]) == pytest.approx(500)


def test_where_they_part_the_rest_shows():
    main = shapely.LineString([(0, 0), (1000, 0)])
    leaving = shapely.LineString([(0, 5), (500, 5), (500, 800)])
    lines, props = run(main, leaving)
    assert [p["n"] for p in props] == [0, 1]
    assert shapely.length(lines[1]) == pytest.approx(800, abs=20)
