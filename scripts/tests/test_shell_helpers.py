"""scripts/lib/common.sh helpers, run by bash (no Docker, database or network)."""

import json
import subprocess

from conftest import SCRIPTS

COMMON = SCRIPTS / "lib" / "common.sh"


def bash(script: str, **env: str) -> str:
    setup = "".join(f'{key}="{value}"\n' for key, value in env.items())
    result = subprocess.run(
        ["bash", "-c", f'source "{COMMON}"\n{setup}{script}'],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout.strip()


def test_human_size():
    assert bash("human_size 0") == "0B"
    assert bash("human_size 1536") in ("1.5K", "1.5KB", "1.5KiB")
    assert "G" in bash("human_size 3000000000")


def test_set_env_line(tmp_path):
    env = tmp_path / ".env"
    env.write_text("A=1\nB=2\n")
    bash(
        f'set_env_line "{env}" B 3; set_env_line "{env}" C 4; set_env_line "{env}" A ""'
    )
    assert env.read_text() == "B=3\nC=4\n"


def pmtiles_header(maxzoom: int) -> bytes:
    header = bytearray(127)
    header[:7] = b"PMTiles"
    header[7] = 3
    header[100], header[101] = 0, maxzoom
    return bytes(header)


def test_satellite_tiers_value(tmp_path):
    (tmp_path / "lux.sat-overview.pmtiles").write_bytes(pmtiles_header(8))
    (tmp_path / "lux.sat-regional.pmtiles").write_bytes(pmtiles_header(13))
    value = bash("satellite_tiers_value lux", BASEMAP_DIR=str(tmp_path))
    assert value == (
        "http://localhost:8090/lux.sat-overview/{z}/{x}/{y}.jpg 0 8;"
        "http://localhost:8090/lux.sat-regional/{z}/{x}/{y}.webp 9 13"
    )
    assert bash("satellite_tiers_value other", BASEMAP_DIR=str(tmp_path)) == ""
    assert (
        bash("has_satellite lux && echo yes || echo no", BASEMAP_DIR=str(tmp_path))
        == "yes"
    )
    assert (
        bash("has_satellite other && echo yes || echo no", BASEMAP_DIR=str(tmp_path))
        == "no"
    )
    assert bash("satellite_summary lux", BASEMAP_DIR=str(tmp_path)).startswith(
        "overview, regional ("
    )


def test_pmtiles_maxzoom_falls_back(tmp_path):
    bad = tmp_path / "bad.pmtiles"
    bad.write_bytes(b"not pmtiles")
    assert bash(f'pmtiles_maxzoom "{bad}" 12') == "12"
    assert bash(f'pmtiles_maxzoom "{tmp_path}/missing" 16') == "16"


def test_region_in(tmp_path):
    index = tmp_path / "index.json"
    features = [
        {"properties": {"id": "europe"}},
        {"properties": {"id": "france", "parent": "europe"}},
        {"properties": {"id": "alsace", "parent": "france"}},
        {"properties": {"id": "luxembourg", "parent": "europe"}},
    ]
    index.write_text(json.dumps({"features": features}))
    check = "for r in alsace france luxembourg europe nowhere; do region_in $r france && echo $r; done; true"
    assert bash(check, GEOFABRIK_INDEX=str(index)).split() == ["alsace", "france"]
