"""Fork: offline maps. An area's railway lines, cut out of its OpenStreetMap extract
into <area>.railways.osm.pbf beside its background map, with osmium (in Docker).
The backend's zoomed out build ranks them (main, branch...) and draws them
(web-backend/src/fork/background/zoomed_railways.py): the background map's own
railways can't tell a main line from a branch line, and start at zoom 11. With the
tram, metro and light rail routes (ROUTES): each line's letter and colour.

The extract is the region build's (data/osm/<area>-latest.osm.pbf), downloaded from
Geofabrik if it isn't there (France: 5 GB, kept for the next build)."""

from __future__ import annotations

import os
import sys
from pathlib import Path

import netsafe

from . import docker
from .regions import GEOFABRIK_INDEX, OSM_DIR, Index

# The backend's source_of and KINDS (scripts/tests/test_one_source.py).
RAILWAYS = ".railways.osm.pbf"
KINDS = (
    "rail",
    "light_rail",
    "narrow_gauge",
    "subway",
    "tram",
    "funicular",
    "monorail",
    "preserved",
)
# The backend's TRANSIT_KINDS (scripts/tests/test_one_source.py): their routes.
ROUTES = ("tram", "subway", "light_rail")


def railways_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{RAILWAYS}"


def osm_extract(area: str) -> Path:
    """The area's OpenStreetMap extract, downloaded if it isn't there yet."""
    path = OSM_DIR / f"{area}-latest.osm.pbf"
    if path.exists():
        return path
    url = Index(str(GEOFABRIK_INDEX)).pbf_url(area)
    if not url:
        sys.exit(
            f"{area}: Geofabrik has no OpenStreetMap extract of it (its railways)."
        )
    print(
        f"Downloading {area}'s OpenStreetMap extract (for its railways)...",
        file=sys.stderr,
    )
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


def make_railways(folder: Path, area: str) -> None:
    """<area>.railways.osm.pbf: the extract's railway lines and its tram and metro
    routes (France: 3.5 min, 20 MB)."""
    extract = osm_extract(area)
    out = railways_of(folder, area)
    mount = Path(os.path.commonpath([extract.resolve().parent, folder.resolve()]))

    def inside(path: Path) -> str:
        return f"/w/{path.resolve().relative_to(mount)}"

    docker.run_service(
        "osmium",
        [
            "osmium",
            "tags-filter",
            inside(extract),
            f"w/railway={','.join(KINDS)}",
            f"r/route={','.join(ROUTES)}",
            "-o",
            inside(out),
            "--overwrite",
        ],
        mount,
        at="/w",
    )
