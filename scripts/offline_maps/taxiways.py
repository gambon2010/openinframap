"""Fork: offline maps. An area's taxiways and runways, cut out of its OpenStreetMap
extract (osm_extract.py) into <area>.taxiways.osm.pbf beside its background map. The
backend's zoomed out build finds the airports' stand lead-ins in it, mapped as
taxiways, and leaves them out of the map's roads
(web-backend/src/fork/background_build/stand_lead_ins.py)."""

from __future__ import annotations

from pathlib import Path

from .osm_extract import cut_out

# The backend's stand_lead_ins.TAXIWAYS (scripts/tests/test_one_source.py).
TAXIWAYS = ".taxiways.osm.pbf"


def taxiways_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{TAXIWAYS}"


def make_taxiways(folder: Path, area: str) -> None:
    """<area>.taxiways.osm.pbf: the extract's taxiways and runways (a taxiway meeting a
    runway isn't a dead end)."""
    cut_out(area, taxiways_of(folder, area), ["w/aeroway=taxiway,runway"])
