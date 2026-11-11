"""src/fork/background: the background map's tiles, each from the first file that
has it (several areas shown together; a border tile in two files sent once)."""

import gzip
import json
import os

import pytest
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer
from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.fork import background


def make(path, tiles: dict[tuple[int, int, int], bytes], build: str = "") -> None:
    """A small background map file (gzip tiles, as Protomaps' are) and its manifest."""
    with path.open("wb") as f:
        writer = Writer(f)
        for zxy, data in sorted(tiles.items(), key=lambda kv: zxy_to_tileid(*kv[0])):
            writer.write_tile(zxy_to_tileid(*zxy), gzip.compress(data))
        zooms = [z for z, _, _ in tiles]
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
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
    if build:
        path.with_suffix(".json").write_text(json.dumps({"build": f"{build}.pmtiles"}))


@pytest.fixture
def client(tmp_path, monkeypatch):
    archives = background.Archives(tmp_path)
    monkeypatch.setattr(background, "ARCHIVES", archives)
    return TestClient(Starlette(routes=background.routes)), tmp_path


def got(client, z, x, y):
    response = client.get(f"/background/{z}/{x}/{y}.mvt")
    return response.status_code, response.content


def test_each_tile_from_the_file_that_has_it(client):
    client, folder = client
    make(folder / "france.pmtiles", {(5, 16, 11): b"france", (5, 16, 12): b"border-old"}, "20261014")
    make(folder / "luxembourg.pmtiles", {(5, 16, 12): b"border-new", (5, 17, 12): b"lux"}, "20261110")
    # Sent as stored: gzip, said so (the browser unpacks it).
    assert got(client, 5, 16, 11) == (200, b"france")
    assert got(client, 5, 17, 12) == (200, b"lux")
    # In both: once, from the newest edition.
    assert got(client, 5, 16, 12) == (200, b"border-new")
    # In none: an empty tile, never kept by the browser (the area may come later).
    assert got(client, 5, 0, 0)[0] == 204
    assert client.get("/background/5/0/0.mvt").headers["cache-control"] == "no-store"
    assert "max-age" in client.get("/background/5/16/11.mvt").headers["cache-control"]
    assert got(client, 9, 0, 0)[0] == 204  # beyond every file's zooms
    assert got(client, 5, 40, 0)[0] == 404  # not a tile


def test_the_world_is_the_last_resort(client):
    client, folder = client
    make(folder / "world.pmtiles", {(5, 16, 11): b"world", (5, 1, 1): b"sea"}, "20261111")
    make(folder / "france.pmtiles", {(5, 16, 11): b"france"}, "20261014")
    assert got(client, 5, 16, 11) == (200, b"france")
    assert got(client, 5, 1, 1) == (200, b"sea")


def test_imagery_and_partial_downloads_are_left_out(client):
    client, folder = client
    make(folder / "france.sat-regional.pmtiles", {(5, 16, 11): b"imagery"})
    make(folder / ".france.partial.pmtiles", {(5, 16, 11): b"half"})
    (folder / "broken.pmtiles").write_bytes(b"not one")
    assert got(client, 5, 16, 11)[0] == 204


def test_a_file_added_or_replaced_is_picked_up(client):
    client, folder = client
    assert got(client, 5, 16, 11)[0] == 204
    make(folder / "france.pmtiles", {(5, 16, 11): b"first"})
    assert got(client, 5, 16, 11) == (200, b"first")
    replaced = folder / ".new.pmtiles"
    make(replaced, {(5, 16, 11): b"second!"})
    os.replace(replaced, folder / "france.pmtiles")  # as extract.py finishes one
    assert got(client, 5, 16, 11) == (200, b"second!")


def test_a_big_file_with_leaf_directories(client):
    client, folder = client
    # Enough tiles that the index is split into leaves.
    tiles = {(10, x, y): f"{x},{y}".encode() for x in range(0, 120) for y in range(0, 120)}
    make(folder / "big.pmtiles", tiles)
    assert got(client, 10, 77, 33) == (200, b"77,33")
    assert got(client, 10, 500, 500)[0] == 204
