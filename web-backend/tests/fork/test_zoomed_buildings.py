"""src/fork/background/zoomed_buildings.py and zoomed_out.py: the buildings zoomed
out (zooms 12 to 14), made from a background map's zoom 15 tiles into its companion,
<area>.zoomed-out.pmtiles."""

import gzip
import os

import mapbox_vector_tile  # type: ignore[import-untyped]
import pytest
from pmtiles.tile import zxy_to_tileid

from src.fork.background import Archive, companion_of
from src.fork.background import zoomed_buildings as zb
from src.fork.background import zoomed_out
from src.fork.background.tiles import EXTENT, ground_stretch, tile_bounds
from tests.fork.test_background import make

# Two zoom 15 tiles side by side in Paris, in one zoom 12 block.
X, Y = 16596, 11273
BLOCK = (X >> 3, Y >> 3)
UNITS_M2 = (tile_bounds(15, X, Y)[2] - tile_bounds(15, X, Y)[0]) ** 2 / EXTENT**2


def tile(*features) -> bytes:
    return mapbox_vector_tile.encode(
        [{"name": "buildings", "features": list(features)}], default_options={"y_coord_down": True}
    )


def square(i, x0, y0, x1, y1, kind="building", height=None):
    props = {"kind": kind} | ({"height": height} if height else {})
    return {
        "id": i,
        "geometry": f"POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))",
        "properties": props,
    }


def ground_m2(units: float) -> float:
    return units * UNITS_M2 * ground_stretch(zb.BLOCK_ZOOM, BLOCK[1]) ** 2


@pytest.fixture
def paris(tmp_path):
    path = tmp_path / "paris.pmtiles"
    make(
        path,
        {
            # 1: big, cut in two at the edge (each piece 64 units over it, as Protomaps').
            # 2: middling (about 1,100 m²); 3: tiny; 4: a building part (not a building).
            (15, X, Y): tile(
                square(1, 3600, 1000, 4160, 1600, height=30),
                square(2, 100, 100, 270, 270),
                square(3, 500, 500, 520, 520),
                square(4, 1000, 1000, 1600, 1600, kind="building_part"),
            ),
            (15, X + 1, Y): tile(square(1, -64, 1000, 500, 1600, height=30)),
            (14, X >> 1, Y >> 1): b"protomaps",
        },
    )
    return path


def features(archive, z, x, y):
    data = archive.get(z, x, y)
    if not data:
        return []
    return mapbox_vector_tile.decode(gzip.decompress(data))[zb.LAYER]["features"]


def test_a_building_cut_at_tile_edges_is_joined_then_measured(paris):
    archive = Archive.open(paris)
    tiles = {(x, y): zoomed_out.decoded(archive, x, y) for x, y in [(X, Y), (X + 1, Y)]}
    found = {b["id"]: b for b in zb.block_buildings(tiles, *BLOCK)}
    assert set(found) == {1, 2}  # the tiny one and the part left out
    whole = (4096 - 3600 + 500) * 600
    assert found[1]["area"] == pytest.approx(ground_m2(whole), rel=0.01)
    assert found[1]["geom"].geom_type == "Polygon"  # one shape, no seam
    assert found[1]["height"] == 30


def test_each_zoom_has_the_buildings_big_enough_to_see_there(paris):
    out = zoomed_out.make(paris, workers=1)
    assert out == companion_of(paris) and out.exists()
    companion = Archive.open(out)
    # No roads in these tiles: the file starts at the buildings' first zoom.
    assert (companion.header["min_zoom"], companion.header["max_zoom"]) == (12, 14)
    assert ground_m2((4096 - 3600 + 500) * 600) > zb.MIN_AREA_M2[12]
    assert zb.MIN_AREA_M2[14] < ground_m2(170 * 170) < zb.MIN_AREA_M2[13]
    big = features(companion, 12, *BLOCK)
    assert [f["id"] for f in big] == [1]
    assert big[0]["properties"] == {"kind": "building", "height": 30, "area_m2": round(ground_m2(996 * 600))}
    assert {f["id"] for f in features(companion, 13, X >> 2, Y >> 2)} == {1}
    assert {f["id"] for f in features(companion, 14, X >> 1, Y >> 1)} == {1, 2}
    # Only tiles with buildings: the block's other zoom 14 tiles are left out.
    assert companion.get(14, (X >> 1) + 2, Y >> 1) is None
    assert not list(out.parent.glob(".*.part"))


def test_no_zoom_15_no_companion(tmp_path):
    world = tmp_path / "world.pmtiles"
    make(world, {(8, 1, 1): b"zoomed out"})
    assert zoomed_out.make(world, workers=1) is None
    assert not companion_of(world).exists()


def test_out_of_date_companions(tmp_path, paris):
    assert zoomed_out.out_of_date(tmp_path) == [paris]
    zoomed_out.make(paris, workers=1)
    assert zoomed_out.out_of_date(tmp_path) == []
    # A newer download of the area: its companion is made again.
    later = companion_of(paris).stat().st_mtime + 10
    os.utime(paris, (later, later))
    assert zoomed_out.out_of_date(tmp_path) == [paris]


def test_the_work_list_comes_from_the_directories(paris):
    assert zoomed_out.units(Archive.open(paris)) == [(X >> 5, Y >> 5)]
    assert zxy_to_tileid(15, X, Y) in set(Archive.open(paris).tile_ids())
