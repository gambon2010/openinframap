"""The setup scripts themselves (build-region.sh, import-db.sh, export-db.sh,
start.sh, launch.sh), run for real but in a sandbox: a copy of the scripts in a
temporary folder (so they write their data/ and web/.env there), with fake
`docker`, `curl`, terminals and browsers (tests/fakes/) that log what they're asked
to do and never touch Docker, the database or the network.

What they check: options and help, refusing bad input early, and the safety rules
(nothing is wiped before the user agrees and the export checks out; My layers are
saved before a wipe). A real build is the opt-in test at the end.
"""

import hashlib
import json
import os
import shutil
import subprocess
import time
from pathlib import Path

import pytest
from conftest import SCRIPTS

REPO = SCRIPTS.parent
FAKES = Path(__file__).parent / "fakes"
RECORDED = [
    "xdg-open",
    "open",
    "ptyxis",
    "gnome-terminal",
    "konsole",
    "xterm",
    "uv",
    "osmium",
    "npm",
    "notify-send",
]


class Sandbox:
    def __init__(self, root: Path):
        self.root = root
        self.log = root / "calls.log"
        shutil.copytree(
            SCRIPTS,
            root / "scripts",
            ignore=shutil.ignore_patterns("tests", "__pycache__"),
        )
        for folder in ("schema", "imposm"):
            shutil.copytree(
                REPO / folder,
                root / folder,
                ignore=shutil.ignore_patterns("__pycache__"),
            )
        (root / "web").mkdir()
        (root / "home").mkdir()
        bin_dir = root / "bin"
        bin_dir.mkdir()
        (bin_dir / "docker").symlink_to(FAKES / "docker")
        (bin_dir / "curl").symlink_to(FAKES / "curl")
        for name in RECORDED:
            (bin_dir / name).symlink_to(FAKES / "recorder")
        self.log.touch()
        self.env = {
            "PATH": f"{bin_dir}:{os.environ['PATH']}",
            "HOME": str(root / "home"),
            "FAKE_LOG": str(self.log),
            "TERM": "dumb",
            "LANG": "C.UTF-8",
        }

    def run(
        self, script: str, *args: str, answers: str = "", **env: str
    ) -> subprocess.CompletedProcess:
        return subprocess.run(
            ["bash", str(self.root / "scripts" / script), *args],
            input=answers,
            capture_output=True,
            text=True,
            cwd=self.root,
            env={**self.env, **env},
            timeout=60,
            check=False,  # the tests look at the exit code
        )

    def calls(self) -> list[list[str]]:
        return [json.loads(line) for line in self.log.read_text().splitlines()]

    def docker_calls(self, *words: str) -> list[list[str]]:
        """Fake docker calls containing all these words."""
        return [
            c for c in self.calls() if c[:1] != ["curl"] and all(w in c for w in words)
        ]

    def wiped(self) -> bool:
        return bool(self.docker_calls("down", "-v"))


@pytest.fixture
def sandbox(tmp_path):
    return Sandbox(tmp_path)


def answers(**values) -> str:
    return json.dumps(values)


# --- Every script ---------------------------------------------------------------

SCRIPT_NAMES = [
    "build-region.sh",
    "import-db.sh",
    "export-db.sh",
    "start.sh",
    "launch.sh",
]


@pytest.mark.parametrize("script", [*SCRIPT_NAMES, "lib/common.sh"])
def test_syntax(script):
    subprocess.run(["bash", "-n", str(SCRIPTS / script)], check=True)


@pytest.mark.parametrize("script", ["build-region.sh", "import-db.sh", "export-db.sh"])
def test_help(sandbox, script):
    result = sandbox.run(script, "--help")
    assert result.returncode == 0
    assert "bash scripts/" in result.stdout or "Usage" in result.stdout
    assert sandbox.calls() == []  # --help does nothing else


@pytest.mark.parametrize("script", ["build-region.sh", "import-db.sh", "export-db.sh"])
def test_unknown_option(sandbox, script):
    result = sandbox.run(script, "--frobnicate")
    assert result.returncode != 0
    assert "Unknown option" in result.stderr + result.stdout
    assert not sandbox.wiped()


# --- build-region.sh --------------------------------------------------------------


@pytest.mark.parametrize(
    "option, value, message",
    [
        ("--basemap", "huge", "--basemap must be full, reduced or none"),
        (
            "--satellite",
            "everything",
            "--satellite must be none, overview, regional or regional13",
        ),
        (
            "--satellite-detailed",
            "20",
            "--satellite-detailed must be 15, 16, 17 or none",
        ),
    ],
)
def test_build_refuses_bad_values_before_doing_anything(
    sandbox, option, value, message
):
    result = sandbox.run(
        "build-region.sh", "--region", "luxembourg", "--yes", option, value
    )
    assert result.returncode != 0
    assert message in result.stderr + result.stdout
    assert sandbox.calls() == []


def test_build_unattended_needs_a_region(sandbox):
    result = sandbox.run("build-region.sh", "--yes")
    assert result.returncode != 0
    assert "--yes needs --region or --pbf" in result.stderr + result.stdout
    assert not sandbox.wiped()


def test_build_with_a_missing_file(sandbox):
    result = sandbox.run("build-region.sh", "--pbf", "nowhere.osm.pbf", "--yes")
    assert result.returncode != 0
    assert "File not found" in result.stderr + result.stdout
    assert not sandbox.wiped()


def test_build_without_docker_running(sandbox):
    (sandbox.root / "bin" / "docker").unlink()
    (sandbox.root / "bin" / "docker").write_text("#!/bin/sh\nexit 1\n")
    (sandbox.root / "bin" / "docker").chmod(0o755)
    result = sandbox.run("build-region.sh", "--region", "luxembourg", "--yes")
    assert result.returncode != 0
    assert "Docker" in result.stderr + result.stdout


def test_build_offline_with_an_unknown_region(sandbox):
    # No Geofabrik index (curl fails): the region can't be looked up, nothing is wiped.
    result = sandbox.run("build-region.sh", "--region", "atlantis", "--yes")
    assert result.returncode != 0
    assert not sandbox.wiped()


# --- import-db.sh -----------------------------------------------------------------


def make_export(sandbox: Sandbox, region="luxembourg", damaged=False) -> Path:
    exports = sandbox.root / "data" / "exports"
    exports.mkdir(parents=True, exist_ok=True)
    dump = exports / f"{region}.oimdb"
    dump.write_bytes(b"pretend this is a pg_dump")
    sha = hashlib.sha256(dump.read_bytes()).hexdigest()
    manifest = {
        "region_id": region,
        "region_name": region.title(),
        "osm_timestamp": "2026-10-01T00:00:00Z",
        "exported_at": "2026-10-02T00:00:00Z",
        "schema_hash": "",
        "extra_data": "",
        "size": dump.stat().st_size,
        "sha256": "0" * 64 if damaged else sha,
    }
    (exports / f"{region}.json").write_text(json.dumps(manifest))
    return dump


def test_import_needs_a_file(sandbox):
    result = sandbox.run("import-db.sh")
    assert result.returncode != 0
    assert "Usage" in result.stderr + result.stdout


def test_import_of_a_missing_export(sandbox):
    result = sandbox.run("import-db.sh", "data/exports/nowhere.oimdb")
    assert result.returncode != 0
    assert "Export not found" in result.stderr + result.stdout


def test_import_without_its_description(sandbox):
    dump = make_export(sandbox)
    dump.with_suffix(".json").unlink()
    result = sandbox.run("import-db.sh", str(dump))
    assert "description is missing" in result.stderr + result.stdout
    assert not sandbox.wiped()


def test_a_damaged_export_is_refused_before_the_database_is_wiped(sandbox):
    dump = make_export(sandbox, damaged=True)
    result = sandbox.run("import-db.sh", str(dump), "--yes", FAKE_DB_EXISTS="1")
    assert result.returncode != 0
    assert "damaged" in result.stderr + result.stdout
    assert not sandbox.wiped()


def test_import_asks_before_replacing_the_database(sandbox):
    dump = make_export(sandbox)
    result = sandbox.run(
        "import-db.sh",
        str(dump),
        answers="n\n",
        FAKE_DB_EXISTS="1",
        FAKE_DB_ANSWERS=answers(region_name="France"),
    )
    assert result.returncode != 0
    assert "nothing was changed" in result.stderr + result.stdout
    assert not sandbox.wiped()


def test_import(sandbox):
    dump = make_export(sandbox)
    basemap = sandbox.root / "data" / "basemap"
    basemap.mkdir(parents=True)
    header = bytearray(127)
    header[:7], header[101] = b"PMTiles", 8
    (basemap / "luxembourg.sat-overview.pmtiles").write_bytes(bytes(header))
    db = answers(
        **{
            "count(*) FROM userdata.save": "3",  # there are My layers to keep
            "to_regclass('search_feature') IS NULL": "t",  # an old export: no search view
            "to_regclass('grid_edge') IS NULL": "t",  # ... and no grid network
            "region_name": "France",
        }
    )
    result = sandbox.run(
        "import-db.sh", str(dump), "--yes", FAKE_DB_EXISTS="1", FAKE_DB_ANSWERS=db
    )
    assert result.returncode == 0, result.stderr + result.stdout
    calls = sandbox.calls()

    def first(*words):
        return next(i for i, c in enumerate(calls) if all(w in c for w in words))

    # My layers are saved before the wipe, the restore comes after it.
    assert (
        first("pg_dump", "userdata")
        < first("down", "-v")
        < first("pg_restore", "--exit-on-error")
    )
    assert (sandbox.root / "data" / "userdata" / "userdata.dump").exists()
    # Old exports get the search view and the grid network built.
    sql_runs = [c for c in calls if "psql" in c and "-tAc" not in c]
    assert (
        len(sql_runs) >= 3
    )  # extra.sql, search.sql, grid.sql (and My layers' restore)
    assert "Building the power grid network" in result.stdout
    # The satellite imagery copied along is switched on.
    env = (sandbox.root / "web" / ".env").read_text()
    assert (
        "VITE_SATELLITE_TIERS=http://localhost:8090/luxembourg.sat-overview/{z}/{x}/{y}.jpg 0 8"
        in env
    )
    # The tile server is recreated so it doesn't serve the old data's tiles.
    assert sandbox.docker_calls("up", "--force-recreate", "tegola")


# --- export-db.sh -----------------------------------------------------------------


def test_export_without_a_database(sandbox):
    result = sandbox.run("export-db.sh", "--yes", "--no-docker-images")
    assert result.returncode != 0
    assert "no map database" in result.stderr + result.stdout


def test_export_of_an_unfinished_build(sandbox):
    result = sandbox.run(
        "export-db.sh", "--yes", "--no-docker-images", FAKE_DB_EXISTS="1"
    )
    assert result.returncode != 0
    assert "never finished" in result.stderr + result.stdout


def test_export(sandbox):
    db = answers(
        **{
            "key = 'region_id'": "luxembourg",
            "key = 'region_name'": "Luxembourg",
            "key = 'osm_timestamp'": "2026-10-01T00:00:00Z",
            "pg_database_size": "1000000",
        }
    )
    result = sandbox.run(
        "export-db.sh",
        "--yes",
        "--no-docker-images",
        FAKE_DB_EXISTS="1",
        FAKE_DB_ANSWERS=db,
    )
    assert result.returncode == 0, result.stderr + result.stdout
    dump = sandbox.root / "data" / "exports" / "luxembourg.oimdb"
    manifest = json.loads(dump.with_suffix(".json").read_text())
    assert manifest["region_id"] == "luxembourg"
    assert manifest["sha256"] == hashlib.sha256(dump.read_bytes()).hexdigest()
    assert manifest["size"] == dump.stat().st_size
    # Every data schema, My layers and extra data included.
    dumps = sandbox.docker_calls("pg_dump")
    assert dumps and all(
        f in dumps[0] for f in ("public", "countries", "stats", "extra", "userdata")
    )
    assert not sandbox.wiped()


def test_an_export_imports_back(sandbox):
    """What export-db.sh writes passes import-db.sh's checks."""
    db = answers(
        **{
            "key = 'region_id'": "luxembourg",
            "key = 'region_name'": "Luxembourg",
            "pg_database_size": "1000",
        }
    )
    assert (
        sandbox.run(
            "export-db.sh",
            "--yes",
            "--no-docker-images",
            FAKE_DB_EXISTS="1",
            FAKE_DB_ANSWERS=db,
        ).returncode
        == 0
    )
    result = sandbox.run(
        "import-db.sh", "data/exports/luxembourg.oimdb", "--yes", FAKE_DB_ANSWERS=db
    )
    assert result.returncode == 0, result.stderr + result.stdout
    assert "damaged" not in result.stderr


# --- start.sh ---------------------------------------------------------------------


def test_start_without_a_database(sandbox):
    result = sandbox.run("start.sh")
    assert result.returncode != 0
    assert "launch.sh" in result.stderr + result.stdout


def test_start(sandbox):
    db = answers(
        **{"key = 'region_name'": "Luxembourg", "key = 'region_id'": "luxembourg"}
    )
    # Backend and frontend already answer: nothing to open in a terminal; the browser opens.
    result = sandbox.run(
        "start.sh", FAKE_DB_EXISTS="1", FAKE_DB_ANSWERS=db, FAKE_PORTS_UP="8001 5173"
    )
    assert result.returncode == 0, result.stderr + result.stdout
    assert sandbox.docker_calls("up", "db")
    assert sandbox.docker_calls("up", "tegola")
    # The browser is opened in the background: give it a moment to be called.
    for _ in range(50):
        if ["xdg-open", "http://localhost:5173"] in sandbox.calls():
            break
        time.sleep(0.1)
    assert ["xdg-open", "http://localhost:5173"] in sandbox.calls()
    assert not sandbox.wiped()


def test_start_without_a_desktop(sandbox):
    """No display to open a terminal in: it says how to start the frontend by hand."""
    db = answers(**{"key = 'region_name'": "Luxembourg"})
    result = sandbox.run(
        "start.sh", FAKE_DB_EXISTS="1", FAKE_DB_ANSWERS=db, FAKE_PORTS_UP="8001"
    )
    assert result.returncode == 0, result.stderr + result.stdout
    assert "npm start" in result.stdout
    assert not [
        c
        for c in sandbox.calls()
        if c[0] in ("ptyxis", "gnome-terminal", "konsole", "xterm")
    ]


# --- A real build (opt-in) ---------------------------------------------------------


@pytest.mark.skipif(
    os.environ.get("OIM_TEST_REAL_BUILD") != "wipes-my-database",
    reason="builds Luxembourg for real and REPLACES the map database; set OIM_TEST_REAL_BUILD=wipes-my-database",
)
def test_real_build_of_luxembourg():
    """End to end: download, filter, import, views, search, grid, Tegola. A few minutes."""
    result = subprocess.run(
        [
            "bash",
            str(SCRIPTS / "build-region.sh"),
            "--region",
            "luxembourg",
            "--yes",
            "--no-images",
            "--no-extra",
        ],
        cwd=REPO,
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-3000:]

    def query(sql: str) -> str:
        return subprocess.run(
            [
                "docker",
                "compose",
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "osm",
                "osm",
                "-tAc",
                sql,
            ],
            cwd=REPO,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()

    assert (
        query("SELECT value FROM oim_build_info WHERE key = 'region_id'")
        == "luxembourg"
    )
    assert int(query("SELECT count(*) FROM osm_power_line")) > 100
    assert int(query("SELECT count(*) FROM grid_edge")) > 10
    assert int(query("SELECT count(*) FROM search_feature")) > 100
