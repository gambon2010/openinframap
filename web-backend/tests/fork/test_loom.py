"""src/fork/background/loom_input.py and loom_tiles.py: the trams and metro as
LOOM's input (a graph per network), and LOOM's tiles packed for the map."""

import gzip

import mapbox_vector_tile  # type: ignore[import-untyped]
import shapely

from src.fork.background import line_stops, loom_input, loom_tiles
from src.fork.background.tiles import tile_bounds

OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="48.50" lon="7.70"/><node id="2" lat="48.50" lon="7.71"/>
  <node id="3" lat="48.50" lon="7.72"/>
  <node id="4" lat="48.80" lon="7.70"/><node id="5" lat="48.80" lon="7.71"/>
  <node id="9" lat="48.50" lon="7.715"><tag k="railway" v="tram_stop"/><tag k="name" v="Gare"/></node>
  <way id="10"><nd ref="1"/><nd ref="2"/><tag k="railway" v="tram"/></way>
  <way id="11"><nd ref="2"/><nd ref="3"/><tag k="railway" v="tram"/></way>
  <way id="12"><nd ref="4"/><nd ref="5"/><tag k="railway" v="tram"/></way>
  <way id="13"><nd ref="4"/><nd ref="5"/><tag k="railway" v="tram"/><tag k="service" v="yard"/></way>
  <relation id="20"><member type="way" ref="10" role=""/><member type="way" ref="11" role=""/>
    <tag k="type" v="route"/><tag k="route" v="tram"/><tag k="ref" v="A"/>
    <tag k="colour" v="#ff0000"/></relation>
  <relation id="21"><member type="way" ref="12" role=""/>
    <tag k="type" v="route"/><tag k="route" v="tram"/><tag k="ref" v="B"/></relation>
</osm>
"""


def test_a_graph_per_network_its_lines_named_by_kind_stations_at_dead_ends(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(OSM)
    networks = loom_input.graphs(path)
    assert len(networks) == 2  # 33 km apart
    first = next(n for n in networks if loom_input.lines_in(n) == {"tram:A"})
    edges = [f for f in first["features"] if f["geometry"]["type"] == "LineString"]
    assert len(edges) == 2
    assert edges[0]["properties"]["lines"] == [{"id": "tram:A", "label": "tram:A", "color": "ff0000"}]
    stations = {f["properties"]["id"] for f in first["features"] if "station_id" in f["properties"]}
    # Both dead ends, and the stop; not the node where the two ways meet.
    assert stations == {"n1", "n3", "s9"}
    other = next(n for n in networks if n is not first)
    assert loom_input.lines_in(other) == {"tram:B"}  # its yard track left out


def test_loom_tiles_kept_with_our_properties_tunnels_cut_networks_merged(tmp_path):
    z, x, y = 15, 17088, 11310
    west, south, east, north = tile_bounds(z, x, y)

    def loom_tile(line: str, colour: str) -> bytes:
        feature = {
            "geometry": "LINESTRING(0 512, 1024 512)",
            "properties": {"line": line, "line-color": colour},
        }
        layers = [{"name": "lines", "features": [feature]}, {"name": "stations", "features": []}]
        return mapbox_vector_tile.encode(layers, default_options={"extents": 1024, "y_coord_down": True})

    files = []
    for n, (line, colour) in enumerate([("tram:A", "ff0000"), ("subway:1", "00ff00")]):
        path = tmp_path / f"{n}.mvt"
        path.write_bytes(loom_tile(line, colour))
        files.append(path)
    # Underground: the tile's east half.
    underground = shapely.box((west + east) / 2, south, east, north)
    data = loom_tiles.repacked(files, z, x, y, loom_tiles.Around({z: underground}, line_stops.StopIndex([])))
    assert data is not None
    tile = mapbox_vector_tile.decode(gzip.decompress(data))
    assert set(tile) == {"lines"}  # LOOM's stations left out
    props = [f["properties"] for f in tile["lines"]["features"]]
    assert {(p["kind"], p["ref"], p["colour"], p.get("tunnel", False)) for p in props} == {
        ("tram", "A", "#ff0000", False),
        ("tram", "A", "#ff0000", True),
        ("subway", "1", "#00ff00", False),
        ("subway", "1", "#00ff00", True),
    }


STOPS_OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="48.5800" lon="7.7400"><tag k="name" v="Homme de Fer"/></node>
  <node id="2" lat="48.5805" lon="7.7402"><tag k="name" v="Homme de Fer"/></node>
  <node id="3" lat="48.6000" lon="7.7400"><tag k="name" v="Homme de Fer"/></node>
  <node id="4" lat="48.5700" lon="7.7500"/><node id="5" lat="48.5700" lon="7.7510"/>
  <way id="10"><nd ref="4"/><nd ref="5"/><tag k="name" v="Etoile"/></way>
  <relation id="20"><member type="node" ref="1" role="stop"/>
    <member type="node" ref="3" role="stop_exit_only"/>
    <member type="way" ref="10" role="platform"/>
    <tag k="type" v="route"/><tag k="route" v="tram"/><tag k="ref" v="A"/></relation>
  <relation id="21"><member type="node" ref="2" role="stop"/>
    <tag k="type" v="route"/><tag k="route" v="tram"/><tag k="ref" v="D"/></relation>
  <relation id="22"><member type="way" ref="10" role="platform"/>
    <tag k="type" v="route"/><tag k="route" v="light_rail"/><tag k="ref" v="E"/></relation>
</osm>
"""


def test_a_lines_stops_one_per_name_nearby_platforms_when_no_stops(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(STOPS_OSM)
    found = {(s.name, line_stops.lines_text(s.lines)) for s in line_stops.stops(path)}
    assert found == {
        ("Homme de Fer", ",A,D,"),  # A's and D's stops 60 m apart: one
        ("Homme de Fer", ",A,"),  # the same name 2 km away: another
        ("Etoile", ",E,"),  # E lists no stops: its platform (A has stops: not its platform)
    }
    index = line_stops.StopIndex(line_stops.stops(path))
    z, x, y = 12, 2136, 1413  # Strasbourg's centre
    layer = index.layer(tile_bounds(z, x, y))
    assert layer is not None and layer["name"] == "stops"
    assert {f["properties"]["name"] for f in layer["features"]} >= {"Homme de Fer"}


def test_tunnels_reach_as_far_as_a_bundle_of_lanes_spreads():
    # Zoomed out LOOM spreads the lanes further: twice as far a zoom out.
    assert loom_tiles.bundle_spread(12) == 2 * loom_tiles.bundle_spread(13)
    # Five lanes of 1.5 pixels (256 to a tile) at zoom 12: about 38 m a pixel.
    assert 140 < loom_tiles.bundle_spread(12) < 160
