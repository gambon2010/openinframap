"""src/fork/background_build/stand_lead_ins.py: airports' stand lead-ins (mapped as
taxiways) left out of the background map's roads."""

import gzip

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from pmtiles.tile import zxy_to_tileid

from src.fork.background_build import stand_lead_ins as sl
from src.fork.background_build.tiles import tile_bounds
from src.fork.background_build.zoomed_railways import mercator

# Taxiway N runs east (nodes 1, 10, 11, 2); a hook leaves it at 10 and ends at a stand;
# a corner joins N (11) to taxiway M; a long apron lane leaves N's west end; a disused
# spoke leaves its east end.
OSM = """<?xml version="1.0" encoding="UTF-8"?>
<osm version="0.6">
  <node id="1" lat="48.5400" lon="7.6200"/><node id="10" lat="48.5400" lon="7.6225"/>
  <node id="11" lat="48.5400" lon="7.6275"/><node id="2" lat="48.5400" lon="7.6300"/>
  <node id="20" lat="48.5405" lon="7.6227"/>
  <node id="30" lat="48.5395" lon="7.6280"/><node id="31" lat="48.5380" lon="7.6280"/>
  <node id="40" lat="48.5430" lon="7.6200"/>
  <node id="50" lat="48.5402" lon="7.6301"/>
  <way id="100"><nd ref="1"/><nd ref="10"/><nd ref="11"/><nd ref="2"/>
    <tag k="aeroway" v="taxiway"/><tag k="name" v="N"/><tag k="ref" v="N"/></way>
  <way id="101"><nd ref="10"/><nd ref="20"/><tag k="aeroway" v="taxiway"/></way>
  <way id="102"><nd ref="11"/><nd ref="30"/><tag k="aeroway" v="taxiway"/></way>
  <way id="103"><nd ref="30"/><nd ref="31"/><tag k="aeroway" v="taxiway"/><tag k="width" v="24"/></way>
  <way id="104"><nd ref="1"/><nd ref="40"/><tag k="aeroway" v="taxiway"/></way>
  <way id="105"><nd ref="2"/><nd ref="50"/><tag k="aeroway" v="taxiway"/><tag k="disused" v="yes"/></way>
</osm>
"""


def at(lon: float, lat: float) -> shapely.Point:
    return shapely.Point(mercator(np.array([[lon, lat]]))[0])


def line(*lon_lat: tuple[float, float]) -> shapely.LineString:
    return shapely.LineString(mercator(np.array(lon_lat)))


def test_only_the_short_untagged_dead_ends_are_lead_ins(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(OSM)
    area = sl.lead_ins(path)
    assert area.contains(at(7.6226, 48.54025))  # the hook
    assert not area.contains(at(7.62775, 48.53975))  # the corner: joined at both ends
    assert not area.contains(at(7.6200, 48.5420))  # the long lane
    assert not area.contains(at(7.63005, 48.5401))  # the disused spoke
    assert not area.contains(at(7.6250, 48.5400))  # taxiway N
    assert sl.lead_ins(tmp_path / "none.osm.pbf").is_empty


def test_a_lane_keeps_its_length_where_a_lead_in_leaves_it(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(OSM)
    area = sl.lead_ins(path)
    # The background map joins untagged taxiways with the same properties into one.
    lane = line((7.6200, 48.5430), (7.6200, 48.5400))
    hook = line((7.6225, 48.5400), (7.6227, 48.5405))
    kept = sl.without(shapely.MultiLineString([lane, hook]), area)
    assert round(kept.length) == round(lane.length)


def test_the_tiles_a_lead_in_is_in_get_a_roads_layer_without_it(tmp_path):
    path = tmp_path / "area.osm"
    path.write_text(OSM)
    area = sl.lead_ins(path)
    (x, y), *_ = sl.tiles_over(area, 15)
    west, _, east, north = tile_bounds(15, x, y)
    scale = (east - west) / 4096

    def in_tile(geometry):
        return shapely.transform(geometry, lambda xy: (xy - [west, north]) / [scale, -scale])

    hook = in_tile(line((7.6225, 48.5400), (7.6227, 48.5405)))
    road = in_tile(line((7.6220, 48.5410), (7.6230, 48.5410)))
    taxiway = {"kind": "aeroway", "kind_detail": "taxiway"}
    data = mapbox_vector_tile.encode(
        [
            {
                "name": "roads",
                "features": [
                    {"geometry": hook, "properties": taxiway, "id": 7},
                    {"geometry": road, "properties": {"kind": "minor_road"}, "id": 8},
                ],
            }
        ],
        default_options={"y_coord_down": True},
    )
    tiles = sl.rewritten_tiles(lambda z, tx, ty: data if (tx, ty) == (x, y) else None, area)
    assert zxy_to_tileid(15, x, y) in [tile_id for tile_id, _ in tiles]
    rewritten = dict(tiles)[zxy_to_tileid(15, x, y)]
    features = mapbox_vector_tile.decode(gzip.decompress(rewritten))["roads"]["features"]
    assert [f["id"] for f in features] == [8]  # the road stays, with its id
