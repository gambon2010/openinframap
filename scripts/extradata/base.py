"""Fork: extra data (scripts/extra_data.py): what every source shares: paths, streaming downloads into COPY, the region's outline, removing what OpenStreetMap already has, and the Source class."""

import json
import sys
import time
from pathlib import Path
from typing import ClassVar

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
EXTRA_DIR = REPO_ROOT / "data" / "extra"
GEOFABRIK_INDEX = REPO_ROOT / "data" / "osm" / "geofabrik-index-v1.json"
USER_AGENT = "OpenInfraMap-LocalDev/1.0 (https://github.com/gambon2010/openinframap)"


def region_geojson(cur) -> tuple[str, str]:
    """The built region's outline (GeoJSON, WGS84) and name. Uses the Geofabrik
    outline when known, otherwise the extent of the imported power lines."""
    cur.execute(
        "SELECT key, value FROM oim_build_info WHERE key IN ('region_id', 'region_name')"
    )
    info = dict(cur.fetchall())
    region_id, name = info.get("region_id"), info.get("region_name", "?")
    if region_id and GEOFABRIK_INDEX.exists():
        for feature in json.loads(GEOFABRIK_INDEX.read_text())["features"]:
            if feature["properties"]["id"] == region_id and feature.get("geometry"):
                return json.dumps(feature["geometry"]), name
    cur.execute(
        """SELECT ST_AsGeoJSON(ST_Transform(ST_SetSRID(ST_Extent(geometry)::geometry, 3857), 4326))
             FROM osm_power_line"""
    )
    extent = cur.fetchone()[0]
    if not extent:
        sys.exit(
            "Can't tell which area the database covers (no region outline, no power lines)."
        )
    return extent, name


def region_geometry(region_id: str) -> dict | None:
    """A Geofabrik region's outline (GeoJSON, WGS84), from the downloaded index."""
    if not GEOFABRIK_INDEX.exists():
        return None
    for feature in json.loads(GEOFABRIK_INDEX.read_text())["features"]:
        if feature["properties"]["id"] == region_id and feature.get("geometry"):
            return feature["geometry"]
    return None


def outer_rings(geometry: dict) -> list[list[list[float]]]:
    polygons = (
        [geometry["coordinates"]]
        if geometry["type"] == "Polygon"
        else geometry["coordinates"]
    )
    return [polygon[0] for polygon in polygons]


def inside(point: list[float], rings: list[list[list[float]]]) -> bool:
    """Whether a point is inside any of the rings (ray casting; holes ignored)."""
    x, y = point[0], point[1]
    for ring in rings:
        hit = False
        for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]):
            if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
                hit = not hit
        if hit:
            return True
    return False


# SQL: all the features of the extra.source row being updated.
FEATURE_COUNT = """((SELECT count(*) FROM extra.power_line l WHERE l.source = extra.source.source)
    + (SELECT count(*) FROM extra.power_substation s WHERE s.source = extra.source.source)
    + (SELECT count(*) FROM extra.pipeline p WHERE p.source = extra.source.source)
    + (SELECT count(*) FROM extra.facility f WHERE f.source = extra.source.source))"""


def remove_osm_duplicates(
    cur, source_id: str, table: str, location=None, voltage_class=None
) -> int:
    """Delete a source's features OpenStreetMap already has (schema/extra.sql has the
    rules); the OSM data is left as it is. Returns how many were deleted."""
    cur.execute("SELECT to_regclass('public.osm_power_line') IS NOT NULL")
    if not cur.fetchone()[0]:
        return 0
    if table == "line":
        cur.execute(
            "SELECT extra.remove_osm_duplicate_lines(%s, %s, %s)",
            (source_id, location, voltage_class),
        )
    elif table == "pipeline":
        cur.execute(
            "SELECT extra.remove_osm_duplicate_pipelines(%s, 'gas')", (source_id,)
        )
    elif table == "icpe":
        cur.execute("SELECT extra.remove_osm_duplicate_icpe(%s)", (source_id,))
    else:
        cur.execute("SELECT extra.remove_osm_duplicate_substations(%s)", (source_id,))
    return cur.fetchone()[0]


def downloaded_on(path: Path) -> str:
    return time.strftime("%Y-%m-%d", time.localtime(path.stat().st_mtime))


class Source:
    id = ""
    name = ""
    country = ""
    licence = ""
    attribution = ""
    url = ""

    # What can be chosen separately: key -> (label, words matching its datasets' names).
    CHOICES: ClassVar[dict[str, tuple[str, list[str]]]] = {}

    def offer(self, region: dict) -> list[tuple[str, str, str]]:
        """Before a build, without a database: the choices that cover this region (a
        GeoJSON outline), as (key, label, what importing it costs); empty if none."""
        return []

    def areas(self, cur, region: str) -> list[str]:
        """The parts of the region this source covers (empty: not applicable)."""
        raise NotImplementedError

    def estimate(self, areas: list[str]) -> int | None:
        """Roughly how many features the areas hold (before clipping to the region)."""
        return None

    # Features left out of the last run() because OpenStreetMap already has them.
    duplicates = 0
    duplicates_by: dict[str, int]  # ... per dataset (set in run())

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        """Import into the extra tables (only the datasets whose name contains one of
        `only`, if given), committing as it goes, leaving out what
        OpenStreetMap already has; returns the feature count.
        Only features inside the temp table extra_region (the region outline, EPSG:3857) are kept."""
        raise NotImplementedError
