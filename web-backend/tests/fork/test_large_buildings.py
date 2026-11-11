"""src/fork/background/large_buildings.py: the large buildings of the background
maps' zoom 15 tiles (shown zoomed out), measured on the ground."""

import gzip

import mapbox_vector_tile  # type: ignore[import-untyped]
from shapely import wkb

from src.fork.background import large_buildings as lb


def tile(*buildings):
    """A zoom 15 tile of buildings: (id, kind, (x0, y0, x1, y1) in tile units)."""
    return gzip.compress(
        mapbox_vector_tile.encode(
            [
                {
                    "name": "buildings",
                    "features": [
                        {
                            "id": i,
                            "geometry": f"POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))",
                            "properties": {"kind": kind, "height": 12},
                        }
                        for i, kind, (x0, y0, x1, y1) in buildings
                    ],
                }
            ],
            default_options={"y_coord_down": True},
        )
    )


def test_large_buildings_kept_small_ones_left_out():
    # Paris (zoom 15, x 16596, y 11273): a tile unit is ~0.2 m on the ground.
    x, y = 16596, 11273
    data = tile(
        (1, "building", (100, 100, 300, 300)),  # ~39 m × 39 m: ~1,550 m²
        (2, "building", (1000, 1000, 1050, 1050)),  # ~10 m × 10 m: left out
        (3, "building_part", (100, 100, 300, 300)),  # parts: their building counts
        (4, "building", (4000, 2000, 4100, 2050)),  # over the edge: a piece kept
    )
    found = {i: (height, cut, wkb.loads(g)) for i, height, g, cut in lb.tile_pieces((x, y, data))}
    assert set(found) == {1, 4}
    height, cut, geom = found[1]
    assert height == 12 and not cut
    lat_stretch = 0.6583  # cos(48.84°)
    assert 1_450 < geom.area * lat_stretch**2 < 1_650
    # Where the tile is in web Mercator (Paris: x ~ 260,000, y ~ 6,250,000).
    assert 255_000 < geom.centroid.x < 265_000 and 6_240_000 < geom.centroid.y < 6_260_000
    assert found[4][1] is True  # cut at the edge: joined with its other piece in the database
