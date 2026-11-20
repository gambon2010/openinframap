"""Fork: offline maps. An area's railway lines, cut out of its OpenStreetMap extract
(osm_extract.py) into <area>.railways.osm.pbf beside its background map. The
backend's zoomed out build ranks them (main, branch...) and draws them
(web-backend/src/fork/background_build/zoomed_railways.py): the background map's own
railways can't tell a main line from a branch line, and start at zoom 11. With the
tram, metro and light rail routes (ROUTES): each line's letter and colour."""

from __future__ import annotations

from pathlib import Path

from .osm_extract import cut_out

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


def make_railways(folder: Path, area: str) -> None:
    """<area>.railways.osm.pbf: the extract's railway lines and its tram and metro
    routes (France: 3.5 min, 20 MB)."""
    cut_out(
        area,
        railways_of(folder, area),
        [f"w/railway={','.join(KINDS)}", f"r/route={','.join(ROUTES)}"],
    )
