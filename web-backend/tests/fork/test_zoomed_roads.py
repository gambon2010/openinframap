"""src/fork/background/zoomed_roads.py (with zoomed_out.py): the roads zoomed out
(zooms 8 to 13), copied down from a background map's zoom 15 tiles, with what
Protomaps drops there (tunnel marks, small roads, paths, some big roads); in the
same tiles as the railways."""

import gzip
import math

import mapbox_vector_tile  # type: ignore[import-untyped]
import osmium  # type: ignore[import-untyped]
import pytest
import shapely

from src.fork.background import Archive, beyond_area, zoomed_out
from src.fork.background import zoomed_railways
from src.fork.background import zoomed_roads as zr
from tests.fork.test_background import make

# Two zoom 15 tiles side by side in Paris.
X, Y = 16596, 11273


def road(i, x0, y0, x1, y1, **props):
    return {"id": i, "geometry": f"LINESTRING({x0} {y0},{x1} {y1})", "properties": props}


def tile(*features) -> bytes:
    return mapbox_vector_tile.encode(
        [{"name": "roads", "features": list(features)}, {"name": "water", "features": []}],
        default_options={"y_coord_down": True},
    )


@pytest.fixture
def paris(tmp_path):
    path = tmp_path / "paris.pmtiles"
    tunnel = {"kind": "highway", "kind_detail": "motorway", "is_tunnel": True, "min_zoom": 4, "ref": "A35"}
    make(
        path,
        {
            (15, X, Y): tile(
                # A motorway tunnel crossing into the next tile (each piece past the edge).
                road(1, 100, 2000, 4160, 2000, **tunnel),
                road(2, 100, 500, 3000, 500, kind="minor_road", kind_detail="residential", min_zoom=14),
                road(3, 100, 800, 3000, 800, kind="path", kind_detail="footway", min_zoom=15),
                # A stretch of motorway Protomaps keeps for zoom 15 only.
                road(4, 100, 3000, 3000, 3000, kind="highway", kind_detail="motorway", min_zoom=16),
            ),
            (15, X + 1, Y): tile(road(1, -64, 2000, 3000, 2000, **tunnel)),
            (14, X >> 1, Y >> 1): b"protomaps",
        },
    )
    return path


def roads_in(archive, z, x, y):
    data = archive.get(z, x, y)
    if not data:
        return []
    return mapbox_vector_tile.decode(gzip.decompress(data))[zr.LAYER]["features"]


@pytest.mark.parametrize(
    "props, zoom",
    [
        ({"kind": "minor_road", "min_zoom": 14}, zr.SMALL_ROADS_FROM),
        ({"kind": "path", "kind_detail": "track", "min_zoom": 15}, zr.PATHS_FROM),
        ({"kind": "other", "kind_detail": "pier", "min_zoom": 14}, 13),
        ({"kind": "highway", "kind_detail": "motorway", "min_zoom": 4}, 3),
        ({"kind": "highway", "kind_detail": "motorway", "min_zoom": 16}, 8),
        ({"kind": "major_road", "kind_detail": "tertiary_link", "min_zoom": 16}, 11),
        ({"kind": "major_road", "kind_detail": "secondary", "min_zoom": 9}, 10),
        ({"kind": "major_road", "kind_detail": "tertiary", "min_zoom": 9}, 11),
        ({"kind": "major_road", "kind_detail": "primary", "min_zoom": 9}, 8),
        ({"kind": "rail", "kind_detail": "rail", "min_zoom": 12}, 11),
    ],
)
def test_the_zoom_each_road_shows_from(props, zoom):
    assert zr.from_zoom(props) == zoom


def test_a_road_cut_at_tile_edges_is_one_line_again(paris):
    archive = Archive.open(paris)
    groups = zr.new_groups()
    for x in (X, X + 1):
        zr.collect(zoomed_out.decoded(archive, x, Y), zoomed_out.tile_bounds(15, x, Y), groups)
    joined = zr.joined(groups)
    tunnel = next(g for (_, kept), g in joined.items() if dict(kept).get("is_tunnel"))
    assert tunnel.geom_type == "LineString"  # no seam, no overlap


def test_each_zoom_has_the_roads_shown_there_tunnels_marked(paris):
    out = zoomed_out.make(paris, workers=1)
    companion = Archive.open(out)
    assert (companion.header["min_zoom"], companion.header["max_zoom"]) == (8, 13)
    at = {z: roads_in(companion, z, X >> (15 - z), Y >> (15 - z)) for z in range(8, 14)}
    for z in range(8, 14):
        kinds = {(f["properties"]["kind"], f["properties"].get("is_tunnel", False)) for f in at[z]}
        assert ("highway", True) in kinds, z  # the tunnel, marked, from zoom 8
        assert ("highway", False) in kinds, z  # the stretch kept for zoom 15
        assert (("minor_road", False) in kinds) == (z >= 12), z
        assert (("path", False) in kinds) == (z >= 13), z
    # The properties the map's styles read and a click shows come along; nothing else.
    assert set(at[13][0]["properties"]) <= set(zr.KEPT)
    assert any(f["properties"].get("ref") == "A35" for f in at[8])


def test_roads_and_railways_of_one_place_are_in_one_tile(paris, tmp_path):
    # A main line across the zoom 15 tile, in degrees.
    west, south, east, north = zoomed_out.tile_bounds(15, X, Y)
    lat = math.degrees(math.atan(math.sinh((south + north) / 2 / zoomed_railways.HALF * math.pi)))
    lons = [west / zoomed_railways.HALF * 180, east / zoomed_railways.HALF * 180]
    with osmium.SimpleWriter(str(zoomed_railways.source_of(paris))) as writer:
        for i, lon in enumerate(lons, 1):
            writer.add_node(osmium.osm.mutable.Node(id=i, location=(lon, lat)))
        writer.add_way(osmium.osm.mutable.Way(id=1, nodes=[1, 2], tags={"railway": "rail", "usage": "main"}))
    companion = Archive.open(zoomed_out.make(paris, workers=1))
    z = 12
    data = companion.get(z, X >> (15 - z), Y >> (15 - z))
    assert set(mapbox_vector_tile.decode(gzip.decompress(data))) == {zr.LAYER, zoomed_railways.LAYER}


def test_past_the_area_the_background_maps_own_roads_are_kept(tmp_path):
    # The area: two zoom 15 tiles; a zoom 13 tile reaching past them (a border) with
    # the background map's own roads, one beyond the area, one crossing into it.
    path = tmp_path / "border.pmtiles"
    motorway = {"kind": "highway", "kind_detail": "motorway", "min_zoom": 4}
    inside = road(1, 100, 2000, 3000, 2000, **motorway)
    zoomed_out_tile = tile(
        road(5, 0, 3500, 4096, 3500, **motorway),  # in the tile's bottom half: past the area
        road(6, 0, 1500, 4096, 1500, **motorway),  # the area's row, then past it
    )
    make(
        path, {(15, X, Y): tile(inside), (15, X + 1, Y): tile(inside), (13, X >> 2, Y >> 2): zoomed_out_tile}
    )
    companion = Archive.open(zoomed_out.make(path, workers=1))
    found = roads_in(companion, 13, X >> 2, Y >> 2)
    ys = sorted({round(p[1]) for f in found for p in f["geometry"]["coordinates"]})
    # The road past the area whole; the one crossing it only beyond the area (its
    # own roads come from the zoom 15 tiles), so nothing drawn twice.
    assert any(abs(y - (4096 - 3500)) < 3 for y in ys)
    crossing = [f for f in found if abs(f["geometry"]["coordinates"][0][1] - (4096 - 1500)) < 3]
    assert crossing and all(min(x for x, _ in f["geometry"]["coordinates"]) >= 2048 - 3 for f in crossing)


def test_a_road_only_touching_the_area_leaves_nothing_empty(tmp_path):
    path = tmp_path / "edge.pmtiles"
    motorway = {"kind": "highway", "kind_detail": "motorway", "min_zoom": 4}
    make(path, {(13, X >> 2, Y >> 2): tile(road(1, 0, 0, 2048, 0, **motorway))})
    # The area covers the tile's left half: the road runs along its edge, inside.
    area = shapely.box(*zoomed_out.tile_bounds(14, X >> 1, Y >> 1))
    lines, _ = beyond_area.beyond(Archive.open(path), 13, X >> 2, Y >> 2, area)
    assert not any(shapely.is_empty(line) for line in lines)
