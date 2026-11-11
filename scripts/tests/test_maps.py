"""scripts/satimagery/maps.py: the offline maps menu, driven by typed answers in a
temporary data/basemap/ (the downloads it starts are recorded, not run)."""

import io
import json
import re
import subprocess

import pytest

import satellite as s
from satimagery import inventory, maps


def pmtiles(path, minzoom, maxzoom):
    header = bytearray(127)
    header[:7], header[100], header[101] = b"PMTiles", minzoom, maxzoom
    path.write_bytes(bytes(header))


SQUARE = {
    "type": "Polygon",
    "coordinates": [[[7, 47], [8, 47], [8, 49], [7, 49], [7, 47]]],
}


@pytest.fixture
def folder(tmp_path, monkeypatch):
    index = tmp_path / "index.json"
    regions = [
        ("europe", "Europe", None),
        ("france", "France", "europe"),
        ("alsace", "Alsace", "france"),
        ("luxembourg", "Luxembourg", "europe"),
        ("aquitaine", "Aquitaine", "france"),
        ("corse", "Corse", "france"),
    ]
    index.write_text(
        json.dumps(
            {
                "features": [
                    {
                        "properties": {
                            "id": i,
                            "name": n,
                            **({"parent": p} if p else {}),
                        },
                        "geometry": SQUARE,
                    }
                    for i, n, p in regions
                ]
            }
        )
    )
    basemap = tmp_path / "basemap"
    basemap.mkdir()
    pmtiles(basemap / "world.sat-overview.pmtiles", 0, 8)
    pmtiles(basemap / "world.pmtiles", 0, 8)  # the world's background map zoomed out
    pmtiles(basemap / "france.sat-regional.pmtiles", 5, 11)
    pmtiles(basemap / "fr-67.sat-detailed-fr_ign.pmtiles", 12, 17)
    pmtiles(basemap / "luxembourg.sat-regional.pmtiles", 7, 11)
    ran = []

    def run(command, **kwargs):
        ran.append(command[3:])
        assert kwargs["env"][maps.LOCK_ENV] == str(basemap)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(maps.subprocess, "run", run)
    # Protomaps' latest world map, and a background map's size: no network here.
    monkeypatch.setattr(
        maps.extract, "latest_build", lambda: ("20261110.pmtiles", 140 * 10**9)
    )
    monkeypatch.setattr(
        maps.extract, "size", lambda folder, build, outline, maxzoom=None: 5 * 10**9
    )
    monkeypatch.setattr(
        maps.shutil, "disk_usage", lambda p: type("U", (), {"free": 10**13})()
    )
    folder = {"dir": basemap, "index": str(index), "ran": ran}
    return folder


def menu(folder, typed, *more):
    with pytest.MonkeyPatch.context() as m:
        m.setattr("sys.stdin", io.StringIO(typed))
        try:
            s.main(
                [
                    "maps",
                    "--basemap-dir",
                    str(folder["dir"]),
                    "--index",
                    folder["index"],
                    "--region",
                    "alsace",
                    *more,
                ]
            )
        except SystemExit as stop:
            return stop.code
    return 0


def test_home_shows_what_is_there(folder, capsys):
    menu(folder, "\n")
    shown = capsys.readouterr().err
    assert "World        Blue Marble 500 m   0–8" in shown
    assert (
        "IGN 20 cm" in shown and "1/9 départements" in shown
    )  # only Alsace in this index
    assert "1 Add   2 Remove   3 Settings      Enter: quit" in shown


def test_add_ign_departements(folder, capsys):
    # Add → Alsace → IGN → zoom 17 (Enter) → Haut-Rhin is the one left → start.
    menu(folder, "1\n1\n3\n\ny\n\n")
    shown = capsys.readouterr().err
    assert "Sentinel-2 10 m" in shown and "— (covered by France)" in shown
    assert "1/2" in shown and "1 left" in shown
    assert "IGN 20 cm, Haut-Rhin, z17" in shown
    (argv,) = folder["ran"]
    assert argv[:5] == ["bdortho", "--dept", "68", "--maxzoom", "17"]
    assert not (folder["dir"] / maps.QUEUE).exists()  # all done


def test_departements_by_code_and_a_list(folder, capsys):
    # Add → France → IGN → zoom 18 (Bas-Rhin is there to 17 only) → the list.
    menu(folder, "1\n2\n3\n18\n?\n2a 33 99\n33 2a\ny\n\n")
    shown = capsys.readouterr().err
    assert "  67 Bas-Rhin" in shown and "Not offered: 99" in shown
    (argv,) = folder["ran"]
    # The largest first: Gironde before Corse-du-Sud.
    assert argv[:6] == ["bdortho", "--dept", "33", "2A", "--maxzoom", "18"]


def test_a_stopped_download_is_resumed(folder, capsys, monkeypatch):
    def fail(command, **kwargs):
        folder["ran"].append(command[3:])
        return subprocess.CompletedProcess(command, 76)

    monkeypatch.setattr(maps.subprocess, "run", fail)
    assert menu(folder, "1\n1\n3\n\ny\n\n") == 0
    assert "Stopped (76)" in capsys.readouterr().err
    assert (
        json.loads((folder["dir"] / maps.QUEUE).read_text())[0]["argv"][0] == "bdortho"
    )
    assert menu(folder, "", "--resume", "--yes") == 76
    assert folder["ran"][0] == folder["ran"][1]


def test_sentinel_where_photos_take_over_and_blue_marble_with_it(folder, capsys):
    (folder["dir"] / "world.sat-overview.pmtiles").unlink()
    (folder["dir"] / "france.sat-regional.pmtiles").unlink()
    # Add → France → Sentinel-2: to 11 (IGN from 12), no zoom question.
    menu(folder, "1\n2\n2\ny\n\n")
    shown = capsys.readouterr().err
    assert "to 11 (IGN from 12)" in shown
    assert [a[0] for a in folder["ran"]] == ["overview", "regional"]
    assert folder["ran"][1][folder["ran"][1].index("--maxzoom") + 1] == "11"


def test_remove_what_could_be_freed(folder, capsys):
    # Alsace's Sentinel-2, inside France's to the same zoom.
    pmtiles(folder["dir"] / "alsace.sat-regional.pmtiles", 7, 11)
    menu(folder, "2\n3\ny\n\n")  # World: Blue Marble, background map; then Alsace
    shown = capsys.readouterr().err
    assert "could free 127 B: covered by france" in shown
    assert not (folder["dir"] / "alsace.sat-regional.pmtiles").exists()
    assert (folder["dir"] / "france.sat-regional.pmtiles").exists()


def test_settings_are_asked_once(folder):
    menu(folder, "3\n1\n10\n2\n18\n\n\n")
    assert inventory.settings(folder["dir"]) == {"max_rate": 10, "zoom": 18}


def test_no_questions(folder):
    menu(
        folder, "", "--source", "fr_ign", "--units", "33", "40", "--zoom", "17", "--yes"
    )
    (argv,) = folder["ran"]
    assert argv[:6] == ["bdortho", "--dept", "33", "40", "--maxzoom", "17"]


def test_one_download_at_a_time(folder, capsys):
    with inventory.lock(folder["dir"], "IGN 3 départements"):
        menu(folder, "", "--source", "fr_ign", "--yes")
    assert "Another download is running: IGN 3 départements" in capsys.readouterr().err
    assert folder["ran"] == []


def test_build_region_asks_first_and_downloads_after(folder, capsys):
    # During the build's questions: queued, nothing run.
    menu(folder, "1\n1\n3\n\ny\n\n", "--queue-only")
    assert "Download it after the build?" in capsys.readouterr().err
    assert folder["ran"] == []
    # Asked twice: queued once.
    menu(folder, "1\n1\n3\n\ny\n\n", "--queue-only")
    assert len(json.loads((folder["dir"] / maps.QUEUE).read_text())) == 1
    # After the build.
    menu(folder, "", "--queued", "--yes")
    assert [a[:3] for a in folder["ran"]] == [["bdortho", "--dept", "68"]]
    assert not (folder["dir"] / maps.QUEUE).exists()


def background_map(folder, area, build):
    pmtiles(folder["dir"] / f"{area}.pmtiles", 0, 15)
    (folder["dir"] / f"{area}.json").write_text(
        json.dumps({"build": f"{build}.pmtiles"})
    )


def test_a_background_map_full_detail_with_its_edition(folder, capsys):
    # Add → France → Background map (4th): no detail question, straight to the plan.
    menu(folder, "1\n2\n4\ny\n\n")
    shown = capsys.readouterr().err
    assert "z0–15, 2026-11-10" in shown
    assert "Background map, France, z0–15 (2026-11-10)" in shown and "5.0 GB" in shown
    # Then its large buildings are found, for showing them zoomed out.
    argv, after = folder["ran"]
    assert argv[:5] == ["basemap", "--area", "france", "--build", "20261110.pmtiles"]
    assert "--outline" in argv and after == ["large-buildings"]


def test_a_background_map_again_only_when_newer(folder, capsys):
    background_map(folder, "france", "20261014")
    menu(folder, "1\n2\n\n\n")
    assert "2026-10-14   newer: 2026-11-10" in capsys.readouterr().err
    background_map(folder, "france", "20261110")
    menu(folder, "1\n2\n4\n\n\n")
    shown = capsys.readouterr().err
    assert "— (the latest)" in shown and "Nothing to add there." in shown
    # Alsace, inside France.
    menu(folder, "1\n1\n\n\n")
    assert "— (covered by France)" in capsys.readouterr().err


def test_the_worlds_background_map_is_protomaps_file(folder, capsys):
    (folder["dir"] / "world.pmtiles").unlink()
    menu(
        folder, "1\n4\n18\ny\n\n"
    )  # Add → World → Background map, all zooms (the last)
    argv, after = folder["ran"]
    assert after == ["large-buildings"]
    assert argv[:3] == ["basemap", "--area", "world"] and "--outline" not in argv
    assert argv[argv.index("--size") + 1] == str(140 * 10**9)
    assert "140 GB" in capsys.readouterr().err


def test_no_network_no_background_map_offered(folder, capsys, monkeypatch):
    monkeypatch.setattr(maps.extract, "latest_build", lambda: None)
    menu(folder, "1\n2\n4\n\n\n")
    shown = capsys.readouterr().err
    assert "can't reach Protomaps" in shown and "Nothing to add there." in shown


def test_the_world_zoomed_out_like_blue_marble(folder, capsys):
    (folder["dir"] / "world.pmtiles").unlink()
    # Add → World → the background map to zoom 8: every country's borders and names.
    menu(folder, "1\n4\n17\ny\n\n")
    (argv,) = folder["ran"]  # zoom 8 has no buildings: no large buildings step
    assert argv[:3] == ["basemap", "--area", "world"]
    assert argv[argv.index("--maxzoom") + 1] == "8" and "--outline" not in argv
    assert "Background map, World, z0–8" in capsys.readouterr().err
    # Once there, the full world is still offered ("all zooms"); zoom 8 isn't again.
    pmtiles(folder["dir"] / "world.pmtiles", 0, 8)
    (folder["dir"] / "world.json").write_text(json.dumps({"build": "20261110.pmtiles"}))
    menu(folder, "1\n4\n\n\n")
    shown = capsys.readouterr().err
    assert "all zooms, 2026-11-10" in shown
    assert re.search(r"zoomed out \(to 8\) +z0–8 +—", shown)


def test_the_world_zoomed_out_comes_with_anything(folder, capsys):
    # Like Blue Marble with imagery: every country's borders and names, once.
    (folder["dir"] / "world.pmtiles").unlink()
    menu(folder, "", "--source", "fr_ign", "--units", "33", "--zoom", "17", "--yes")
    first, then = folder["ran"]
    assert first[:3] == ["basemap", "--area", "world"] and "--maxzoom" in first
    assert then[0] == "bdortho"
