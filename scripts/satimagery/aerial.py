"""Fork: offline maps. Aerial photos fetched tile by tile from an agency's server
(a tile template or a WMS): what one source downloads for an area, where its file
goes, how big it will be. (IGN's, fetched as files: bdortho.py.)"""

from __future__ import annotations

from pathlib import Path

from .estimate import detailed_estimate
from .regions import Index
from .sources import SOURCES
from .tiles import box_ring, load_rings


def detailed_job(source_id: str, area: str, index: Index, folder: Path) -> dict | None:
    """What one source downloads for an area: the area, cut to the source's region."""
    region = SOURCES[source_id].regions[0]
    clip = index.outline(region, folder)
    if not clip:
        return None
    if area == "world" or index.within(region, area):
        return {"source": source_id, "outline": str(clip), "clip": None}
    outline = index.outline(area, folder)
    return outline and {"source": source_id, "outline": str(outline), "clip": str(clip)}


def detailed_file(folder: Path, area: str, source: str) -> Path:
    """Where a source's aerial photos of an area go. More detail later makes the
    file again up to the new zoom (replaced once it's finished), as IGN's
    départements are: one file, one rule."""
    return folder / f"{area}.sat-detailed-{source}.pmtiles"


def job_estimate(job: dict) -> dict:
    """Tiles and bytes by last zoom, inside the area, the source's region and its
    own limit (Belgium's two regions)."""
    source = SOURCES[job["source"]]
    outlines = [load_rings(job["outline"])]
    if job["clip"]:
        outlines.append(load_rings(job["clip"]))
    if source.bbox:
        outlines.append(box_ring(source.bbox))
    return detailed_estimate(outlines, source)
