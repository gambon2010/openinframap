"""scripts/indoor.py: buildings' interiors cut from the region's whole extract: what
each piece is, and the floors it's on."""

import json

import indoor
from offline_maps import osm_extract


def test_the_floors_a_level_names():
    assert indoor.levels_of("0") == [0.0]
    assert indoor.levels_of("1;3") == [1.0, 3.0]
    assert indoor.levels_of("0-3") == [0.0, 1.0, 2.0, 3.0]
    assert indoor.levels_of("-2--1") == [-2.0, -1.0]
    assert indoor.levels_of("0.5") == [0.5]


def test_a_level_not_understood_names_none():
    assert indoor.levels_of("ground") == []
    assert indoor.levels_of("") == []


def test_what_each_piece_is():
    assert indoor.indoor_kind({"indoor": "room"}) == "room"
    assert indoor.indoor_kind({"indoor": "yes", "highway": "steps"}) == "stairs"
    assert indoor.indoor_kind({"highway": "elevator", "level": "0"}) == "elevator"
    assert indoor.indoor_kind({"conveying": "forward", "level": "1"}) == "escalator"
    assert indoor.indoor_kind({"indoor": "shop"}) == "room"
    assert indoor.indoor_kind({"shop": "bakery", "level": "0"}) == "poi"


def test_outside_left_out():
    assert (
        indoor.indoor_kind({"indoor": "no", "level": "0", "amenity": "bench"}) is None
    )


def test_a_row_each_piece_with_its_floors(tmp_path):
    lines = tmp_path / "indoor.geojsonseq"
    point = {"type": "Point", "coordinates": [7.7, 48.5]}
    lines.write_text(
        "\n".join(
            json.dumps(
                {
                    "type": "Feature",
                    "geometry": point,
                    "properties": {"@type": t, "@id": i, **tags},
                }
            )
            for t, i, tags in [
                ("way", 1, {"indoor": "room", "level": "1;2", "name": "Salle 204"}),
                ("node", 2, {"shop": "bakery"}),
                ("node", 3, {"indoor": "no", "level": "0"}),
            ]
        )
    )
    rows = list(indoor.indoor_rows(lines))
    assert [row[:9] for row in rows] == [
        ["w1", "room", "Salle 204", "", "1;2", "1.0", "2.0", "True", "False"],
        # No floor written: the ground floor for now; kept only inside an interior or a building.
        ["n2", "poi", "", "", "0", "0.0", "0.0", "False", "True"],
    ]


def test_cut_from_the_whole_extract(tmp_path, monkeypatch):
    ran = []
    monkeypatch.setattr(
        osm_extract.docker,
        "run_service",
        lambda service, args, mount, at: ran.append(args),
    )
    indoor.cut_indoor(tmp_path / "france-latest.osm.pbf", tmp_path / "work")
    assert ran[0][1:6] == [
        "tags-filter",
        "/w/france-latest.osm.pbf",
        "nwr/indoor",
        "nwr/level",
        "nwr/repeat_on",
    ]
    assert ran[1][1:3] == ["export", "/w/indoor.osm.pbf"]
