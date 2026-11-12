"""Fork: offline maps. The background map (streets, places, buildings), cut out of
Protomaps' daily world build with pmtiles (in Docker) into
data/basemap/<area>.pmtiles, with its manifest (<area>.json: the build it came
from). The backend serves them all together (web-backend/src/fork/background/).
Full detail only."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import netsafe

from . import ui
from .sources import SOURCES

PROTOMAPS = SOURCES["protomaps"]
BUILDS_URL = "https://build-metadata.protomaps.dev/builds.json"
PMTILES_IMAGE = "protomaps/go-pmtiles:v1.28.0"


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


def pmtiles(folder: Path, args: list[str]) -> list[str]:
    """The pmtiles command, data/basemap/ at /out."""
    return [
        "docker",
        "run",
        "--rm",
        "--user",
        f"{os.getuid()}:{os.getgid()}",
        "-v",
        f"{folder.resolve()}:/out:z",
        PMTILES_IMAGE,
        *args,
    ]


# The whole world, as pmtiles extract takes it (web Mercator's limits).
WORLD_BBOX = "--bbox=-180,-85.0511,180,85.0511"
# The whole world zoomed out: every country's borders, names, coasts and main
# roads, like Blue Marble for imagery (560 MB at 8, measured 2026-11-11).
WORLD_LOW_ZOOM = 8


def extract_args(
    build: str, outline: Path | None, out: str, maxzoom: int | None = None
) -> list[str]:
    """pmtiles extract of an outline (a file in data/basemap/, /out in Docker), or
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
    run = subprocess.run(
        pmtiles(
            folder,
            [
                *extract_args(build, outline, "/out/.dry-run.pmtiles", maxzoom),
                "--dry-run",
            ],
        ),
        check=False,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
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
    """The background map of an area (satellite.py basemap), full detail: cut out
    of Protomaps' world map, or for the whole world its file itself (downloaded,
    resumable)."""
    folder = Path(args.basemap_dir).resolve()
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
        command = pmtiles(
            folder,
            extract_args(args.build, outline, f"/out/{partial.name}", args.maxzoom),
        )
        netsafe.safely(
            lambda: subprocess.run(command, check=True, stdin=subprocess.DEVNULL),
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


REPO_ROOT = Path(__file__).resolve().parents[2]


def command_large_buildings(args) -> None:
    """The large buildings shown zoomed out, found again from the background maps
    there (web-backend/src/fork/background/large_buildings.py, in the backend's
    image; ~10 min for France), then Tegola's tiles of them forgotten. After a
    background map is added or removed (satellite.py large-buildings)."""
    run = ["docker", "compose", "--progress", "quiet"]
    subprocess.run(
        [
            *run,
            "run",
            "--rm",
            "--no-deps",
            "--entrypoint",
            "/app/.venv/bin/python",
            "backend",
            "-m",
            "src.fork.background.large_buildings",
        ],
        cwd=REPO_ROOT,
        check=True,
        stdin=subprocess.DEVNULL,
    )
    subprocess.run(
        [*run, "up", "-d", "--force-recreate", "tegola"],
        cwd=REPO_ROOT,
        check=True,
        stdin=subprocess.DEVNULL,
    )
