"""Fork: extra data (scripts/extra_data.py): what the French sources share (FrenchSource)."""

import json
from pathlib import Path

import httpx

import netsafe

from .base import EXTRA_DIR, USER_AGENT, Source, inside, outer_rings


class FrenchSource(Source):
    """A source published per French département: which départements a region
    touches, and their outlines (Etalab)."""

    country = "FR"
    DEPARTMENTS_URL = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/departements-100m.geojson"
    # From this many départements on, a dataset is downloaded whole (national)
    # rather than filtered: simpler and faster than a long list of départements.
    NATIONAL_FROM = 20

    def __init__(self) -> None:
        self.http = httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(60, read=600)
        )

    def departments_file(self) -> Path:
        path = EXTRA_DIR / "fr-departements.geojson"
        if not path.exists():
            EXTRA_DIR.mkdir(parents=True, exist_ok=True)
            # Also asked for before a build (which extra data covers the region):
            # retried, but no waiting for a lost connection.
            response = netsafe.safely(
                lambda: netsafe.checked(
                    self.http.get(self.DEPARTMENTS_URL, follow_redirects=True)
                ),
                self.DEPARTMENTS_URL,
                wait=False,
            )
            path.write_bytes(response.content)
        return path

    def involved(self, region: dict) -> int:
        """Before a build, without a database: how many départements the region
        touches. A département counts if its centre is in the region, or a point of
        the region's outline is in it (a region inside a single département)."""
        region_rings = outer_rings(region)
        region_points = [
            p for ring in region_rings for p in ring[:: max(1, len(ring) // 500)]
        ]
        involved = 0
        for feature in json.loads(self.departments_file().read_text())["features"]:
            rings = outer_rings(feature["geometry"])
            ring = max(rings, key=len)
            centre = [
                sum(p[0] for p in ring) / len(ring),
                sum(p[1] for p in ring) / len(ring),
            ]
            if inside(centre, region_rings) or any(
                inside(p, rings) for p in region_points
            ):
                involved += 1
        return involved

    def areas(self, cur, region: str) -> list[str]:
        departments = json.loads(self.departments_file().read_text())["features"]
        cur.execute(
            "CREATE TEMP TABLE IF NOT EXISTS fr_department (code text, geom geometry)"
        )
        cur.execute("TRUNCATE fr_department")
        for feature in departments:
            cur.execute(
                "INSERT INTO fr_department VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))",
                (feature["properties"]["code"], json.dumps(feature["geometry"])),
            )
        cur.execute(
            """SELECT code FROM fr_department
                WHERE ST_Intersects(geom, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)) ORDER BY code""",
            (region,),
        )
        return [row[0] for row in cur.fetchall()]
