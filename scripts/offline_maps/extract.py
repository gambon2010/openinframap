"""Fork: offline maps. The background map (streets, places, buildings), cut out of
Protomaps' daily world build with pmtiles (in Docker) into
data/offline-maps/<area>.pmtiles, with its manifest (<area>.json: the build it came
from), then what it leaves out zoomed out, buildings and roads
(<area>.zoomed-out.pmtiles, zooms 8 to 14, made in the backend's image:
web-backend/src/fork/background/zoomed_out.py).
The backend serves them all together (web-backend/src/fork/background/).
Full detail only."""

from __future__ import annotations

import json
import re
import subprocess
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import netsafe

from . import docker, railways, ui
from .pmtiles import read_header
from .sources import SOURCES

PROTOMAPS = SOURCES["protomaps"]
BUILDS_URL = "https://build-metadata.protomaps.dev/builds.json"
PMTILES_IMAGE = "protomaps/go-pmtiles:v1.28.0"
# Buildings, roads and railways zoomed out, beside a background map with everything (zoom 15):
# the backend's COMPANION (scripts/tests/test_one_source.py).
ZOOMED_OUT = ".zoomed-out.pmtiles"
FULL_ZOOM = 15
# Their size and time against the background map's size (France, 2026-11-16).
ZOOMED_OUT_SIZE = 401 / 5390  # 401 MB from 5.4 GB
ZOOMED_OUT_SECONDS_PER_BYTE = 1274 / 5.39e9  # 21 min, 8 processes


def latest_build() -> tuple[str, int] | None:
    """(file, bytes) of Protomaps' latest world build, None without the network."""

    def get() -> bytes:
        # Protomaps refuses Python's own client name (403).
        request = urllib.request.Request(
            BUILDS_URL, headers={"User-Agent": netsafe.USER_AGENT}
        )
        with urllib.request.urlopen(request, timeout=20) as response:
            return response.read()

    try:
        build = json.loads(
            netsafe.safely(get, BUILDS_URL, retries=2, wait=False, rounds_up=0)
        )[-1]
    except (OSError, ValueError, KeyError, IndexError):
        return None
    return build["key"], int(build.get("size", 0))


def edition(build: str) -> str:
    """Protomaps' build file (20261110.pmtiles) as an edition (20261110)."""
    return build.removesuffix(".pmtiles")


def edition_date(value: str) -> str:
    """20261110 as 2026-11-10 (anything else as it is)."""
    if len(value) == 8 and value.isdigit():
        return f"{value[:4]}-{value[4:6]}-{value[6:8]}"
    return value


def manifest_edition(path: Path) -> str:
    """The edition a background map was cut from (its <area>.json), "" if unknown."""
    try:
        build = json.loads(path.with_suffix(".json").read_text()).get("build", "")
    except (OSError, ValueError, AttributeError):
        return ""
    return edition(str(build))


def pmtiles(folder: Path, args: list[str], **options) -> subprocess.CompletedProcess:
    """The pmtiles program (Docker), the offline maps' folder at /out."""
    return docker.run(PMTILES_IMAGE, args, folder, at="/out", **options)


# The whole world, as pmtiles extract takes it (web Mercator's limits).
WORLD_BBOX = "--bbox=-180,-85.0511,180,85.0511"
# The whole world zoomed out: every country's borders, names, coasts and main
# roads, like Blue Marble for imagery (560 MB at 8, measured 2026-11-11).
WORLD_LOW_ZOOM = 8


def extract_args(
    build: str, outline: Path | None, out: str, maxzoom: int | None = None
) -> list[str]:
    """pmtiles extract of an outline (a file in data/offline-maps/, /out in Docker), or
    of the whole world (no outline), up to a zoom if one is given."""
    area = f"--region=/out/{outline.name}" if outline else WORLD_BBOX
    args = ["extract", f"{PROTOMAPS.address}/{build}", out, area]
    return args + [f"--maxzoom={maxzoom}"] if maxzoom is not None else args


SIZE = re.compile(r"archive size of ([0-9.]+) ([kMGT]?)B")
UNITS = {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}


def size(
    folder: Path, build: str, outline: Path | None, maxzoom: int | None = None
) -> int | None:
    """What the background map of an outline (or the world, to a zoom) would
    weigh (a dry run), None if pmtiles can't tell."""
    run = pmtiles(
        folder,
        [*extract_args(build, outline, "/out/.dry-run.pmtiles", maxzoom), "--dry-run"],
        check=False,
        capture=True,
    )
    found = SIZE.findall(run.stdout + run.stderr)
    return int(float(found[-1][0]) * UNITS[found[-1][1]]) if found else None


def progress_printer(total: int):
    done = 0

    def show(n: int) -> None:
        nonlocal done
        done += n
        print(
            f"\r  {done / 1e9:.1f}/{total / 1e9:.1f} GB downloaded",
            end="",
            file=sys.stderr,
            flush=True,
        )

    return show


def command_basemap(args) -> None:
    """The background map of an area (offline-maps.py basemap), full detail: cut out
    of Protomaps' world map, or for the whole world its file itself (downloaded,
    resumable)."""
    folder = Path(args.maps_dir).resolve()
    out = folder / f"{args.area}.pmtiles"
    url = f"{PROTOMAPS.address}/{args.build}"
    if args.area == "world" and not args.maxzoom:
        total = args.size or 0
        partial = folder / ".world.partial.pmtiles"
        netsafe.fetch_file(
            url, partial, progress=progress_printer(total) if total else None
        )
        print(file=sys.stderr)
    else:
        if not args.outline and args.area != "world":
            sys.exit(f"{args.area}: its outline is needed (--outline).")
        outline = Path(args.outline).resolve() if args.outline else None
        partial = folder / f".{args.area}.partial.pmtiles"
        partial.unlink(missing_ok=True)
        netsafe.safely(
            lambda: pmtiles(
                folder,
                extract_args(args.build, outline, f"/out/{partial.name}", args.maxzoom),
            ),
            PROTOMAPS.address,
            also_retry=(subprocess.CalledProcessError,),
            report=True,
        )
    partial.replace(out)
    (folder / f"{args.area}.json").write_text(
        json.dumps(
            {
                "region_id": args.area,
                "build": args.build,
                "detail": "full",
                **({"maxzoom": args.maxzoom} if args.maxzoom else {}),
                "downloaded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"{ui.human(out.stat().st_size)} -> {out.name}", file=sys.stderr)
    if zoomed_out_missing(folder, args.area):
        try:
            make_zoomed_out(folder, args.area)
        except (subprocess.CalledProcessError, netsafe.ConnectionLost):
            # The background map is kept; the menu offers its zoomed out file again.
            print(
                f"Making its buildings, roads and railways zoomed out failed. Again: "
                f"python3 scripts/offline-maps.py zoomed-out --area {args.area}",
                file=sys.stderr,
            )


def zoomed_out_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{ZOOMED_OUT}"


def zoomed_out_missing(folder: Path, area: str) -> bool:
    """Whether an area's background map has every building (zoom 15) but not its
    buildings, roads and railways zoomed out (or its railways file), or only older
    ones than it."""
    background = folder / f"{area}.pmtiles"
    header = read_header(background)
    if not header or header.maxzoom < FULL_ZOOM:
        return False
    companion = zoomed_out_of(folder, area)
    return (
        not companion.exists()
        or not railways.railways_of(folder, area).exists()
        or companion.stat().st_mtime < background.stat().st_mtime
    )


def make_zoomed_out(folder: Path, area: str) -> None:
    """An area's buildings, roads and railways zoomed out: its railways cut out of its
    OpenStreetMap extract first (railways.py), then all made in the backend's image
    (its pmtiles, shapely and osmium packages; France: 21 min), as root (the image's
    Python is root's)."""
    if not railways.railways_of(folder, area).exists():
        railways.make_railways(folder, area)
    docker.run_service(
        "backend",
        [
            "/app/.venv/bin/python",
            "-m",
            "src.fork.background.zoomed_out",
            "--area",
            area,
            "--folder",
            "/work",
        ],
        folder,
        at="/work",
        as_root=True,
    )


def command_zoomed_out(args) -> None:
    """offline-maps.py zoomed-out --area AREA: an area already downloaded."""
    make_zoomed_out(Path(args.maps_dir), args.area)
