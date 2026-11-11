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
        with urllib.request.urlopen(BUILDS_URL, timeout=20) as response:
            return response.read()

    try:
        build = json.loads(
            netsafe.safely(get, BUILDS_URL, retries=2, wait=False, rounds_up=0)
        )[-1]
    except (OSError, ValueError, KeyError, IndexError):
        return None
    return build["key"], int(build.get("size", 0))


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


def extract_args(build: str, outline: Path, out: str) -> list[str]:
    """pmtiles extract of an outline (a file in data/basemap/, /out in Docker)."""
    return [
        "extract",
        f"{PROTOMAPS.address}/{build}",
        out,
        f"--region=/out/{outline.name}",
    ]


SIZE = re.compile(r"archive size of ([0-9.]+) ([kMGT]?)B")
UNITS = {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}


def size(folder: Path, build: str, outline: Path) -> int | None:
    """What the background map of an outline would weigh (a dry run), None if
    pmtiles can't tell."""
    run = subprocess.run(
        pmtiles(
            folder,
            [*extract_args(build, outline, "/out/.dry-run.pmtiles"), "--dry-run"],
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
    if args.area == "world":
        total = args.size or 0
        partial = folder / ".world.partial.pmtiles"
        netsafe.fetch_file(
            url, partial, progress=progress_printer(total) if total else None
        )
        print(file=sys.stderr)
    else:
        if not args.outline:
            sys.exit(f"{args.area}: its outline is needed (--outline).")
        outline = Path(args.outline).resolve()
        partial = folder / f".{args.area}.partial.pmtiles"
        partial.unlink(missing_ok=True)
        command = pmtiles(
            folder, extract_args(args.build, outline, f"/out/{partial.name}")
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
                "downloaded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            indent=2,
        )
        + "\n"
    )
    print(f"{ui.human(out.stat().st_size)} -> {out.name}", file=sys.stderr)
