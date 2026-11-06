"""scripts/lib/common.sh helpers, run by bash (no Docker, database or network)."""

import json
import re
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


def pmtiles_header(maxzoom: int, minzoom: int = 0) -> bytes:
    header = bytearray(127)
    header[:7] = b"PMTiles"
    header[7] = 3
    header[100], header[101] = minzoom, maxzoom
    return bytes(header)


def test_satellite_tiers_value(tmp_path):
    (tmp_path / "lux.sat-overview.pmtiles").write_bytes(pmtiles_header(8))
    (tmp_path / "lux.sat-regional.pmtiles").write_bytes(pmtiles_header(13, 9))
    value = bash("satellite_tiers_value lux", BASEMAP_DIR=str(tmp_path))
    assert "|NASA Blue Marble;" in value
    value = re.sub(r"\|[^;]*", "", value)
    assert value == (
        "http://localhost:8090/lux.sat-overview/{z}/{x}/{y}.jpg 0 8;"
        "http://localhost:8090/lux.sat-regional/{z}/{x}/{y}.webp 9 13"
    )
    # Another region: everything downloaded shows, but not lux's own overview.
    assert re.sub(
        r"\|[^;]*", "", bash("satellite_tiers_value other", BASEMAP_DIR=str(tmp_path))
    ) == ("http://localhost:8090/lux.sat-regional/{z}/{x}/{y}.webp 9 13")
    assert (
        bash("has_satellite other && echo yes || echo no", BASEMAP_DIR=str(tmp_path))
        == "yes"
    )
    assert (
        bash("region_satellite other && echo yes || echo no", BASEMAP_DIR=str(tmp_path))
        == "no"
    )
    assert (
        bash(
            "has_satellite x && echo yes || echo no", BASEMAP_DIR=str(tmp_path / "none")
        )
        == "no"
    )
    assert bash("satellite_summary lux", BASEMAP_DIR=str(tmp_path)).startswith(
        "lux overview, lux regional ("
    )


def test_pmtiles_maxzoom_falls_back(tmp_path):
    bad = tmp_path / "bad.pmtiles"
    bad.write_bytes(b"not pmtiles")
    assert bash(f'pmtiles_maxzoom "{bad}" 12') == "12"
    assert bash(f'pmtiles_maxzoom "{tmp_path}/missing" 16') == "16"


def test_export_outdated(tmp_path):
    (tmp_path / "lux.oimdb").write_bytes(b"")
    manifest = {"built_at": "B1", "schema_hash": "S1", "extra_data": ""}
    (tmp_path / "lux.json").write_text(json.dumps(manifest))
    # The database as build_info and extra_description would read it.
    fake = """
build_info() { case "$1" in region_id) echo lux ;; built_at) echo "$BUILT" ;;
               schema_hash) echo S1 ;; esac; }
extra_description() { echo "$EXTRA"; }
export_outdated && echo outdated || echo current
"""
    assert bash(fake, EXPORTS_DIR=str(tmp_path), BUILT="B1", EXTRA="") == "current"
    assert bash(fake, EXPORTS_DIR=str(tmp_path), BUILT="B2", EXTRA="") == "outdated"
    assert bash(fake, EXPORTS_DIR=str(tmp_path), BUILT="B1", EXTRA="ORE") == "outdated"
    # No export of the region: nothing to bring up to date.
    (tmp_path / "lux.oimdb").unlink()
    assert bash(fake, EXPORTS_DIR=str(tmp_path), BUILT="B2", EXTRA="") == "current"


def test_world_overview_is_shared_by_every_region(tmp_path):
    (tmp_path / "world.sat-overview.pmtiles").write_bytes(pmtiles_header(8))
    (tmp_path / "lux.sat-regional.pmtiles").write_bytes(pmtiles_header(12, 9))
    value = bash("satellite_tiers_value lux", BASEMAP_DIR=str(tmp_path))
    assert "|NASA Blue Marble;" in value
    value = re.sub(r"\|[^;]*", "", value)
    assert value == (
        "http://localhost:8090/world.sat-overview/{z}/{x}/{y}.jpg 0 8;"
        "http://localhost:8090/lux.sat-regional/{z}/{x}/{y}.webp 9 12"
    )
    # Another region with nothing of its own still has the world.
    assert bash("satellite_tiers_value fr", BASEMAP_DIR=str(tmp_path)).startswith(
        "http://localhost:8090/world.sat-overview/"
    )
    assert bash(
        "has_satellite fr && echo yes; region_satellite fr || echo none",
        BASEMAP_DIR=str(tmp_path),
    ).split() == ["yes", "none"]


def test_tiers_list_every_area_and_source(tmp_path):
    # Each file as satellite.py writes it: its own first and last zoom in its header.
    def pmtiles(name, maxzoom, tile_type, minzoom):
        header = bytearray(pmtiles_header(maxzoom, minzoom))
        header[99] = tile_type
        (tmp_path / name).write_bytes(bytes(header))

    pmtiles("world.sat-overview.pmtiles", 8, 3, 0)
    pmtiles("bayern.sat-regional.pmtiles", 12, 4, 9)
    pmtiles("world.sat-regional.pmtiles", 10, 4, 9)
    pmtiles("belgium.sat-detailed-be_flanders.pmtiles", 17, 2, 14)  # PNG
    # More detail added later: a file of its own, from its own first zoom.
    pmtiles("alsace.sat-detailed-fr_ign.pmtiles", 15, 3, 14)
    pmtiles("alsace.sat-detailed-fr_ign-z16-17.pmtiles", 17, 3, 14)
    more = tmp_path / "alsace.sat-detailed-fr_ign-z16-17.pmtiles"
    header = bytearray(more.read_bytes())
    header[100] = 16
    more.write_bytes(bytes(header))
    value = bash("satellite_tiers_value france", BASEMAP_DIR=str(tmp_path))
    assert "Digitaal Vlaanderen" in value
    assert re.sub(r"\|[^;]*", "", value).split(";") == [
        "http://localhost:8090/world.sat-overview/{z}/{x}/{y}.jpg 0 8",
        "http://localhost:8090/world.sat-regional/{z}/{x}/{y}.webp 9 10",
        "http://localhost:8090/bayern.sat-regional/{z}/{x}/{y}.webp 9 12",
        "http://localhost:8090/alsace.sat-detailed-fr_ign/{z}/{x}/{y}.jpg 14 15",
        "http://localhost:8090/alsace.sat-detailed-fr_ign-z16-17/{z}/{x}/{y}.jpg 16 17",
        "http://localhost:8090/belgium.sat-detailed-be_flanders/{z}/{x}/{y}.png 14 17",
    ]


def test_every_schema_file_is_built_and_fingerprinted():
    built = bash('echo "${SCHEMA_FILES[@]}"').split()
    skipped = bash('echo "${SCHEMA_NOT_BUILT[@]}"').split()
    on_disk = {p.stem for p in (SCRIPTS.parent / "schema").glob("*.sql")}
    assert on_disk == set(built) | set(skipped), "add new schema/*.sql to SCHEMA_FILES"
    # build-region.sh runs them in the listed order (functions.sql and eez.sql run
    # elsewhere: at database creation, and in import_eez), with run_schema.
    script = (SCRIPTS / "build-region.sh").read_text()
    ran = [
        name
        for line in re.findall(r"^\s*run_schema ([a-z -]+)$", script, re.MULTILINE)
        for name in line.split()
    ]
    assert ran == [name for name in built if name not in ("functions", "eez")]
    labels = bash('echo "${!SCHEMA_LABELS[@]}"').split()
    assert set(ran) <= set(labels), "give each schema step a label in SCHEMA_LABELS"
    # Changing any of them changes the fingerprint.
    before = bash("schema_hash")
    assert len(before) == 12
    assert "local-stats" in built and "grid" in built and "search" in built


def test_run_with_timer_keep_going_returns_the_status():
    out = bash(
        'run_with_timer --keep-going "Step" bash -c "echo why; exit 75" 2>&1 || echo "status $?"'
    )
    assert "why" in out and out.endswith("status 75")
    # Without it, a failure stops the script.
    failed = subprocess.run(
        ["bash", "-c", f'source "{COMMON}"\nrun_with_timer "Step" false; echo after'],
        check=False,
        capture_output=True,
        text=True,
    )
    assert failed.returncode == 1 and "after" not in failed.stdout


def test_latest_line_shows_a_counter_rewriting_its_line(tmp_path):
    log = tmp_path / "log"
    log.write_text("  first\n  1,000/9,000 tiles\r  2,000/9,000 tiles\r\n\n")
    assert bash(f'latest_line "{log}"') == "2,000/9,000 tiles"


# --- Downloading safely (lib/net.sh) ----------------------------------------------

NET = "NET_WAIT_SECONDS=2; NET_CHECK_EVERY=1; sleep() { :; }; "


def test_safely_retries_while_the_server_answers():
    out = bash(
        NET
        + "reachable() { return 0; }; n=0; "
        + "flaky() { n=$((n + 1)); [[ $n -ge 3 ]]; }; "
        + 'safely https://example.org/x flaky 2>/dev/null; echo "status $? after $n"'
    )
    assert out.endswith("status 0 after 3")


def test_safely_gives_up_on_a_failing_download_when_the_server_answers():
    out = bash(
        NET
        + "reachable() { return 0; }; n=0; broken() { n=$((n + 1)); return 22; }; "
        + 'safely https://example.org/x broken 2>/dev/null; echo "status $? after $n"'
    )
    assert out.endswith("status 22 after 3")


def test_safely_waits_for_the_connection_then_goes_on():
    out = bash(
        NET
        + "checks=0; reachable() { checks=$((checks + 1)); [[ $checks -ge 2 ]]; }; "
        + "n=0; flaky() { n=$((n + 1)); [[ $n -ge 2 ]]; }; "
        + 'safely https://example.org/x flaky 2>/dev/null; echo "status $? after $n"'
    )
    assert out.endswith("status 0 after 2")


def test_safely_stops_when_the_connection_stays_down():
    out = bash(
        NET
        + "reachable() { return 1; }; n=0; down() { n=$((n + 1)); return 6; }; "
        + 'safely https://example.org/x down 2>/dev/null; echo "status $? after $n"'
    )
    assert out.endswith("status 75 after 1")


def test_safely_stops_at_once_when_only_the_server_stopped_answering():
    # The internet works (a probe answers), the server doesn't: 76, not 15 min.
    out = bash(
        "NET_WAIT_SECONDS=100000; NET_CHECK_EVERY=1; NET_SERVER_GRACE=2; sleep() { :; }; "
        + 'reachable() { [[ "$1" == https://www.google.com ]]; }; '
        + "n=0; down() { n=$((n + 1)); return 28; }; "
        + 'safely https://tiles.example.org/x down 2>/dev/null; echo "status $? after $n"'
    )
    assert out.endswith("status 76 after 1")


def test_a_download_that_hangs_is_stopped():
    out = bash(
        'run_with_timer --keep-going --stall 2 "Step" sleep 30 2>&1; echo "status $?"'
    )
    assert "No progress for 2s" in out and out.endswith("status 124")


def test_url_parts():
    assert (
        bash("url_origin https://example.org:8080/a/b?c") == "https://example.org:8080"
    )
    assert bash("url_host https://example.org/a") == "example.org"


# --- Other helpers ------------------------------------------------------------------


def test_choose_number_asks_again_until_valid():
    out = subprocess.run(
        ["bash", "-c", f'source "{COMMON}"\nchoose_number 3'],
        input="x\n5\n2\n",
        capture_output=True,
        text=True,
        check=True,
    )
    assert out.stdout.strip() == "2"
    # Enter or no input: the default; --or-enter without one: nothing, status 1.
    assert bash("choose_number 3 2 </dev/null") == "2"
    assert bash("choose_number --or-enter 3 <<<'' || echo back") == "back"


def test_duration():
    assert bash("duration 5") == "5s"
    assert bash("duration 125") == "2m 5s"
    assert bash("duration 3725") == "1h 2m 5s"


def test_json_write_and_get(tmp_path):
    f = tmp_path / "m.json"
    bash(f'json_write "{f}" name="Île-de-France" size:=12 empty=')
    assert json.loads(f.read_text()) == {
        "name": "Île-de-France",
        "size": 12,
        "empty": "",
    }
    assert bash(f'json_get "{f}" name') == "Île-de-France"
    assert bash(f'json_get "{f}" missing') == ""


def test_room_for(tmp_path):
    assert bash(f'room_for 1 "{tmp_path}" here >/dev/null && echo fits') == "fits"
    # Too big: asks (--yes keeps the "no" default).
    assert (
        bash(
            f'ASSUME_YES=1; room_for 999999999999999 "{tmp_path}" here >/dev/null || echo no'
        )
        == "no"
    )


def test_run_parallel_runs_steps_at_the_same_time():
    script = """
label() { echo "step $1"; }
step() { sleep 1; [[ $1 != 1 ]] || { echo "why it failed"; return 75; }; echo fine; }
start=$SECONDS
run_parallel 3 label step 2>&1 || echo "some failed"
echo "statuses ${JOB_STATUS[*]} in $((SECONDS - start))s"
"""
    out = bash(script)
    # Three one-second steps together: about one second, not three.
    assert out.endswith(("statuses 0 75 0 in 1s", "statuses 0 75 0 in 2s"))
    assert "why it failed" in out and "step 1 failed" in out and "some failed" in out
    assert "step 0" in out and "step 2" in out


def test_distances_in_the_build_sql_are_real_metres():
    # Map units stretch with latitude (schema/distances.sql): a distance written as
    # a bare number means something else in Norway than in France.
    raw = re.compile(
        r"ST_(DWithin|Buffer|Expand)\([^()]*(\([^()]*\)[^()]*)*,\s*[0-9.]+\s*\)"
    )
    found = []
    for sql in sorted((SCRIPTS.parent / "schema").glob("*.sql")):
        if sql.stem in ("functions", "views", "dev-init", "prod-init"):
            continue  # upstream's
        found += [f"{sql.name}: {m.group(0)}" for m in raw.finditer(sql.read_text())]
    assert found == [], "use oim_units / oim_max_stretch (schema/distances.sql)"


def test_older_sentinel_files_get_their_lower_zooms(tmp_path):
    calls = tmp_path / "calls"
    out = bash(
        f"""
python3() {{
    if [[ "$*" == *--list-needed* ]]; then echo old
    elif [[ "$*" == *satellite.py* ]]; then echo "python3 $*" >> "{calls}"
    else command python3 "$@"; fi
}}
docker() {{ echo "docker $*" >> "{calls}"; }}
basemap_image() {{ echo pmtiles:test; }}
catch_up_regional 2>&1
""",
        BASEMAP_DIR=str(tmp_path),
    )
    made = calls.read_text()
    # What satellite.py lists (lower_zooms_needed, tested there), and only that.
    assert "lower-zooms --region old" in made
    assert "restart basemap" in made  # the server reads the new file
    assert "adding its lower zooms" in out


def test_sentinel_starts_at_the_same_zoom_in_the_scripts_and_satellite_py():
    import satellite

    assert bash("echo $REGIONAL_FIRST_ZOOM") == str(satellite.TIERS["regional"][0])


def test_sentinel_shown_from_its_first_zoom_whatever_its_file_holds(tmp_path):
    (tmp_path / "france.sat-regional.pmtiles").write_bytes(pmtiles_header(13, 5))
    value = bash("satellite_tiers_value france", BASEMAP_DIR=str(tmp_path))
    assert "france.sat-regional/{z}/{x}/{y}.webp 7 13" in value
