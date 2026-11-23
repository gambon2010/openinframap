"""src/fork/building_numbers/numbering.py: the order a commune's buildings are
numbered in (as a gridded reference graphic), and new buildings later."""

from src.fork.building_numbers.numbering import label, new_numbers, serpentine

# About 100 m of latitude: one band.
BAND = 100 / 111_320


def test_from_the_north_west_a_band_west_to_east_the_next_back_east_to_west():
    points = [
        (0.002, 0.0),  # second band, east
        (0.000, BAND * 1.5),  # first band, west
        (0.000, 0.0),  # second band, west
        (0.002, BAND * 1.5),  # first band, east
    ]
    assert serpentine(points) == [1, 3, 0, 2]


def test_nothing_to_number():
    assert serpentine([]) == []


def test_new_buildings_follow_on_and_nobody_s_number_changes():
    numbered = {10: 1, 11: 2}
    found = {10: (0.0, 0.0), 11: (0.001, 0.0), 12: (0.002, 0.0), 13: (0.003, 0.0)}
    assert new_numbers(numbered, found) == {12: 3, 13: 4}


def test_a_first_numbering_starts_at_one():
    assert new_numbers({}, {5: (0.0, 0.0)}) == {5: 1}


def test_a_label():
    assert label("WIS", 47) == "WIS-47"


def test_a_staircase_step_is_a_sliver_a_small_house_isn_t():
    from shapely.geometry import box

    from src.fork.building_numbers.buildings import is_sliver

    # At 48.6° N a degree of longitude is about 73.6 km; of latitude 111.3 km.
    lon, lat = 1 / 73_600, 1 / 111_320
    step = box(7.75, 48.58, 7.75 + 20 * lon, 48.58 + 0.3 * lat)  # 20 m by 0.3 m
    house = box(7.75, 48.58, 7.75 + 8 * lon, 48.58 + 6 * lat)  # 8 m by 6 m
    shed = box(7.75, 48.58, 7.75 + 1.2 * lon, 48.58 + 1.2 * lat)  # 1.44 m²
    assert is_sliver(step)
    assert not is_sliver(house)
    assert is_sliver(shed)


def test_a_search_for_a_building_number():
    from src.fork.search.buildings import BUILDING_QUERY

    assert BUILDING_QUERY.match("str-neu-451").groups() == ("str", "neu", "451")
    assert BUILDING_QUERY.match("wis 47").groups() == ("wis", None, "47")
    assert BUILDING_QUERY.match("rue du ried") is None
    assert BUILDING_QUERY.match("strasbourg-12") is None


def test_an_areas_numbers_worked_out_once_then_remembered(monkeypatch):
    import asyncio

    from src.fork.building_numbers import areas
    from src.fork.building_numbers.buildings import AreaBuildings

    asked = []

    def buildings_in(outline):
        asked.append(outline)
        # Two buildings in a row from the west, a sliver apart.
        return AreaBuildings({1: (7.0, 48.0), 2: (7.001, 48.0)}, {3: (7.002, 48.0)})

    monkeypatch.setattr(areas, "buildings_in", buildings_in)
    monkeypatch.setattr(areas.ARCHIVES, "version", lambda: "edition-1")
    areas._remembered.clear()
    square = '{"type": "Polygon", "coordinates": [[[7, 48], [8, 48], [8, 49], [7, 48]]]}'
    first = asyncio.run(areas.area_numbers("67482", square))
    again = asyncio.run(areas.area_numbers("67482", square))
    assert first.numbers == {1: 1, 2: 2} and first.slivers == {3: (7.002, 48.0)}
    assert again is first and len(asked) == 1
    assert first.building_numbered(2) == 2 and first.building_numbered(9) is None


def test_another_background_map_works_them_out_again(monkeypatch):
    import asyncio

    from src.fork.building_numbers import areas
    from src.fork.building_numbers.buildings import AreaBuildings

    asked = []

    def buildings_in(outline):
        asked.append(outline)
        return AreaBuildings({}, {})

    monkeypatch.setattr(areas, "buildings_in", buildings_in)
    areas._remembered.clear()
    square = '{"type": "Polygon", "coordinates": [[[7, 48], [8, 48], [8, 49], [7, 48]]]}'
    for edition in ("edition-1", "edition-2"):
        monkeypatch.setattr(areas.ARCHIVES, "version", lambda edition=edition: edition)
        asyncio.run(areas.area_numbers("67482", square))
    assert len(asked) == 2
