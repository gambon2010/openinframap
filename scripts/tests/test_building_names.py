"""scripts/building_names.py: the names OpenStreetMap gives buildings, cut from the
region's whole extract with osmium, keyed like the background map's buildings."""

import json

import building_names
from offline_maps import osm_extract


def test_named_buildings_cut_in_two_passes_then_exported(tmp_path, monkeypatch):
    ran = []
    monkeypatch.setattr(
        osm_extract.docker,
        "run_service",
        lambda service, args, mount, at: ran.append(args),
    )
    extract = tmp_path / "france-latest.osm.pbf"
    lines = building_names.cut_named_buildings(extract, tmp_path / "work")
    assert ran[0][1:5] == [
        "tags-filter",
        "/w/france-latest.osm.pbf",
        "w/name",
        "r/name",
    ]
    # Its files all in the work folder: that one mounted.
    assert ran[1][1:4] == ["tags-filter", "/w/named.osm.pbf", "wr/building"]
    assert ran[2][1:3] == ["export", "/w/buildings.osm.pbf"]
    assert lines == tmp_path / "work" / "buildings.geojsonseq"


def test_ids_as_the_background_map_has_them():
    assert building_names.background_id("way", 4487769) == 2 * 2**44 + 4487769
    # Strasbourg's cathedral, a multipolygon.
    assert building_names.background_id("relation", 3541088) == 52776561674336


def test_only_named_buildings_kept(tmp_path):
    square = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}

    def line(**tags):
        return json.dumps(
            {
                "type": "Feature",
                "geometry": square,
                "properties": {"@type": "way", **tags},
            }
        )

    lines = tmp_path / "buildings.geojsonseq"
    lines.write_text(
        "\n".join(
            [
                line(**{"@id": 1, "building": "church", "name": "Chapelle"}),
                # A relation's member the cut keeps with it: no name of its own.
                line(**{"@id": 2, "building": "yes"}),
                line(**{"@id": 3, "building": "no", "name": "Parking"}),
            ]
        )
    )
    kept = list(building_names.named_buildings(lines))
    assert [(building_id, name) for building_id, name, _ in kept] == [
        (2 * 2**44 + 1, "Chapelle")
    ]
    assert json.loads(kept[0][2]) == square
