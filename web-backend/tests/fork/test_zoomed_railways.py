"""src/fork/background/zoomed_railways.py: the railways zoomed out, ranked from
OpenStreetMap's tags, close tracks drawn as one."""

import numpy as np
import pytest
import shapely

from src.fork.background import zoomed_railways as zr
from src.fork.background.tiles import PIXELS, tile_size

OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="48.50" lon="7.70"/><node id="2" lat="48.50" lon="7.80"/>
  <node id="3" lat="48.50004" lon="7.70"/><node id="4" lat="48.50004" lon="7.80"/>
  <node id="5" lat="48.60" lon="7.70"/><node id="6" lat="48.60" lon="7.75"/>
  <node id="7" lat="48.70" lon="7.70"/><node id="8" lat="48.70" lon="7.71"/>
  <way id="10"><nd ref="1"/><nd ref="2"/>
    <tag k="railway" v="rail"/><tag k="usage" v="main"/><tag k="name" v="Ligne A"/></way>
  <way id="11"><nd ref="3"/><nd ref="4"/>
    <tag k="railway" v="rail"/><tag k="usage" v="main"/><tag k="tunnel" v="yes"/></way>
  <way id="12"><nd ref="5"/><nd ref="6"/><tag k="railway" v="tram"/></way>
  <way id="13"><nd ref="7"/><nd ref="8"/><tag k="railway" v="rail"/><tag k="service" v="siding"/></way>
  <way id="14"><nd ref="7"/><nd ref="8"/><tag k="railway" v="abandoned"/></way>
</osm>
"""


@pytest.fixture
def railways(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(OSM)
    return zr.read(path)


@pytest.mark.parametrize(
    "tags, rank",
    [
        ({"railway": "rail", "usage": "main"}, "main"),
        ({"railway": "rail", "highspeed": "yes"}, "main"),
        ({"railway": "rail", "usage": "branch"}, "branch"),
        ({"railway": "rail"}, "branch"),
        ({"railway": "rail", "usage": "industrial"}, "minor"),
        ({"railway": "tram"}, "minor"),
        ({"railway": "rail", "usage": "main", "service": "yard"}, "service"),
    ],
)
def test_each_line_is_ranked(tags, rank):
    assert zr.rank(tags) == rank


def test_lines_in_use_are_read_with_what_the_map_needs(railways):
    lines, props = railways
    assert [p["kind"] for p in props] == ["rail", "rail", "tram", "rail"]  # not the abandoned one
    assert props[0] == {"kind": "rail", "rank": "main", "name": "Ligne A", "usage": "main"}
    assert props[1]["tunnel"] is True
    assert props[3] == {"kind": "rail", "rank": "service", "service": "siding"}
    # In web Mercator metres: about 7.4 km of line at this latitude, 11.1 km in map units.
    assert shapely.length(lines[0]) == pytest.approx(11_132, rel=0.01)


def test_each_rank_from_its_zoom(railways):
    lines, props = railways
    for z, ranks in [(6, {"main"}), (11, {"main", "minor"}), (14, {"main", "minor", "service"})]:
        assert {p["rank"] for p in zr.shown(lines, props, z)[1]} == ranks


def test_two_tracks_side_by_side_are_one_line_until_zoomed_right_in(railways):
    lines, props = railways
    tracks = lambda z: [p for p in zr.shown(lines, props, z)[1] if p.get("usage") == "main"]  # noqa: E731
    assert len(tracks(10)) == 1
    assert len(tracks(zr.ONE_LINE_UNTIL)) == 1
    assert len(tracks(zr.ONE_LINE_UNTIL + 1)) == 2


def test_where_tracks_part_both_show():
    pixel = tile_size(10) / PIXELS
    shared = [(0, 0), (10_000, 0)]
    a = shapely.LineString(shared + [(20_000, 0)])
    b = shapely.LineString([(0, 20), (10_000, 20), (20_000, 5_000)])  # leaves at 10 km
    lines, props = zr.one_line_for_close_tracks(
        np.array([a, b], dtype=object), [{"rank": "main"}, {"rank": "branch"}], 3 * pixel
    )
    assert len(lines) == 2
    # The branch line's part beside the main line is gone; where it leaves, it shows.
    assert shapely.length(lines[1]) == pytest.approx(shapely.length(b) - 10_000, rel=0.05)


def test_ways_of_one_line_are_joined_end_to_end():
    ways = [shapely.LineString([(0, 0), (10, 0)]), shapely.LineString([(10, 0), (20, 0)])]
    other = shapely.LineString([(20, 0), (30, 0)])
    lines, props = zr.joined(ways + [other], [{"rank": "main"}] * 2 + [{"rank": "branch"}])
    assert sorted(zip([p["rank"] for p in props], shapely.length(lines))) == [("branch", 10), ("main", 20)]
