"""Fork: offline maps. The background map (streets, places, buildings), cut out of
Protomaps' daily world build with pmtiles (in Docker) into
data/basemap/<area>.pmtiles, with its manifest (<area>.json, as
scripts/lib/basemap.sh writes it)."""

from __future__ import annotations

import json
import os
import re
import subprocess
import urllib.request
from datetime import UTC, datetime
from pathlib import Path

import netsafe

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


def extract_args(build: str, outline: Path, detail: str) -> list[str]:
    args = ["extract", f"{PROTOMAPS.address}/{build}"]
    args += ["", f"--region=/out/{outline.name}"]
    if detail == "reduced":
        args.append(f"--maxzoom={PROTOMAPS.sizes['reduced_zoom']}")
    return args


SIZE = re.compile(r"archive size of ([0-9.]+) ([kMGT]?)B")
UNITS = {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}


def size(folder: Path, build: str, outline: Path, detail: str) -> int | None:
    """What the background map of an outline would weigh (a dry run), None if
    pmtiles can't tell."""
    args = extract_args(build, outline, detail)
    args[2] = "/out/.dry-run.pmtiles"
    run = subprocess.run(
        pmtiles(folder, [*args, "--dry-run"]),
        check=False,
        capture_output=True,
        text=True,
        stdin=subprocess.DEVNULL,
    )
    found = SIZE.findall(run.stdout + run.stderr)
    return int(float(found[-1][0]) * UNITS[found[-1][1]]) if found else None


def command_basemap(args) -> None:
    """Cut the background map of an area (satellite.py basemap)."""
    folder = Path(args.basemap_dir).resolve()
    outline = Path(args.outline).resolve()
    partial = folder / f".{args.area}.partial.pmtiles"
    command = extract_args(args.build, outline, args.detail)
    command[2] = f"/out/{partial.name}"
    partial.unlink(missing_ok=True)
    netsafe.safely(
        lambda: subprocess.run(
            pmtiles(folder, command), check=True, stdin=subprocess.DEVNULL
        ),
        PROTOMAPS.address,
        also_retry=(subprocess.CalledProcessError,),
        report=True,
    )
    partial.replace(folder / f"{args.area}.pmtiles")
    (folder / f"{args.area}.json").write_text(
        json.dumps(
            {
                "region_id": args.area,
                "build": args.build,
                "detail": args.detail,
                "downloaded_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            indent=2,
        )
        + "\n"
    )
