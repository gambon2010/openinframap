"""src/fork/terrain: the elevation tiles of every area downloaded, each from the
first file that has it."""

import pytest
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.fork import terrain
from src.fork.terrain import files


def make(path, tiles: dict[tuple[int, int, int], bytes]) -> None:
    """A small terrain file (WebP tiles, uncompressed, as Mapterhorn's)."""
    with path.open("wb") as f:
        writer = Writer(f)
        for zxy, data in sorted(tiles.items(), key=lambda kv: zxy_to_tileid(*kv[0])):
            writer.write_tile(zxy_to_tileid(*zxy), data)
        zooms = [z for z, _, _ in tiles]
        writer.finalize(
            {
                "tile_type": TileType.WEBP,
                "tile_compression": Compression.NONE,
                "min_zoom": min(zooms),
                "max_zoom": max(zooms),
                "min_lon_e7": 0,
                "min_lat_e7": 0,
                "max_lon_e7": 10_000_000,
                "max_lat_e7": 10_000_000,
                "center_zoom": 0,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {},
        )


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(files, "TERRAIN_FILES", files.TerrainFiles(tmp_path))
    return TestClient(Starlette(routes=terrain.routes)), tmp_path


def test_each_tile_from_the_area_that_has_it(client):
    client, folder = client
    make(folder / "france.terrain.pmtiles", {(5, 16, 11): b"france"})
    make(folder / "luxembourg.terrain.pmtiles", {(5, 16, 10): b"lux"})
    make(folder / "france.pmtiles", {(5, 16, 9): b"a background map"})  # not terrain
    response = client.get("/terrain/5/16/11.webp")
    assert (response.status_code, response.content) == (200, b"france")
    assert response.headers["content-type"] == "image/webp"
    assert client.get("/terrain/5/16/10.webp").content == b"lux"
    assert client.get("/terrain/5/16/9.webp").status_code == 204
    assert client.get("/terrain/5/40/0.webp").status_code == 404  # not a tile


def test_not_modified_while_the_files_are_the_same(client):
    client, folder = client
    make(folder / "france.terrain.pmtiles", {(5, 16, 11): b"france"})
    etag = client.get("/terrain/5/16/11.webp").headers["etag"]
    assert client.get("/terrain/5/16/11.webp", headers={"If-None-Match": etag}).status_code == 304
    make(folder / "france.terrain.pmtiles", {(5, 16, 11): b"rebuilt", (5, 16, 12): b"more"})
    assert client.get("/terrain/5/16/11.webp", headers={"If-None-Match": etag}).content == b"rebuilt"
