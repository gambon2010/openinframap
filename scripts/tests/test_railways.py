"""scripts/offline_maps/railways.py: an area's railway lines cut out of its
OpenStreetMap extract (the build's, or downloaded) with osmium."""

import pytest

from offline_maps import railways


@pytest.fixture
def ran(monkeypatch):
    calls = []
    monkeypatch.setattr(
        railways.docker, "run_service", lambda *a, **k: calls.append((a, k))
    )
    return calls


def test_the_railways_cut_out_of_the_builds_extract(tmp_path, monkeypatch, ran):
    osm = tmp_path / "osm"
    osm.mkdir()
    (osm / "france-latest.osm.pbf").write_bytes(b"extract")
    maps = tmp_path / "offline-maps"
    maps.mkdir()
    monkeypatch.setattr(railways, "OSM_DIR", osm)
    railways.make_railways(maps, "france")
    ((service, args, mount), kwargs) = ran[0]
    assert service == "osmium" and mount == tmp_path and kwargs["at"] == "/w"
    assert args[:3] == ["osmium", "tags-filter", "/w/osm/france-latest.osm.pbf"]
    assert args[3] == "w/railway=" + ",".join(railways.KINDS)
    assert args[4] == "r/route=" + ",".join(railways.ROUTES)
    assert args[5:7] == ["-o", "/w/offline-maps/france.railways.osm.pbf"]


def test_the_extract_downloaded_when_the_build_left_none(tmp_path, monkeypatch):
    got = []
    monkeypatch.setattr(railways, "OSM_DIR", tmp_path)
    monkeypatch.setattr(
        railways.Index, "pbf_url", lambda self, area: f"https://x/{area}.osm.pbf"
    )
    monkeypatch.setattr(
        railways.netsafe, "fetch_file", lambda url, path, **k: got.append((url, path))
    )
    assert railways.osm_extract("luxembourg") == tmp_path / "luxembourg-latest.osm.pbf"
    assert got == [
        ("https://x/luxembourg.osm.pbf", tmp_path / "luxembourg-latest.osm.pbf")
    ]


def test_no_extract_known_stops(tmp_path, monkeypatch):
    monkeypatch.setattr(railways, "OSM_DIR", tmp_path)
    monkeypatch.setattr(railways.Index, "pbf_url", lambda self, area: None)
    with pytest.raises(SystemExit):
        railways.osm_extract("atlantis")
