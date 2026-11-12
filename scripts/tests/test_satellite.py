"""scripts/satellite.py: tile maths, outlines, estimates, MBTiles and downloads."""

import dataclasses
import http.server
import sqlite3
import threading
from typing import ClassVar

import pytest

import netsafe
import satellite as s

LUXEMBOURG = [
    [(5.73, 49.45), (6.53, 49.45), (6.53, 50.18), (5.73, 50.18), (5.73, 49.45)]
]


def test_tile_of_and_bounds_agree():
    for lon, lat, z in [
        (7.75, 48.58, 12),
        (-73.98, 40.75, 9),
        (0.0, 0.0, 3),
        (179.9, -60, 5),
    ]:
        x, y = s.tile_of(lon, lat, z)
        west, south, east, north = s.tile_bounds(x, y, z)
        assert west <= lon < east and south <= lat <= north


def test_tile_of_clamps_to_the_world():
    assert s.tile_of(180, 89.9, 2) == (3, 0)
    assert s.tile_of(-180, -89.9, 2) == (0, 3)


def test_tiles_in_bbox():
    assert len(list(s.tiles_in_bbox((-180, -85, 180, 85), 2))) == 16


def test_outline_rings_from_geojson_kinds():
    polygon = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}
    multi = {
        "type": "MultiPolygon",
        "coordinates": [polygon["coordinates"], polygon["coordinates"]],
    }
    assert len(s.outline_rings(polygon)) == 1
    assert len(s.outline_rings(multi)) == 2
    assert len(s.outline_rings({"type": "Feature", "geometry": polygon})) == 1
    assert (
        len(
            s.outline_rings(
                {"type": "FeatureCollection", "features": [{"geometry": multi}]}
            )
        )
        == 2
    )
    assert s.outline_rings({"type": "Point", "coordinates": [0, 0]}) == []


def test_point_in_rings():
    assert s.point_in_rings(6.1, 49.6, LUXEMBOURG)
    assert not s.point_in_rings(7.75, 48.58, LUXEMBOURG)


def test_box_touches_rings():
    assert s.box_touches_rings((6.0, 49.0, 7.0, 50.0), LUXEMBOURG)  # overlaps
    assert s.box_touches_rings((5.0, 49.0, 8.0, 51.0), LUXEMBOURG)  # contains it
    assert not s.box_touches_rings((10.0, 49.0, 11.0, 50.0), LUXEMBOURG)


def test_worldcover_cells_and_urls():
    assert s.worldcover_cells(LUXEMBOURG) == [
        "N49E005",
        "N49E006",
        "N50E005",
        "N50E006",
    ]
    assert s.worldcover_cells(
        [[(-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5), (-0.5, -0.5)]]
    ) == [
        "S01W001",
        "S01E000",
        "N00W001",
        "N00E000",
    ]
    assert s.worldcover_url("N49E006").endswith(
        "/N49/ESA_WorldCover_10m_2021_v200_N49E006_S2RGBNIR.tif"
    )


def test_area_km2():
    # Luxembourg's bounding box: about 59 km × 81 km.
    assert 4500 < s.area_km2(LUXEMBOURG) < 5200


def test_tiles_in_outline_skip_tiles_outside():
    inside = s.tiles_in_outline(LUXEMBOURG, 10)
    bbox = list(s.tiles_in_bbox(s.rings_bbox(LUXEMBOURG), 10))
    assert 0 < len(inside) <= len(bbox)
    triangle = [[(5.73, 49.45), (6.53, 49.45), (5.73, 50.18), (5.73, 49.45)]]
    assert len(s.tiles_in_outline(triangle, 12)) < len(
        list(s.tiles_in_bbox(s.rings_bbox(triangle), 12))
    )


def test_regional_pipeline():
    script = s.regional_pipeline(12)
    assert "-input_file_list cells.txt" in script
    assert "-cutline area.geojson" in script
    assert "ZOOM_LEVEL_STRATEGY=LOWER" in script
    # Lower zooms down to the tier's first (7): zooms 11 to 7.
    assert script.endswith("gdaladdo -q -r average regional.mbtiles 2 4 8 16 32")
    assert "38.218514" in script  # metres per pixel at zoom 12
    assert s.regional_pipeline(13).endswith("2 4 8 16 32 64")
    # The whole world: not cut.
    world = s.regional_pipeline(9, cut=False)
    assert "-cutline" not in world and "-te -20037508.34" in world
    assert world.endswith("2 4")


def test_mbtiles_rows_are_tms(tmp_path):
    out = tmp_path / "t.mbtiles"
    writer = s.MBTiles(out, "test", "jpg", 0, 2, "me", (0, 0, 1, 1))
    writer.put(2, 1, 0, b"top row")
    writer.close()
    db = sqlite3.connect(out)
    assert db.execute(
        "SELECT zoom_level, tile_column, tile_row, tile_data FROM tiles"
    ).fetchall() == [(2, 1, 3, b"top row")]
    meta = dict(db.execute("SELECT name, value FROM metadata").fetchall())
    assert meta["format"] == "jpg" and meta["maxzoom"] == "2"


class TileServer(http.server.BaseHTTPRequestHandler):
    """Tiles at /z/x/y; none (404) where x is odd."""

    requests: ClassVar[list[str]] = []

    def do_GET(self):
        TileServer.requests.append(self.path)
        z, x, y = (int(v) for v in self.path.strip("/").split("/"))
        if x % 2:
            self.send_response(404)
            self.end_headers()
            return
        body = f"{z}/{x}/{y}".encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def tile_server():
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), TileServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}/{{z}}/{{x}}/{{y}}"
    server.shutdown()


def test_download_tiles(tmp_path, tile_server):
    out = s.MBTiles(tmp_path / "t.mbtiles", "t", "jpg", 0, 2, "", (0, 0, 1, 1))
    tiles = [(2, x, y) for x in range(4) for y in range(2)]
    progress = []
    found = s.download_tiles(
        tiles,
        tile_server,
        out,
        threads=3,
        progress=lambda d, t: progress.append((d, t)),
    )
    out.close()
    assert found == 4  # x = 0 and 2; missing tiles (404) are skipped, not errors
    assert progress[-1] == (8, 8)
    stored = (
        sqlite3.connect(tmp_path / "t.mbtiles")
        .execute("SELECT tile_data FROM tiles")
        .fetchall()
    )
    assert sorted(row[0] for row in stored) == [b"2/0/0", b"2/0/1", b"2/2/0", b"2/2/1"]


def test_segment_touches_box():
    box = (0.0, 0.0, 1.0, 1.0)
    assert s.segment_touches_box((-1, 0.5, 2, 0.5), box)  # straight through
    assert s.segment_touches_box((0.2, 0.2, 0.3, 0.3), box)  # inside
    assert s.segment_touches_box((-0.5, 0.5, 0.5, 1.5), box)  # clips a corner
    assert not s.segment_touches_box((-0.5, 1.2, 1.2, 2.0), box)  # passes by the corner
    assert not s.segment_touches_box((2, 0, 3, 1), box)


def test_tiles_in_outline_matches_checking_every_tile():
    # The quadtree gives what testing each tile of the bounding box does.
    for zoom in (9, 12):
        brute = {
            (x, y)
            for x, y in s.tiles_in_bbox(s.rings_bbox(LUXEMBOURG), zoom)
            if s.box_touches_rings(s.tile_bounds(x, y, zoom), LUXEMBOURG)
        }
        assert set(s.tiles_in_outline(LUXEMBOURG, zoom)) == brute


def test_world_overview_tiles():
    tiles = s.world_overview_tiles()
    assert len(tiles) == sum(4**z for z in range(9))  # zoom 0 to 8
    assert len(set(tiles)) == len(tiles)


def test_repeated_small_tiles_are_dropped(tmp_path, tile_server):
    # A server's "no data" tile is the same bytes everywhere; imagery never is.
    out = s.MBTiles(tmp_path / "t.mbtiles", "t", "jpg", 0, 3, "", (0, 0, 1, 1))
    found = s.download_tiles(
        [(3, x, 0) for x in range(6)],
        lambda z, x, y: (
            tile_server.format(z=z, x=x, y=y)
            if x < 3
            else tile_server.format(z=0, x=0, y=0)
        ),
        out,
        threads=2,
        drop_repeated=True,
    )
    out.close()
    stored = sorted(
        r[0]
        for r in sqlite3.connect(tmp_path / "t.mbtiles").execute(
            "SELECT tile_data FROM tiles"
        )
    )
    # x = 3, 4, 5 all got tile 0/0/0: blank, none kept; 3/1/0 is missing (odd x: 404).
    assert stored == [b"3/0/0", b"3/2/0"]
    assert found == 2


def test_a_stopped_download_goes_on(tmp_path, tile_server):
    path = tmp_path / "t.mbtiles"
    first = s.MBTiles(path, "t", "jpg", 0, 2, "", (0, 0, 1, 1))
    first.put(2, 0, 0, b"kept")
    first.close()
    again = s.MBTiles(path, "t", "jpg", 0, 2, "", (0, 0, 1, 1), resume=True)
    assert again.has(2) == {(0, 0)}
    fetched = []
    s.download_tiles(
        [(2, 0, 0), (2, 2, 0)],
        lambda z, x, y: fetched.append((x, y)) or tile_server.format(z=z, x=x, y=y),
        again,
        threads=1,
        skip=lambda z, x, y: (x, y) in {(0, 0)},
    )
    again.close()
    assert fetched == [(2, 0)]
    data = dict(
        sqlite3.connect(path).execute("SELECT tile_column, tile_data FROM tiles")
    )
    assert data == {0: b"kept", 2: b"2/2/0"}


def test_tile_blocks_inside_every_outline():
    # Luxembourg and a box over its south: only tiles in both.
    south = s.box_ring((5.7, 49.4, 6.6, 49.6))
    both = set(s.block_tiles(s.tile_blocks([LUXEMBOURG, south], 12), 12))
    lux = {(12, x, y) for x, y in s.tiles_in_outline(LUXEMBOURG, 12)}
    box = {(12, x, y) for x, y in s.tiles_in_outline(south, 12)}
    assert both == lux & box
    assert 0 < len(both) < len(lux)


def test_wms_tile_url():
    wms = dataclasses.replace(
        s.SOURCES["be_wallonia"], address="http://x/wms?BBOX={bbox}"
    )
    assert (
        s.tile_url(wms, 1, 0, 0)
        == "http://x/wms?BBOX=-20037508.34,0.00,0.00,20037508.34"
    )
    tiles = dataclasses.replace(
        s.SOURCES["lu_geoportail"], address="http://x/{z}/{x}/{ty}"
    )
    assert s.tile_url(tiles, 2, 1, 0) == "http://x/2/1/3"


def test_every_imagery_file_has_its_credit():
    assert "NASA" in s.attribution_for("world.sat-overview.pmtiles")
    assert "Copernicus" in s.attribution_for("data/basemap/bayern.sat-regional.pmtiles")
    for source_id, source in s.AERIAL.items():
        credit = s.attribution_for(f"area.sat-detailed-{source_id}.pmtiles")
        assert credit == source.credit
        # Credits travel in VITE_SATELLITE_TIERS, between ";" and after "|".
        assert ";" not in credit and "|" not in credit
    assert s.attribution_for("notes.txt") == ""


class FlakyServer(http.server.BaseHTTPRequestHandler):
    """Hangs up without answering the first `drops` requests, then serves tiles."""

    drops = 0

    def do_GET(self):
        if FlakyServer.drops > 0:
            FlakyServer.drops -= 1
            self.close_connection = True
            self.connection.close()  # RemoteDisconnected on the client
            return
        body = self.path.encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    do_HEAD = do_GET

    def log_message(self, *args):
        pass


@pytest.fixture
def flaky_server(monkeypatch):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), FlakyServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(netsafe, "WAIT_LIMIT", 0.5)
    monkeypatch.setattr(netsafe.time, "sleep", lambda _: None)
    monkeypatch.setattr(netsafe, "connection", netsafe.Connection())
    monkeypatch.setattr(netsafe, "internet_up", lambda: False)  # no real probes
    yield f"http://127.0.0.1:{server.server_port}/{{z}}/{{x}}/{{y}}"
    server.shutdown()


def test_a_dropped_connection_is_waited_for(tmp_path, flaky_server):
    # More failures than the quick retries: it waits for the server, then goes on.
    FlakyServer.drops = netsafe.RETRIES + 2
    out = s.MBTiles(tmp_path / "t.mbtiles", "t", "jpg", 0, 1, "", (0, 0, 1, 1))
    found = s.download_tiles([(1, 0, 0), (1, 1, 0)], flaky_server, out, threads=1)
    out.close()
    assert found == 2


def test_a_connection_that_stays_down_stops_cleanly(tmp_path, flaky_server):
    FlakyServer.drops = 10**6
    path = tmp_path / "t.mbtiles"
    out = s.MBTiles(path, "t", "jpg", 0, 1, "", (0, 0, 1, 1))
    out.put(1, 0, 0, b"before")
    with pytest.raises(netsafe.ConnectionLost):
        s.download_tiles([(1, 1, 0), (1, 1, 1)], flaky_server, out, threads=2)
    out.close()
    # What was there is kept for the next run.
    assert sqlite3.connect(path).execute("SELECT tile_data FROM tiles").fetchall() == [
        (b"before",)
    ]


def test_the_command_line_says_so_and_exits_75(tmp_path, monkeypatch, capsys):
    def lost(args):
        raise netsafe.ConnectionLost()

    monkeypatch.setattr(s.cli, "command_overview", lost)
    with pytest.raises(SystemExit) as stop:
        s.main(["overview", "--out", str(tmp_path / "w.pmtiles")])
    assert stop.value.code == 75
    assert "run again" in capsys.readouterr().err
