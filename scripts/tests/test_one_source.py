"""Values written in more than one place (Compose, the gate, the scripts, the
frontend): one is the reference, the others must agree. Each service's port is
Compose's; the PMTiles program's version too."""

import re
from pathlib import Path

from satimagery import extract

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
    # The gate's own port: where the app is opened, and where the imagery says it is.
    gate_port = shell("GATE_PORT")
    assert f"listen {gate_port} ssl;" in gate
    assert f"--public-url=https://localhost:{gate_port}/satellite" in COMPOSE


def test_the_pmtiles_program_is_one_version():
    image = re.search(r"image: (protomaps/go-pmtiles:\S+)", COMPOSE)[1]
    assert image == extract.PMTILES_IMAGE
