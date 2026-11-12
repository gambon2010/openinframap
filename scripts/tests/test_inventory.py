"""scripts/satimagery/inventory.py (what's in data/basemap/, the lock, the
settings) and coverage.py (what's worth offering)."""

import json
import os

import pytest

from satimagery import coverage, inventory
from satimagery.departements import DEPARTEMENTS
from satimagery.sources import SENTINEL2, SOURCES

# A small Geofabrik tree: the départements' regions in France, France in Europe.
PARENTS = {d[3]: "france" for d in DEPARTEMENTS.values()} | {
    "france": "europe",
    "luxembourg": "europe",
    "germany": "europe",
    "bayern": "germany",
    "spain": "europe",
}


def within(a, b):
    while a:
        if a == b:
            return True
        a = PARENTS.get(a)
    return False


def pmtiles(path, minzoom, maxzoom, size=127):
    header = bytearray(size)
    header[:7], header[100], header[101] = b"PMTiles", minzoom, maxzoom
    path.write_bytes(bytes(header))


def test_files_are_known_by_their_names():
    assert inventory.identify("world.sat-overview.pmtiles") == (
        "blue_marble",
        "world",
        "",
    )
    assert inventory.identify("france.sat-regional.pmtiles") == (
        "sentinel2",
        "france",
        "",
    )
    assert inventory.identify("fr-67.sat-detailed-fr_ign.pmtiles") == (
        "fr_ign",
        "france",
        "67",
    )
    assert inventory.identify("fr-2a.sat-detailed-fr_ign.pmtiles")[2] == "2A"
    assert inventory.identify("bayern.sat-detailed-de_bayern.pmtiles") == (
        "de_bayern",
        "bayern",
        "",
    )
    assert inventory.identify("luxembourg.pmtiles") == ("protomaps", "luxembourg", "")
    for other in (
        "x.sat-detailed-nope.pmtiles",
        ".partial.pmtiles",
        "a.json",
        "a.b.pmtiles",
    ):
        assert inventory.identify(other) is None


def test_the_inventory_is_made_from_the_files(tmp_path):
    pmtiles(tmp_path / "world.sat-overview.pmtiles", 0, 8)
    pmtiles(tmp_path / "fr-67.sat-detailed-fr_ign.pmtiles", 12, 17, 1000)
    (tmp_path / "broken.pmtiles").write_bytes(b"not one")
    # Gironde stopped half-way: the server blocked the computer.
    work = tmp_path / ".bdortho-33"
    work.mkdir()
    (
        work / "BDORTHO_2-0_RVB-0M20_JP2-E080_LAMB93_D033_2024-01-01.7z.001.part"
    ).write_bytes(b"x" * 300)
    (work / "stopped").write_text("server blocked\n")
    for f in work.iterdir():  # nothing written there lately
        os.utime(f, (1, 1))
    entries = inventory.load(tmp_path)
    by_file = {e.file: e for e in entries}
    assert set(by_file) == {
        "world.sat-overview.pmtiles",
        "fr-67.sat-detailed-fr_ign.pmtiles",
        ".bdortho-33",
    }
    ign = by_file["fr-67.sat-detailed-fr_ign.pmtiles"]
    assert (ign.source, ign.area, ign.unit, ign.zooms, ign.bytes) == (
        "fr_ign",
        "france",
        "67",
        [12, 17],
        1000,
    )
    job = by_file[".bdortho-33"]
    assert (job.status, job.reason, job.unit, job.have, job.edition) == (
        "stopped",
        "server blocked",
        "33",
        300,
        "2024-01-01",
    )
    assert job.of == DEPARTEMENTS["33"][1] * SOURCES["fr_ign"].read_per_km2
    assert json.loads((tmp_path / "inventory.json").read_text())


def test_a_job_written_to_lately_is_running(tmp_path):
    # Started without the lock (before there was one): a second download there
    # would spoil both, so it isn't offered to resume.
    (tmp_path / ".bdortho-33").mkdir()
    (tmp_path / ".bdortho-33" / "a.7z.001.part").write_bytes(b"x")
    assert inventory.scan(tmp_path)[0].status == "running"


def test_notes_are_kept_and_files_gone_are_dropped(tmp_path):
    pmtiles(tmp_path / "fr-67.sat-detailed-fr_ign.pmtiles", 12, 17)
    pmtiles(tmp_path / "fr-75.sat-detailed-fr_ign.pmtiles", 12, 17)
    inventory.load(tmp_path)
    inventory.record(
        tmp_path, "fr-67.sat-detailed-fr_ign.pmtiles", edition="2024-01-01"
    )
    (tmp_path / "fr-75.sat-detailed-fr_ign.pmtiles").unlink()
    entries = inventory.load(tmp_path)
    assert [(e.unit, e.edition) for e in entries] == [("67", "2024-01-01")]


def test_one_download_at_a_time(tmp_path):
    assert inventory.running(tmp_path) is None
    with inventory.lock(tmp_path, "IGN 2 départements to zoom 17"):
        assert "IGN 2 départements" in inventory.running(tmp_path)
        with (
            pytest.raises(inventory.Busy, match="IGN 2"),
            inventory.lock(tmp_path, "another"),
        ):
            pass
        # A job's work folder shows as running meanwhile.
        (tmp_path / ".bdortho-67").mkdir()
        assert inventory.scan(tmp_path)[0].status == "running"
    assert inventory.running(tmp_path) is None


def test_settings_are_kept(tmp_path):
    assert inventory.settings(tmp_path) == {"max_rate": None, "zoom": 17}
    inventory.save_settings(tmp_path, {"max_rate": 10})
    assert inventory.settings(tmp_path) == {"max_rate": 10, "zoom": 17}


# --- Coverage ------------------------------------------------------------------------


def test_sentinel_stops_where_aerial_photos_take_over():
    top = coverage.top_zoom(SENTINEL2, "france", within)
    assert (top.zoom, top.why) == (11, "IGN from 12")
    assert coverage.top_zoom(SENTINEL2, "alsace", within).zoom == 11
    assert coverage.top_zoom(SENTINEL2, "bayern", within).zoom == 11
    # Germany as a whole: Bavaria's photos cover only part of it.
    assert coverage.top_zoom(SENTINEL2, "germany", within).zoom == 13
    assert coverage.top_zoom(SENTINEL2, "world", within).zoom == 13
    assert coverage.top_zoom(SOURCES["blue_marble"], "france", within).zoom == 8
    touching = {s.id for s in coverage.aerial_touching("germany", within)}
    assert "de_bayern" in touching and "fr_ign" not in touching


def entry(source, area, zooms, unit="", size=1000):
    return inventory.Entry(source, area, f"{area}-{unit}", unit, zooms, size)


def test_an_area_inside_one_already_there():
    have = [entry("sentinel2", "france", [7, 11])]
    assert coverage.covered_by(SENTINEL2, "alsace", 11, have, within).area == "france"
    assert coverage.covered_by(SENTINEL2, "alsace", 13, have, within) is None
    assert coverage.covered_by(SENTINEL2, "spain", 11, have, within) is None


def test_what_could_be_freed():
    have = [
        entry("sentinel2", "europe", [7, 13]),
        entry("sentinel2", "luxembourg", [7, 12]),
        entry("sentinel2", "france", [5, 13], size=512_000_000),
    ]
    freed = coverage.could_free(have, within)
    # Luxembourg's and France's own: Europe's covers them.
    assert {(f.entry.area, f.why) for f in freed} == {
        ("luxembourg", "covered by europe"),
        ("france", "covered by europe"),
    }
    # France alone: its zooms 12–13 only once IGN's photos are there everywhere.
    france = [have[2]]
    ign = [entry("fr_ign", "france", [12, 17], code) for code in DEPARTEMENTS]
    assert coverage.could_free(france + ign[:2], within) == []
    (freed,) = coverage.could_free(france + ign, within)
    assert freed.why == "zooms 12–13: IGN there"
    assert 470_000_000 < freed.bytes < 490_000_000
