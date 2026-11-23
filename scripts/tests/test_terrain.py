"""scripts/offline_maps/terrain.py: an area's terrain cut out of Mapterhorn's files
(the pmtiles program and the network faked)."""

import json
import subprocess

from fake_pmtiles import write as pmtiles

from offline_maps import terrain

WORLD = {
    "name": "planet.pmtiles",
    "url": "https://x/planet.pmtiles",
    "min_zoom": 0,
    "max_zoom": 12,
    "min_lon": -180,
    "max_lon": 180,
    "min_lat": -85,
    "max_lat": 85,
}


def tile6(name, west, south, east, north, max_zoom=17):
    return {
        "name": name,
        "url": f"https://x/{name}",
        "min_zoom": 13,
        "max_zoom": max_zoom,
        "min_lon": west,
        "max_lon": east,
        "min_lat": south,
        "max_lat": north,
    }


ALSACE = tile6("6-33-22.pmtiles", 5.6, 45.1, 11.3, 48.9)
FAR = tile6("6-0-21.pmtiles", -180, 48.9, -174.4, 52.5)
FRANCE_OUTLINE = {
    "type": "MultiPolygon",
    "coordinates": [[[[7, 47], [8, 47], [8, 49], [7, 49], [7, 47]]]],
}


def test_the_files_an_area_touches_the_world_file_always():
    assert terrain.files_for([WORLD, ALSACE, FAR], (7, 47, 8, 49)) == [WORLD, ALSACE]


def test_an_outline_s_bounds_from_nested_coordinates(tmp_path):
    outline = tmp_path / "area.geojson"
    outline.write_text(json.dumps(FRANCE_OUTLINE))
    assert terrain.outline_bounds(outline) == (7, 47, 8, 49)


def test_terrain_is_missing_beside_a_background_map_until_made_to_its_zoom(tmp_path):
    assert not terrain.terrain_missing(tmp_path, "france")  # no background map
    pmtiles(tmp_path / "france.pmtiles", 0, 15)
    assert terrain.terrain_missing(tmp_path, "france")
    pmtiles(tmp_path / "france.terrain.pmtiles", 0, 12)  # cut short
    assert terrain.terrain_missing(tmp_path, "france")
    pmtiles(tmp_path / "france.terrain.pmtiles", 0, terrain.MAX_ZOOM)
    assert not terrain.terrain_missing(tmp_path, "france")
    pmtiles(tmp_path / "world.pmtiles", 0, 8)
    assert not terrain.terrain_missing(tmp_path, "world")  # not for the world


def test_made_from_the_parts_holding_tiles_merged(tmp_path, monkeypatch):
    outline = tmp_path / ".area-alsace.geojson"
    outline.write_text(json.dumps(FRANCE_OUTLINE))
    near_but_empty = tile6("6-33-21.pmtiles", 5.6, 48.5, 11.3, 52.5)
    monkeypatch.setattr(
        terrain, "listing", lambda: [WORLD, ALSACE, near_but_empty, FAR]
    )
    ran = []

    def fake_pmtiles(folder, args, **options):
        ran.append(args)
        if args[0] == "extract":
            out = tmp_path / args[2].removeprefix("/out/")
            pmtiles(out, 0, 13, tile_count=0 if "6-33-21" in args[1] else 5)
        else:  # merge: the last argument is the output
            pmtiles(tmp_path / args[-1].removeprefix("/out/"), 0, 13)
        return subprocess.CompletedProcess(args, 0)

    monkeypatch.setattr(terrain, "pmtiles", fake_pmtiles)
    flattened = []
    monkeypatch.setattr(
        terrain, "flatten_sea", lambda folder, area: flattened.append(area)
    )
    terrain.make_terrain(tmp_path, "alsace", outline)

    cut = [a for a in ran if a[0] == "extract"]
    assert [a[1] for a in cut] == [WORLD["url"], ALSACE["url"], near_but_empty["url"]]
    assert all(f"--maxzoom={terrain.MAX_ZOOM}" in a for a in cut)
    assert all("--region=/out/.area-alsace.geojson" in a for a in cut)
    (merge,) = [a for a in ran if a[0] == "merge"]
    assert merge[1:-1] == [
        "/out/.alsace.terrain-1.pmtiles",
        "/out/.alsace.terrain-2.pmtiles",
    ]
    assert (tmp_path / "alsace.terrain.pmtiles").exists()
    assert not list(tmp_path.glob(".alsace.terrain-*"))  # the parts are gone
    # And its sea flattened, once merged.
    assert flattened == ["alsace"]
