"""Values written in more than one place (Compose, the gate, the scripts, the
frontend, the backend): one is the reference, the others must agree. Each service's
port is Compose's; the data folders are scripts/data_folders.py's."""

import importlib.util
import re
import subprocess
from pathlib import Path

import data_folders
from offline_maps import extract

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = (ROOT / "docker-compose.override.yml").read_text()


def compose_port(service: str) -> str:
    """The port a service is published on (127.0.0.1:PORT:...)."""
    return published(service)[1]


def container_port(service: str) -> str:
    """The port a service listens on inside its container (127.0.0.1:...:PORT)."""
    return published(service)[2]


def published(service: str) -> re.Match[str]:
    """A service's "127.0.0.1:PORT:CONTAINER_PORT" in Compose."""
    block = COMPOSE.split(f"\n  {service}:\n", 1)[1].split("\n  # ", 1)[0]
    found = re.search(r'"127\.0\.0\.1:(\d+):(\d+)"', block)
    assert found, f"{service} isn't published on 127.0.0.1 in Compose"
    return found


def shell(name: str) -> str:
    text = "".join(p.read_text() for p in (ROOT / "scripts" / "lib").glob("*.sh"))
    return re.search(rf"^{name}=(\S+)", text, re.MULTILINE)[1]


def shell_path(name: str) -> Path:
    """A path variable as scripts/lib/common.sh sets it."""
    common = ROOT / "scripts" / "lib" / "common.sh"
    found = subprocess.run(
        ["bash", "-c", f'source "{common}" && printf %s "${name}"'],
        capture_output=True,
        text=True,
        check=True,
    )
    return Path(found.stdout)


def backend_paths():
    """The backend's src/fork/paths.py (only pathlib: loaded on its own)."""
    path = ROOT / "web-backend" / "src" / "fork" / "paths.py"
    spec = importlib.util.spec_from_file_location("backend_paths", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_data_folders_agree_everywhere():
    backend = backend_paths()
    for name in (
        "MAP_DIR",
        "OFFLINE_MAPS_DIR",
        "IMAGES_DIR",
        "WIKIDATA_JSON_DIR",
        "OSM_DIR",
    ):
        reference = getattr(data_folders, name)
        assert shell_path(name) == reference, name
        assert getattr(backend, name) == reference, name
    for name in ("DOWNLOADS_DIR", "EXTRA_DIR", "INSTALLERS_DIR"):
        assert shell_path(name) == getattr(data_folders, name), name
    assert shell_path("LOCAL_DIR") == backend.LOCAL_DIR
    # The backend's container sees data/map/ at the path the backend computes there
    # (its file at /app/src/fork/paths.py: /data/map).
    assert "- ./data/map:/data/map:ro,z" in COMPOSE


def test_ports_agree_everywhere():
    gate = (ROOT / "gate" / "nginx.conf").read_text()
    frontend = (ROOT / "web" / "src" / "fork" / "config.ts").read_text()
    for service, in_shell, default in (
        ("backend", "BACKEND_PORT", "VITE_BACKEND_BASE_URL || 'http://localhost:{}'"),
        ("tegola", "TEGOLA_PORT", "VITE_TEGOLA_URL || 'http://localhost:{}'"),
    ):
        port = compose_port(service)
        assert shell(in_shell) == port, service
        # The gate, on Compose's network, finds it by name on its container's port.
        assert f"server {service}:{container_port(service)} resolve;" in gate
        # The frontend sends a local service's address through the gate by its port.
        assert f":{port}/, '" in frontend, service
        if default:
            assert default.format(port) in frontend, service
    # The gate's own port: where the app is opened.
    gate_port = shell("GATE_PORT")
    assert f"listen {gate_port} ssl;" in gate
    assert f'"{gate_port}:{gate_port}"' in COMPOSE


def test_the_zoomed_out_companion_is_named_and_zoomed_alike():
    backend = (
        ROOT / "web-backend" / "src" / "fork" / "background" / "__init__.py"
    ).read_text()
    made = (
        ROOT / "web-backend" / "src" / "fork" / "background_build" / "zoomed_out.py"
    ).read_text()
    assert f'COMPANION = "{extract.ZOOMED_OUT}"' in backend
    assert f"FULL_ZOOM = {extract.FULL_ZOOM}" in made


def test_the_railways_are_named_and_kinded_alike():
    from offline_maps import railways, regions

    made = (
        ROOT
        / "web-backend"
        / "src"
        / "fork"
        / "background_build"
        / "zoomed_railways.py"
    ).read_text()
    assert f'f"{{background_map.stem}}{railways.RAILWAYS}"' in made
    kinds = re.search(r"KINDS = \{([^}]*)\}", made)[1]
    assert sorted(re.findall(r'"(\w+)"', kinds)) == sorted(railways.KINDS)
    lines = (
        ROOT / "web-backend" / "src" / "fork" / "background_build" / "transit_lines.py"
    ).read_text()
    transit = re.search(r"TRANSIT_KINDS = \(([^)]*)\)", lines)[1]
    assert re.findall(r'"(\w+)"', transit) == list(railways.ROUTES)
    roads = (
        ROOT / "web" / "src" / "fork" / "modules" / "roads" / "rail-layers.ts"
    ).read_text()
    frontend = re.search(r"TRANSIT_KINDS = \[([^\]]*)\]", roads)[1]
    assert re.findall(r"'(\w+)'", frontend) == list(railways.ROUTES)
    tiles = (
        ROOT / "web-backend" / "src" / "fork" / "background_build" / "loom_tiles.py"
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
        ROOT / "web-backend" / "src" / "fork" / "background_build" / "line_stops.py"
    ).read_text()
    highlight = (
        ROOT / "web" / "src" / "fork" / "modules" / "roads" / "lane-highlight.ts"
    ).read_text()
    stops_layer = re.search(r'STOPS_LAYER = "(\w+)"', stops)[1]
    assert f"STOPS_LAYER = '{stops_layer}'" in highlight
    from offline_maps import taxiways

    lead_ins = (
        ROOT / "web-backend" / "src" / "fork" / "background_build" / "stand_lead_ins.py"
    ).read_text()
    assert f'TAXIWAYS = "{taxiways.TAXIWAYS}"' in lead_ins
    shell = (ROOT / "scripts" / "lib" / "geofabrik.sh").read_text()
    assert f'GEOFABRIK_INDEX="$OSM_DIR/{regions.GEOFABRIK_INDEX.name}"' in shell


def test_the_gate_and_the_dev_server_pass_on_the_same_paths():
    gate = (ROOT / "gate" / "nginx.conf").read_text()
    vite = (ROOT / "web" / "vite.config.ts").read_text()
    to_backend = re.search(r"location ~ \^/\(([^)]+)\)", gate)
    in_vite = re.search(r"'\^/\(([^)]+)\)", vite)
    assert to_backend and in_vite, "the backend's paths weren't found"
    gate_paths = set(to_backend[1].split("|")) | {"login", "auth"}
    vite_paths = set(in_vite[1].replace("\\\\", "\\").split("|"))
    assert gate_paths == vite_paths
    assert "location /tegola/" in gate and "'/tegola/'" in vite


def test_the_bases_parts_start_at_one_zoom():
    """A base's building and zone parts: left out of the tiles before it (SQL, Tegola),
    drawn from it (the frontend)."""
    frontend = (
        ROOT / "web" / "src" / "fork" / "modules" / "sites" / "parts.constants.ts"
    ).read_text()
    zoom = re.search(r"PARTS_MIN_ZOOM = (\d+)", frontend)
    assert zoom, "PARTS_MIN_ZOOM wasn't found"
    points = (ROOT / "schema" / "fork" / "site-points.sql").read_text()
    tiles = (ROOT / "tegola" / "layers.fork.yml").read_text()
    assert f"AND (zoom < {zoom[1]} OR f.area > 0)" in points
    assert f"NOT IN ('building', 'zone') OR !ZOOM! >= {zoom[1]})" in tiles


def test_the_build_cache_kept_is_the_same_for_shell_and_python():
    from offline_maps import docker

    assert shell("BUILD_CACHE_KEPT") == docker.BUILD_CACHE_KEPT
