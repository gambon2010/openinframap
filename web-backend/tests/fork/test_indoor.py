"""src/fork/indoor: buildings' interiors, each piece in the background map's building
it stands in."""

from shapely.geometry import Point

from src.fork.background.buildings import tile_of, to_degrees
from src.fork.indoor import level_number
from src.fork.indoor import link


def test_a_piece_inside_a_building_is_in_it_one_outside_in_none():
    # One building filling the top-left quarter of a zoom 15 tile.
    tx, ty = tile_of(7.75, 48.58)
    square = {"type": "Polygon", "coordinates": [[[0, 0], [2048, 0], [2048, 2048], [0, 2048], [0, 0]]]}
    inside = to_degrees(Point(1000, 1000), tx, ty)
    outside = to_degrees(Point(3000, 3000), tx, ty)
    on_its_wall = to_degrees(Point(2048, 1000), tx, ty)
    found = link.buildings_of(
        {(tx, ty): [(1, inside), (2, outside), (3, on_its_wall)]},
        lambda x, y: [{"id": 42, "geometry": square}],
    )
    # A door on the wall is in it too.
    assert found == {1: 42, 3: 42}


def test_floors_written_as_people_write_them():
    assert level_number(1.0) == 1
    assert level_number(-2.0) == -2
    assert level_number(0.5) == 0.5


def test_what_a_point_inside_is():
    from src.fork.indoor import what_of

    assert what_of("poi", {"shop": "bakery", "name": "Paul"}) == "bakery"
    assert what_of("poi", {"amenity": "toilets"}) == "toilets"
    assert what_of("elevator", {}) == "elevator"
    assert what_of("poi", {}) == "poi"


def test_the_maps_points_inside_a_building_named_and_not_street_furniture(monkeypatch):
    from shapely.geometry import box

    from src.fork.background import pois

    tx, ty = tile_of(7.75, 48.58)

    def poi(name, kind, x, y):
        return {
            "geometry": {"type": "Point", "coordinates": [x, y]},
            "properties": {"name": name, "kind": kind},
        }

    monkeypatch.setattr(
        pois,
        "tile_pois",
        lambda x, y: [
            poi("Paul", "bakery", 1000, 1000),
            poi("Banc", "bench", 1000, 1100),
            poi("", "restaurant", 1100, 1000),
            poi("Far away", "restaurant", 3000, 3000),
        ],
    )
    building = to_degrees(box(0, 0, 2048, 2048), tx, ty)
    found = pois.pois_in(building, [(tx, ty)])
    assert [(p["name"], p["what"]) for p in found] == [("Paul", "bakery")]
