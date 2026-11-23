"""src/fork/imagery.py: the imagery list the scripts write, served as it is, and
the imagery files' tiles."""

import json

from pmtiles.tile import Compression, TileType
from pmtiles.writer import Writer
from pmtiles.tile import zxy_to_tileid
from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.fork import imagery
from src.fork.pmtiles_files import ArchiveFolder


def test_the_list_as_written_or_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(imagery, "IMAGERY_LIST", tmp_path / "imagery.json")
    client = TestClient(Starlette(routes=imagery.routes))
    assert client.get("/imagery").json() == []  # none yet
    listed = [{"file": "world.sat-overview", "format": "jpg", "minzoom": 0, "maxzoom": 8}]
    (tmp_path / "imagery.json").write_text(json.dumps(listed))
    assert client.get("/imagery").json() == listed
    (tmp_path / "imagery.json").write_text("half writ")
    assert client.get("/imagery").json() == []  # unreadable: none


def write_imagery(path, tile: bytes):
    """An imagery file with one JPEG tile, at zoom 1 (1, 0)."""
    with path.open("wb") as f:
        writer = Writer(f)
        writer.write_tile(zxy_to_tileid(1, 1, 0), tile)
        writer.finalize(
            {
                "tile_type": TileType.JPEG,
                "tile_compression": Compression.NONE,
                "min_zoom": 1,
                "max_zoom": 1,
                "min_lon_e7": -1800000000,
                "min_lat_e7": -850000000,
                "max_lon_e7": 1800000000,
                "max_lat_e7": 850000000,
                "center_zoom": 1,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {},
        )


def test_a_files_tiles(tmp_path, monkeypatch):
    monkeypatch.setattr(imagery, "OFFLINE_MAPS_DIR", tmp_path)
    monkeypatch.setattr(imagery, "IMAGERY_FILES", ArchiveFolder(tmp_path, lambda p: ".sat-" in p.name))
    write_imagery(tmp_path / "lux.sat-regional.pmtiles", b"\xff\xd8 a photo")
    client = TestClient(Starlette(routes=imagery.routes))

    found = client.get("/satellite/lux.sat-regional/1/1/0.jpg")
    assert found.status_code == 200
    assert found.content == b"\xff\xd8 a photo"
    assert found.headers["content-type"] == "image/jpeg"
    assert "content-encoding" not in found.headers
    again = client.get(
        "/satellite/lux.sat-regional/1/1/0.jpg", headers={"if-none-match": found.headers["etag"]}
    )
    assert again.status_code == 304

    assert client.get("/satellite/lux.sat-regional/1/0/0.jpg").status_code == 204  # not in it
    assert client.get("/satellite/lux.sat-regional/1/5/0.jpg").status_code == 404  # no such tile
    assert client.get("/satellite/other.sat-regional/1/1/0.jpg").status_code == 404
    assert client.get("/satellite/..%2Flux.sat-regional/1/1/0.jpg").status_code == 404
