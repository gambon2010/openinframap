"""scripts/satimagery/maps.py: the offline maps menu, driven by typed answers in a
temporary data/basemap/ (the downloads it starts are recorded, not run)."""

import io
import json
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
    pmtiles(basemap / "france.sat-regional.pmtiles", 5, 11)
    pmtiles(basemap / "fr-67.sat-detailed-fr_ign.pmtiles", 12, 17)
    pmtiles(basemap / "luxembourg.sat-regional.pmtiles", 7, 11)
    ran = []

    def run(command, **kwargs):
        ran.append(command[3:])
        assert kwargs["env"][maps.LOCK_ENV] == str(basemap)
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(maps.subprocess, "run", run)
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
    menu(folder, "2\n2\ny\n\n")
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
