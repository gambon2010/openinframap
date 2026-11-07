"""scripts/satimagery/bdortho.py: IGN's aerial photos of France as IGN's files, one
département at a time; netsafe.fetch_file, the resumable download it uses."""

import hashlib
import http.server
import io
import json
import sqlite3
import threading

import pytest

import netsafe
import satellite as s
from satimagery import bdortho
from satimagery.departements import DEPARTEMENTS

ATOM = """<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:gpf_dl="https://data.geopf.fr/annexes/ressources/xsd/gpf_dl.xsd"
      gpf_dl:totalentries="{total}">{entries}</feed>"""


def feed(entries: list[str], total: int | None = None) -> bytes:
    return ATOM.format(
        total=len(entries) if total is None else total, entries="".join(entries)
    ).encode()


def entry(title: str, href: str = "", length: int = 0) -> str:
    link = f'<link href="{href}" gpf_dl:length="{length}"/>' if href else ""
    return f"<entry><title>{title}</title>{link}</entry>"


def test_the_departement_table():
    assert len(DEPARTEMENTS) == 96 and {"2A", "2B"} <= set(DEPARTEMENTS)
    # Metropolitan France: about 544,000 km².
    assert 540_000 < sum(d[1] for d in DEPARTEMENTS.values()) < 550_000
    for name, km2, (west, south, east, north), region in DEPARTEMENTS.values():
        assert name and km2 > 0 and region
        assert -5.5 < west < east < 9.7 and 41.3 < south < north < 51.2
    assert DEPARTEMENTS["67"][0] == "Bas-Rhin" and DEPARTEMENTS["67"][3] == "alsace"


def test_departements_in_an_area():
    parents = {d[3]: "france" for d in DEPARTEMENTS.values()} | {"france": "europe"}

    def within(a, b):
        while a:
            if a == b:
                return True
            a = parents.get(a)
        return False

    assert bdortho.departements_in("alsace", within) == ["67", "68"]
    assert len(bdortho.departements_in("france", within)) == 96
    assert len(bdortho.departements_in("europe", within)) == 96
    assert bdortho.departements_in("spain", within) == []


def test_sizes_grow_four_times_a_zoom():
    one, two = bdortho.tiles_of("67", 17), bdortho.tiles_of("67", 18)
    # Bas-Rhin, 4,800 km² at 48.6° (a zoom 17 tile is 200 m across there): some
    # 117,000 tiles at zoom 17, 155,000 from zoom 12.
    assert 140_000 < one < 170_000
    assert 3.5 < two / one < 4.5
    e = bdortho.estimate(["67", "68"], 17)
    km2 = DEPARTEMENTS["67"][1] + DEPARTEMENTS["68"][1]
    assert e["download"] == km2 * bdortho.ARCHIVE_BYTES_PER_KM2


def test_the_latest_colour_edition(monkeypatch):
    pages = {
        1: feed(
            [
                entry("BDORTHO_1-0_RVB-0M20_JP2-E080_LAMB93_D067_2021-01-01"),
                entry("BDORTHO_2-0_IRC-0M20_JP2-E080_LAMB93_D067_2024-01-01"),
            ],
            total=4,
        ),
        2: feed(
            [
                entry("BDORTHO_2-0_RVB-0M20_JP2-E080_LAMB93_D067_2024-01-01"),
                entry("BDORTHO_2-0_RVB-0M50_JP2-E080_LAMB93_D067_2025-01-01"),
            ],
            total=4,
        ),
    }
    asked = []

    def fetch(url, **_):
        asked.append(url)
        return pages[int(url.rsplit("page=", 1)[1])]

    monkeypatch.setattr(netsafe, "fetch", fetch)
    # Colour (RVB), 20 cm, the newest; infrared and 50 cm left out.
    assert (
        bdortho.latest_edition("67")
        == "BDORTHO_2-0_RVB-0M20_JP2-E080_LAMB93_D067_2024-01-01"
    )
    assert "zone=D067" in asked[0] and len(asked) == 2
    monkeypatch.setattr(netsafe, "fetch", lambda url, **_: feed([]))
    with pytest.raises(RuntimeError, match="no 20 cm colour photos"):
        bdortho.latest_edition("2A")


def test_the_archive_parts_in_order(monkeypatch):
    base = "https://x/BDORTHO_2-0_RVB/BDORTHO_2-0_RVB"
    monkeypatch.setattr(
        netsafe,
        "fetch",
        lambda url, **_: feed(
            [
                entry("", f"{base}.7z.002", 20),
                entry("", f"{base}.md5", 1),
                entry("", f"{base}.7z.001", 10),
            ]
        ),
    )
    parts, md5 = bdortho.archive_files("BDORTHO_2-0_RVB")
    assert parts == [(f"{base}.7z.001", 10), (f"{base}.7z.002", 20)]
    assert md5 == f"{base}.md5"


def test_the_pipeline_makes_webp_to_the_zoom_and_down_to_12():
    commands = bdortho.pipeline(17).split(" && ")
    assert commands[0].startswith("gdalwarp") and "EPSG:3857" in commands[0]
    assert "-dstalpha" in commands[0] and "--optfile images.txt" in commands[0]
    # Each zoom straight from the reprojected image, the last zoom first.
    zooms = [c.split("--min-zoom ")[1].split()[0] for c in commands[1:-1]]
    assert zooms == ["17", "16", "15", "14", "13", "12"]
    assert all("--format WEBP" in c and "QUALITY=75" in c for c in commands[1:-1])
    assert commands[-1] == "rm warped.tif"


def test_tiles_are_packed_with_their_bounds(tmp_path):
    for z, x, y in ((16, 33196, 22528), (17, 66392, 45056), (17, 66393, 45057)):
        (tmp_path / "tiles" / str(z) / str(x)).mkdir(parents=True, exist_ok=True)
        (tmp_path / "tiles" / str(z) / str(x) / f"{y}.webp").write_bytes(b"%d" % z)
    out = bdortho.pack(tmp_path / "tiles", tmp_path / "t.mbtiles", "75")
    db = sqlite3.connect(out)
    meta = dict(db.execute("SELECT name, value FROM metadata"))
    assert (meta["minzoom"], meta["maxzoom"], meta["format"]) == ("16", "17", "webp")
    west, south, east, north = map(float, meta["bounds"].split(","))
    assert 2.35 < west < east < 2.37 and 48.91 < south < north < 48.93
    # Rows in TMS order, as MBTiles wants.
    assert (17, 66392, 2**17 - 1 - 45056) in set(
        db.execute("SELECT zoom_level, tile_column, tile_row FROM tiles")
    )


class RangeServer(http.server.BaseHTTPRequestHandler):
    """Serves BODY, honouring Range; hangs up half-way the first DROPS times."""

    BODY = bytes(range(256)) * 400
    drops = 0

    def do_GET(self):
        start = 0
        if self.headers.get("Range"):
            start = int(self.headers["Range"].split("=")[1].split("-")[0])
        body = self.BODY[start:]
        self.send_response(206 if start else 200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if RangeServer.drops:
            RangeServer.drops -= 1
            self.wfile.write(body[: len(body) // 2])
            self.wfile.flush()
            self.connection.shutdown(2)  # dropped half-way
            return
        self.wfile.write(body)

    def log_message(self, *args):
        pass


@pytest.fixture
def range_server(monkeypatch):
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), RangeServer)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    monkeypatch.setattr(netsafe.time, "sleep", lambda _: None)
    monkeypatch.setattr(netsafe, "connection", netsafe.Connection())
    monkeypatch.setattr(netsafe, "reachable", lambda url: True)
    yield f"http://127.0.0.1:{server.server_port}/file"
    server.shutdown()


def test_a_big_file_goes_on_where_it_stopped(tmp_path, range_server):
    RangeServer.drops = 2
    got = []
    path = tmp_path / "a.7z.001"
    netsafe.fetch_file(range_server, path, progress=got.append)
    assert path.read_bytes() == RangeServer.BODY
    assert not (tmp_path / "a.7z.001.part").exists()
    # Resumed, not started again: no more than the file (and its drops) came.
    assert sum(got) == len(RangeServer.BODY)


def test_a_damaged_part_is_downloaded_again(tmp_path, range_server, monkeypatch):
    RangeServer.drops = 0
    good = hashlib.md5(RangeServer.BODY).hexdigest()
    monkeypatch.setattr(
        bdortho, "archive_files", lambda r: ([(range_server + "/a.7z.001", 1)], "md5")
    )
    monkeypatch.setattr(bdortho, "expected_md5", lambda url: {"a.7z.001": good})
    # A part left from before, damaged (wrong bytes, complete size).
    (tmp_path / "a.7z.001").write_bytes(b"x" * len(RangeServer.BODY))
    first = bdortho.download_archive("BDORTHO_X", tmp_path)
    assert first.name == "a.7z.001" and first.read_bytes() == RangeServer.BODY


def test_a_departement_already_there_is_skipped(tmp_path, monkeypatch, capsys):
    header = bytearray(127)
    header[:7], header[100], header[101] = b"PMTiles", 14, 17
    bdortho.file_of(tmp_path, "67").write_bytes(bytes(header))
    monkeypatch.setattr(
        bdortho, "latest_edition", lambda code: pytest.fail("nothing to download")
    )
    s.main(
        ["bdortho", "--dept", "67", "--maxzoom", "16", "--basemap-dir", str(tmp_path)]
    )
    assert "already there to zoom 17" in capsys.readouterr().err


def test_the_menu_asks_the_zoom_then_the_departements(tmp_path, monkeypatch, capsys):
    square = {
        "type": "Polygon",
        "coordinates": [[[7, 47], [8, 47], [8, 49], [7, 49], [7, 47]]],
    }
    index = tmp_path / "index.json"
    index.write_text(
        json.dumps(
            {
                "features": [
                    {
                        "properties": {"id": "france", "name": "France"},
                        "geometry": square,
                    },
                    {
                        "properties": {
                            "id": "alsace",
                            "name": "Alsace",
                            "parent": "france",
                        },
                        "geometry": square,
                    },
                ]
            }
        )
    )
    header = bytearray(127)
    header[:7], header[100], header[101] = b"PMTiles", 7, 12
    (tmp_path / "alsace.sat-regional.pmtiles").write_bytes(bytes(header))
    (tmp_path / "world.sat-overview.pmtiles").write_bytes(bytes(header))
    plan = tmp_path / "plan.json"
    # Keep Sentinel-2; IGN to zoom 17; "99" isn't one of them, then 67.
    monkeypatch.setattr("sys.stdin", io.StringIO("\n17\n99\n67\n"))
    args = ["--plan", str(plan), "--basemap-dir", str(tmp_path), "--index", str(index)]
    s.main(["choose", *args, "--region", "alsace"])
    shown = capsys.readouterr().err
    assert "IGN's aerial photos (BD ORTHO" in shown and "2 départements" in shown
    assert "67 Bas-Rhin" in shown and "Type codes from the list" in shown
    assert json.loads(plan.read_text())["bdortho"] == {"codes": ["67"], "maxzoom": 17}
    s.main(["steps", *args])
    step = capsys.readouterr().out.strip().split("\t")
    assert step[0] == "IGN aerial photos (BD ORTHO), Bas-Rhin, to zoom 17"
    assert step[1:] == [
        "bdortho",
        "--dept",
        "67",
        "--maxzoom",
        "17",
        "--basemap-dir",
        str(tmp_path),
    ]
