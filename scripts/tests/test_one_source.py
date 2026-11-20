"""Values written in more than one place (Compose, the gate, the scripts, the
frontend): one is the reference, the others must agree. Each service's port is
Compose's; the PMTiles program's version too."""

import re
from pathlib import Path

from offline_maps import extract

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "docker-compose.override.yml").read_text()


def compose_port(service: str) -> str:
    """The port a service is published on (127.0.0.1:PORT:...)."""
    block = COMPOSE.split(f"\n  {service}:\n", 1)[1].split("\n  # ", 1)[0]
    return re.search(r'"127\.0\.0\.1:(\d+):\d+"', block)[1]


def shell(name: str) -> str:
    text = "".join(p.read_text() for p in (ROOT / "scripts" / "lib").glob("*.sh"))
    return re.search(rf"^{name}=(\S+)", text, re.MULTILINE)[1]


def test_ports_agree_everywhere():
    gate = (ROOT / "gate" / "nginx.conf").read_text()
    frontend = (ROOT / "web" / "src" / "fork" / "config.ts").read_text()
    for service, in_shell, default in (
        ("backend", "BACKEND_PORT", "VITE_BACKEND_BASE_URL || 'http://localhost:{}'"),
        ("tegola", "TEGOLA_PORT", "VITE_TEGOLA_URL || 'http://localhost:{}'"),
        ("satellite", "SATELLITE_PORT", None),
    ):
        port = compose_port(service)
        assert shell(in_shell) == port, service
        assert f"upstream {service} {{ server 127.0.0.1:{port}; }}" in gate
        # The frontend sends a local service's address through the gate by its port.
        assert f":{port}/, '" in frontend, service
        if default:
            assert default.format(port) in frontend, service
    # Where the map asks for the imagery (config.ts IMAGERY_URL).
    imagery_port = compose_port("satellite")
    assert f"'http://localhost:{imagery_port}'" in frontend
    # The gate's own port: where the app is opened, and where the imagery says it is.
    gate_port = shell("GATE_PORT")
    assert f"listen {gate_port} ssl;" in gate
    assert f"--public-url=https://localhost:{gate_port}/satellite" in COMPOSE


def test_the_pmtiles_program_is_one_version():
    image = re.search(r"image: (protomaps/go-pmtiles:\S+)", COMPOSE)[1]
    assert image == extract.PMTILES_IMAGE


def test_the_zoomed_out_companion_is_named_and_zoomed_alike():
    backend = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "__init__.py"
    ).read_text()
    made = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "zoomed_out.py"
    ).read_text()
    assert f'COMPANION = "{extract.ZOOMED_OUT}"' in backend
    assert f"FULL_ZOOM = {extract.FULL_ZOOM}" in made


def test_the_railways_are_named_and_kinded_alike():
    from offline_maps import railways, regions

    made = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "zoomed_railways.py"
    ).read_text()
    assert f'f"{{background_map.stem}}{railways.RAILWAYS}"' in made
    kinds = re.search(r"KINDS = \{([^}]*)\}", made)[1]
    assert sorted(re.findall(r'"(\w+)"', kinds)) == sorted(railways.KINDS)
    lines = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "transit_lines.py"
    ).read_text()
    transit = re.search(r"TRANSIT_KINDS = \(([^)]*)\)", lines)[1]
    assert re.findall(r'"(\w+)"', transit) == list(railways.ROUTES)
    roads = (
        ROOT / "web" / "src" / "fork" / "modules" / "roads" / "rail-layers.ts"
    ).read_text()
    frontend = re.search(r"TRANSIT_KINDS = \[([^\]]*)\]", roads)[1]
    assert re.findall(r"'(\w+)'", frontend) == list(railways.ROUTES)
    tiles = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "loom_tiles.py"
    ).read_text()
    lanes = (
        ROOT / "web" / "src" / "fork" / "modules" / "roads" / "lane-layers.ts"
    ).read_text()
    loom_layers = re.search(r"LAYERS = \(([^)]*)\)", tiles)[1]
    drawn = re.search(r"LOOM_LAYERS = \[([^\]]*)\]", lanes)[1]
    assert re.findall(r'"([\w-]+)"', loom_layers) == re.findall(r"'([\w-]+)'", drawn)
    from offline_maps import transit

    zooms = re.search(r"ZOOMS = range\((\d+), (\d+)\)", tiles)
    assert range(int(zooms[1]), int(zooms[2])) == transit.LOOM_ZOOMS
    serve = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "transit.py"
    ).read_text()
    assert f'TRANSIT = "{transit.TRANSIT}"' in serve
    width = re.search(r"LANE_WIDTH = (\d+(?:\.\d+)?)", lanes)[1]
    # transitmap's tiles: a tenth of the width given, in pixels of 256 to a tile.
    assert float(width) == 2 * transit.LOOM_LINE_WIDTH / 10
    assert f"LANES_TO = {transit.LOOM_ZOOMS[-1]}" in lanes
    stops = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "line_stops.py"
    ).read_text()
    highlight = (
        ROOT / "web" / "src" / "fork" / "modules" / "roads" / "lane-highlight.ts"
    ).read_text()
    stops_layer = re.search(r'STOPS_LAYER = "(\w+)"', stops)[1]
    assert f"STOPS_LAYER = '{stops_layer}'" in highlight
    from offline_maps import taxiways

    lead_ins = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "stand_lead_ins.py"
    ).read_text()
    assert f'TAXIWAYS = "{taxiways.TAXIWAYS}"' in lead_ins
    shell = (ROOT / "scripts" / "lib" / "geofabrik.sh").read_text()
    assert f'GEOFABRIK_INDEX="$OSM_DIR/{regions.GEOFABRIK_INDEX.name}"' in shell
