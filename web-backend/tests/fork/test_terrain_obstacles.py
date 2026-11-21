"""src/fork/terrain/obstacles.py: buildings and trees from a background tile."""

from src.fork.terrain import obstacles


def square(x0: float, y0: float, size: float) -> dict:
    ring = [(x0, y0), (x0 + size, y0), (x0 + size, y0 + size), (x0, y0 + size), (x0, y0)]
    return {"type": "Polygon", "coordinates": [ring]}


def test_buildings_and_trees_stand_where_they_are_the_tallest_counts():
    layers = {
        "buildings": {
            "features": [
                {"geometry": square(100, 100, 50), "properties": {"height": 31}},
                {"geometry": square(1000, 1000, 50), "properties": {}},  # no height: standard
            ]
        },
        "landuse": {
            "features": [
                {"geometry": square(0, 0, 2000), "properties": {"kind": "forest"}},
                {"geometry": square(3000, 3000, 500), "properties": {"kind": "meadow"}},
            ]
        },
    }
    shapes = obstacles.shapes_of(layers)
    found = shapes.at([(120, 120), (1020, 1020), (500, 500), (3200, 3200), (4000, 100)])
    assert found[0] == obstacles.Obstacle(31.0, "building")  # in the wood, taller than its trees
    assert found[1] == obstacles.Obstacle(obstacles.TREE_HEIGHT, "trees")  # 8 m house under 20 m trees
    assert found[2] == obstacles.Obstacle(obstacles.TREE_HEIGHT, "trees")
    assert found[3] == obstacles.NOTHING  # a meadow
    assert found[4] == obstacles.NOTHING


def test_a_point_s_place_in_its_zoom_15_tile():
    # Lon 0, lat 0: the corner of tile (16384, 16384), its top left.
    assert obstacles.tile_position(0.0, 0.0) == (16384, 16384, 0.0, 0.0)
    # Half a tile east and south of it: the middle of that tile.
    half = 360 / 2**15 / 2
    x, y, px, py = obstacles.tile_position(half, -half)
    assert (x, y) == (16384, 16384)
    assert abs(px - obstacles.EXTENT / 2) < 1 and abs(py - obstacles.EXTENT / 2) < 1
