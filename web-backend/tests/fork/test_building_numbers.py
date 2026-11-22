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
