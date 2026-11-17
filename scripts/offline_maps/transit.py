"""Fork: offline maps. An area's trams and metro drawn by LOOM (University of
Freiburg; Docker service "loom", tools/loom): each line in its lane, side by side
where lines share a track, joined through junctions. Into <area>.transit.pmtiles,
beside its background map, which the backend serves at /background/transit.

Three steps, each in its own image: the backend writes LOOM's input from the
area's railways file, a graph per network (web-backend/.../loom_input.py); LOOM
draws each network (four at a time) into tiles; the backend packs them, marks the
tunnels and says which lines LOOM didn't draw (loom_tiles.py). France: 7 minutes."""

from __future__ import annotations

import shutil
from pathlib import Path

from . import docker

TRANSIT = ".transit.pmtiles"  # the backend's (scripts/tests/test_one_source.py)
LOOM_ZOOMS = range(12, 19)  # the backend's loom_tiles.ZOOMS
# A lane's width for transitmap: for tiles it takes a tenth of it, in its pixels (256
# to a tile), so 15 is 1.5 of them; the map's lane-layers.ts LANE_WIDTH, in its own
# pixels (512 to a tile), is twice that, 3.
LOOM_LINE_WIDTH = 15
# Tracks of one network LOOM takes as one, at most this far apart (metres): two
# tunnels side by side, tracks around a platform.
LOOM_MERGE_M = 50
PARALLEL = 4


def transit_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{TRANSIT}"


def work_of(folder: Path, area: str) -> Path:
    """The backend's loom_input.work_of."""
    return folder / f".{area}.loom"


def loom_script() -> str:
    """LOOM on each network (in-<n>.json): its tracks merged and lines ordered
    (out-<n>.json), drawn into tiles (tiles-<n>/)."""
    zooms = ",".join(str(z) for z in LOOM_ZOOMS)
    one = (
        f"mkdir -p tiles-N && topo -d {LOOM_MERGE_M} --max-comp-dist 50000 < in-N.json | loom > out-N.json"
        f" && transitmap --render-engine=mvt -z {zooms} --line-width {LOOM_LINE_WIDTH}"
        " --line-spacing 0 --outline-width 0 --mvt-path tiles-N < out-N.json"
    )
    return f'ls in-*.json | sed "s/^in-//; s/.json$//" | xargs -P {PARALLEL} -I N sh -c "{one}"'


def make_transit(folder: Path, area: str) -> None:
    """<area>.transit.pmtiles from the area's railways file (railways.py)."""
    docker.run_backend_module("loom_input", folder, area)
    work = work_of(folder, area)
    docker.run_service("loom", ["sh", "-c", loom_script()], work, at="/w")
    docker.run_backend_module("loom_tiles", folder, area)
    shutil.rmtree(work)
