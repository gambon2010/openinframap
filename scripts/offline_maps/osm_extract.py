"""Fork: offline maps. An area's OpenStreetMap extract, and things cut out of it
with osmium (in Docker) beside its background map, for the backend's zoomed out
build: its railways (railways.py), its taxiways (taxiways.py).

The extract is the region build's (data/downloads/osm/<area>-latest.osm.pbf), downloaded from
Geofabrik if it isn't there (France: 5 GB, kept for the next build)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import netsafe

from . import docker
from .regions import GEOFABRIK_INDEX, OSM_DIR, Index


def osm_extract(area: str) -> Path:
    """The area's OpenStreetMap extract, downloaded if it isn't there yet."""
    path = OSM_DIR / f"{area}-latest.osm.pbf"
    if path.exists():
        return path
    url = Index(str(GEOFABRIK_INDEX)).pbf_url(area)
    if not url:
        sys.exit(f"{area}: Geofabrik has no OpenStreetMap extract of it.")
    print(f"Downloading {area}'s OpenStreetMap extract...", file=sys.stderr)
    path.parent.mkdir(parents=True, exist_ok=True)
    netsafe.fetch_file(url, path, progress=downloaded_counter())
    print(file=sys.stderr)
    return path


def downloaded_counter():
    """progress(n) for fetch_file: how much has arrived so far."""
    done = 0

    def show(n: int) -> None:
        nonlocal done
        done += n
        print(
            f"\r  {done / 1e9:.1f} GB downloaded", end="", file=sys.stderr, flush=True
        )

    return show


def cut_out(area: str, out: Path, filters: list[str]) -> None:
    """What osmium's tags-filter `filters` keep of the area's extract, into `out`
    (the ways' nodes with them)."""
    extract = osm_extract(area)
    mount = Path(os.path.commonpath([extract.resolve().parent, out.resolve().parent]))

    def inside(path: Path) -> str:
        return f"/w/{path.resolve().relative_to(mount)}"

    docker.run_service(
        "osmium",
        [
            "osmium",
            "tags-filter",
            inside(extract),
            *filters,
            "-o",
            inside(out),
            "--overwrite",
        ],
        mount,
        at="/w",
    )
