"""src/fork/background/buildings.py: a building's exact outline, joined from the
background maps' zoom 15 tiles."""

import gzip
import math

import mapbox_vector_tile  # type: ignore[import-untyped]
import pytest
from pmtiles.tile import zxy_to_tileid
from shapely.geometry import shape
from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.fork import background
from src.fork.background import buildings

# Two zoom 15 tiles side by side in Paris; a big building across their edge, cut
# in two (each piece 64 units over the edge, as Protomaps' are), and a small one.
X, Y = 16596, 11273


def z15_tile(*features) -> bytes:
    return gzip.compress(
        mapbox_vector_tile.encode(
            [{"name": "buildings", "features": list(features)}], default_options={"y_coord_down": True}
        )
    )


def square(i, x0, y0, x1, y1, kind="building", height=12):
    return {
        "id": i,
        "geometry": f"POLYGON(({x0} {y0},{x1} {y0},{x1} {y1},{x0} {y1},{x0} {y0}))",
        "properties": {"kind": kind, "height": height},
    }


@pytest.fixture
def tiles(tmp_path, monkeypatch):
    from pmtiles.tile import Compression, TileType
    from pmtiles.writer import Writer

    data = {
        (X, Y): z15_tile(square(1, 3000, 1000, 4160, 2000), square(2, 100, 100, 150, 150)),
        (X + 1, Y): z15_tile(square(1, -64, 1000, 1000, 2000)),
    }
    path = tmp_path / "paris.pmtiles"
    with path.open("wb") as f:
        writer = Writer(f)
        for (x, y), tile in sorted(data.items(), key=lambda kv: zxy_to_tileid(15, *kv[0])):
            writer.write_tile(zxy_to_tileid(15, x, y), tile)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": 15,
                "max_zoom": 15,
                "min_lon_e7": 0,
                "min_lat_e7": 0,
                "max_lon_e7": 0,
                "max_lat_e7": 0,
                "center_zoom": 15,
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {},
        )
    archives = background.Archives(tmp_path)
    monkeypatch.setattr(background, "ARCHIVES", archives)
    monkeypatch.setattr(buildings, "ARCHIVES", archives)
    return TestClient(Starlette(routes=buildings.routes))


def test_a_buildings_exact_outline(tiles):
    n = 2**15
    lon = (X + 3500 / 4096) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (Y + 1500 / 4096) / n))))
    answer = tiles.get("/background/building/1", params={"lon": lon, "lat": lat}).json()
    outline = shape(answer["geometry"])
    assert outline.geom_type == "Polygon"
    west, _, east, _ = outline.bounds
    assert west == pytest.approx((X + 3000 / 4096) / n * 360 - 180, abs=1e-6)
    assert east == pytest.approx((X + 1 + 1000 / 4096) / n * 360 - 180, abs=1e-6)
    assert tiles.get("/background/building/7", params={"lon": lon, "lat": lat}).status_code == 404


def test_a_cut_that_leaves_a_line_keeps_the_area():
    from shapely.geometry import box as b

    # A piece that just touches the tile's edge as well: only its area is kept.
    piece = buildings.area_only(b(4000, 100, 4096, 200).union(b(4096, 300, 4200, 300.0001)))
    assert piece.geom_type == "Polygon" and piece.area == 96 * 100
