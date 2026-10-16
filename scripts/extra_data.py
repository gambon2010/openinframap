#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "psycopg2-binary"]
# ///
"""
Import infrastructure data from outside OpenStreetMap ("extra data") into the
extra schema (schema/extra.sql), for the region the database was built for.

    uv run scripts/extra_data.py list                 # sources covering the built region
    uv run scripts/extra_data.py import [SOURCE ...]  # import them (all by default)
    uv run scripts/extra_data.py remove SOURCE        # remove an import

Importing a source replaces what it imported before, one dataset at a time:
each dataset's old rows are deleted and its new ones inserted in a single
transaction, once the new copy has downloaded. So re-running never duplicates
rows, what's done shows on the map while the rest downloads, and a failed run
keeps the previous copy of every dataset it didn't finish. extra.source.features
stays empty until a whole import has finished. Each source is a class below;
add one per data provider.
"""

import argparse
import csv
import io
import json
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import ClassVar

import httpx
import psycopg2

REPO_ROOT = Path(__file__).resolve().parent.parent
EXTRA_DIR = REPO_ROOT / "data" / "extra"
GEOFABRIK_INDEX = REPO_ROOT / "data" / "osm" / "geofabrik-index-v1.json"
USER_AGENT = "OpenInfraMap-LocalDev/1.0 (https://github.com/gambon2010/openinframap)"


class StreamReader(io.RawIOBase):
    """A file-like object over an HTTP response, for psycopg2's COPY."""

    def __init__(self, chunks: Iterator[bytes]):
        self._chunks = chunks
        self._buffer = b""

    def readable(self) -> bool:
        return True

    def read(self, size: int = -1) -> bytes:
        while size < 0 or len(self._buffer) < size:
            try:
                self._buffer += next(self._chunks)
            except StopIteration:
                break
        if size < 0:
            data, self._buffer = self._buffer, b""
        else:
            data, self._buffer = self._buffer[:size], self._buffer[size:]
        return data


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
    else:
        cur.execute("SELECT extra.remove_osm_duplicate_substations(%s)", (source_id,))
    return cur.fetchone()[0]


class Source:
    id = ""
    name = ""
    country = ""
    licence = ""
    attribution = ""
    url = ""

    def offer(self, region: dict) -> str | None:
        """Before a build, without a database: what importing it for this region
        (a GeoJSON outline) would bring in, or None if it doesn't cover it."""
        return None

    def areas(self, cur, region: str) -> list[str]:
        """The parts of the region this source covers (empty: not applicable)."""
        raise NotImplementedError

    def estimate(self, areas: list[str]) -> int | None:
        """Roughly how many features the areas hold (before clipping to the region)."""
        return None

    # Features left out of the last run() because OpenStreetMap already has them.
    duplicates = 0

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        """Import into the extra tables (only the datasets whose name contains one of
        `only`, if given), committing as it goes, leaving out what
        OpenStreetMap already has; returns the feature count.
        Only features inside the temp table extra_region (the region outline, EPSG:3857) are kept."""
        raise NotImplementedError


class FranceAgenceORE(Source):
    """French electricity and gas distribution networks (all operators: Enedis,
    Strasbourg Électricité Réseaux, Vialis, GRDF, Régaz, …), as consolidated by
    Agence ORE. Downloaded whole or per département."""

    id = "fr-agence-ore"
    name = "Agence ORE: French electricity and gas distribution networks"
    country = "FR"
    licence = "Licence Ouverte 2.0 (Etalab)"
    attribution = "Agence ORE and French distribution network operators"
    url = "https://opendata.agenceore.fr"

    def offer(self, region: dict) -> str | None:
        # A département is involved if its centre is in the region, or a point of
        # the region's outline is in it (a region inside a single département).
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
        if not involved:
            return None
        if involved >= self.NATIONAL_FROM:
            return f"{involved} départements: ~21 million features for all of France (16M electricity, 4M gas), ~6 GB, 3-4 hours to download"
        return (
            f"{involved} département(s) touch the region, and only what lies inside it is kept:"
            " from a few hundred features (a border strip) to ~200,000 per département,"
            " a few minutes each"
        )

    API = "https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets"
    DEPARTMENTS_URL = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/2025/geojson/departements-100m.geojson"
    # dataset id -> (table, location, kind)
    DATASETS: ClassVar[dict[str, tuple[str, str | None, str | None]]] = {
        "reseau-aerien-basse-tension-bt": ("line", "overhead", None),
        "reseau-souterrain-basse-tension-bt": ("line", "underground", None),
        "reseau-aerien-moyenne-tension-hta": ("line", "overhead", None),
        "reseau-souterrain-moyenne-tension-hta": ("line", "underground", None),
        "postes-de-distribution-publique-postes-htabt": ("substation", None, "HTA/BT"),
        # Gas distribution pipes (GRDF, Régaz, GreenAlp, …). Pressure is mostly
        # "Inconnu" (all of GRDF's), stored as NULL.
        "infrastructures-reseau-gaz": ("pipeline", None, None),
        # Where biomethane enters the gas network (~850 sites, exact coordinates).
        # OSM has almost none of them (21 biogas plants in all of France, and those are
        # power plants), so nothing is checked against OSM.
        "points-dinjection-de-biomethane-en-france": (
            "facility",
            None,
            "biomethane_injection",
        ),
    }
    # Datasets whose national export their server tends to cut off midway (gas broke
    # after 0.6 and 3.2 of 4.2 million rows): always fetched département by département.
    BY_DEPARTMENT: ClassVar[set[str]] = {"infrastructures-reseau-gaz"}
    ATTRIBUTE: ClassVar[dict[str, str]] = {
        "line": "tension",
        "substation": "nom_poste",
        "pipeline": "niveau_de_pression",
    }

    def __init__(self) -> None:
        self.http = httpx.Client(
            headers={"User-Agent": USER_AGENT}, timeout=httpx.Timeout(60, read=600)
        )

    def departments_file(self) -> Path:
        path = EXTRA_DIR / "fr-departements.geojson"
        if not path.exists():
            EXTRA_DIR.mkdir(parents=True, exist_ok=True)
            response = self.http.get(self.DEPARTMENTS_URL, follow_redirects=True)
            response.raise_for_status()
            path.write_bytes(response.content)
        return path

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

    def where(self, departments: list[str]) -> str:
        return "code_departement IN (" + ", ".join(f'"{d}"' for d in departments) + ")"

    def estimate(self, areas: list[str]) -> int | None:
        total = 0
        for dataset in self.DATASETS:
            response = self.http.get(
                f"{self.API}/{dataset}/records",
                params={"where": self.where(areas), "limit": 0},
            )
            response.raise_for_status()
            total += response.json()["total_count"]
        return total

    def download(
        self, cur, dataset: str, select: str, where: str | None, attempts: int = 3
    ) -> bool:
        """Append a dataset's CSV export (filtered by `where`) to extra_staging. A failed
        attempt is undone (savepoint) and retried; False if every attempt failed."""
        params = {"select": select}
        if where:
            params["where"] = where
        for attempt in range(1, attempts + 1):
            cur.execute("SAVEPOINT download")
            try:
                with self.http.stream(
                    "GET", f"{self.API}/{dataset}/exports/csv", params=params
                ) as response:
                    response.raise_for_status()
                    cur.copy_expert(
                        "COPY extra_staging FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true)",
                        StreamReader(response.iter_bytes()),
                    )
                cur.execute("RELEASE SAVEPOINT download")
                return True
            except (httpx.HTTPError, psycopg2.Error) as error:
                cur.execute("ROLLBACK TO SAVEPOINT download")
                print(
                    f"      attempt {attempt} failed ({str(error).splitlines()[0][:120]})",
                    flush=True,
                )
                time.sleep(10 * attempt)
        return False

    def import_biomethane(self, conn, cur, dataset: str) -> int:
        """Biomethane injection points: small, so read whole and kept if in the region."""
        print(f"    {dataset}")
        response = self.http.get(
            f"{self.API}/{dataset}/exports/csv", params={"delimiter": ";"}
        )
        response.raise_for_status()
        rows = list(
            csv.DictReader(
                io.StringIO(response.content.decode("utf-8-sig")), delimiter=";"
            )
        )
        cur.execute(
            "DELETE FROM extra.facility WHERE source = %s AND kind = 'biomethane_injection'",
            (self.id,),
        )
        replaced = cur.rowcount
        kept = closed = 0
        for row in rows:
            if row.get("site_ouvert", "").lower() not in ("1", "true", "oui"):
                closed += 1  # closed sites aren't infrastructure any more
                continue
            try:
                lat, lon = (float(v) for v in row["coordonnees"].split(","))
            except (KeyError, ValueError):
                continue
            details = {
                "feedstock": row.get("site") or None,
                "process": row.get("procede") or None,
                "network": row.get("type_de_reseau") or None,
                "network_operator": row.get("grx_demandeur") or None,
                "planned_increase": row.get("augmentation_prevue") or None,
            }
            cur.execute(
                """INSERT INTO extra.facility (source, kind, name, operator, capacity, capacity_unit,
                                              opened, details, geometry)
                   SELECT %s, 'biomethane_injection', %s, NULL, NULLIF(%s, '')::numeric, 'GWh/year',
                          NULLIF(%s, '')::date, %s, g
                     FROM (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(%s, %s), 4326), 3857) AS g) p
                    WHERE EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, p.g))""",
                (
                    self.id,
                    row.get("nom_du_projet") or None,
                    row.get("capacite_de_production_gwh_an", ""),
                    (row.get("date_de_mes") or "")[:10],
                    json.dumps({k: v for k, v in details.items() if v}),
                    lon,
                    lat,
                ),
            )
            kept += cur.rowcount
        conn.commit()
        print(
            f"      kept {kept} inside the region of {len(rows)} (replacing {replaced}; {closed} closed sites left out)",
            flush=True,
        )
        return kept

    # From this many départements on, each dataset is downloaded whole (one national
    # file) rather than filtered: simpler and faster than a long list of départements.
    NATIONAL_FROM = 20

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        cur.execute(
            """CREATE TEMP TABLE IF NOT EXISTS extra_staging
                 (operator text, attribute text, updated text, geojson text)"""
        )
        geometry = "(ST_Dump(ST_Force2D(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(geojson), 4326), 3857)))).geom"
        national = len(areas) >= self.NATIONAL_FROM
        count = 0
        for dataset, (table, location, kind) in self.DATASETS.items():
            if only and not any(word in dataset for word in only):
                continue
            if table == "facility":
                count += self.import_biomethane(conn, cur, dataset)
                continue
            attribute = self.ATTRIBUTE[table]
            select = f"nom_grd,{attribute},date_maj,geometry"
            cur.execute("TRUNCATE extra_staging")
            print(
                f"    {dataset} ({'all of France' if national else 'départements ' + ', '.join(areas)})"
            )
            started = time.monotonic()
            # Their server sometimes drops a long download midway: retry, and if a
            # national download keeps failing, fetch it département by département.
            if national and (
                dataset in self.BY_DEPARTMENT
                or not self.download(cur, dataset, select, None, attempts=2)
            ):
                if dataset not in self.BY_DEPARTMENT:
                    print(
                        "      the national download keeps failing: by département instead",
                        flush=True,
                    )
                for department in areas:
                    if not self.download(
                        cur, dataset, select, self.where([department])
                    ):
                        raise RuntimeError(
                            f"{dataset}: downloading département {department} failed"
                        )
            elif not national and not self.download(
                cur, dataset, select, self.where(areas)
            ):
                raise RuntimeError(f"{dataset}: download failed")
            cur.execute("SELECT count(*) FROM extra_staging")
            print(
                f"      downloaded {cur.fetchone()[0]} in {time.monotonic() - started:.0f} s",
                flush=True,
            )
            started = time.monotonic()
            # Replace this dataset's previous import (same transaction as the insert).
            if table == "line":
                cur.execute(
                    "DELETE FROM extra.power_line WHERE source = %s AND location = %s AND voltage_class = %s",
                    (self.id, location, "BT" if "basse-tension" in dataset else "HTA"),
                )
            elif table == "pipeline":
                cur.execute(
                    "DELETE FROM extra.pipeline WHERE source = %s AND substance = 'gas'",
                    (self.id,),
                )
            else:
                cur.execute(
                    "DELETE FROM extra.power_substation WHERE source = %s", (self.id,)
                )
            replaced = cur.rowcount
            if table == "line":
                cur.execute(
                    f"""INSERT INTO extra.power_line (source, operator, voltage_class, location, updated, geometry)
                        SELECT %s, operator, attribute, %s, NULLIF(updated, '')::date, g
                          FROM (SELECT *, {geometry} AS g FROM extra_staging WHERE geojson <> '') AS s
                         WHERE GeometryType(g) = 'LINESTRING'
                           AND EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, g))""",
                    (self.id, location),
                )
            elif table == "pipeline":
                cur.execute(
                    f"""INSERT INTO extra.pipeline (source, operator, substance, pressure, updated, geometry)
                        SELECT %s, operator, 'gas', NULLIF(NULLIF(attribute, ''), 'Inconnu'),
                               NULLIF(updated, '')::date, g
                          FROM (SELECT *, {geometry} AS g FROM extra_staging WHERE geojson <> '') AS s
                         WHERE GeometryType(g) = 'LINESTRING'
                           AND EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, g))""",
                    (self.id,),
                )
            else:
                cur.execute(
                    f"""INSERT INTO extra.power_substation (source, operator, name, kind, updated, geometry)
                        SELECT %s, operator, NULLIF(attribute, ''), %s, NULLIF(updated, '')::date, g
                          FROM (SELECT *, {geometry} AS g FROM extra_staging WHERE geojson <> '') AS s
                         WHERE GeometryType(g) = 'POINT'
                           AND EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, g))""",
                    (self.id, kind),
                )
            inserted = cur.rowcount
            voltage_class = "BT" if "basse-tension" in dataset else "HTA"
            duplicates = remove_osm_duplicates(
                cur, self.id, table, location, voltage_class
            )
            count += inserted - duplicates
            self.duplicates += duplicates
            # Saved dataset by dataset: what's done shows on the map and survives a later failure.
            conn.commit()
            print(
                f"      kept {inserted - duplicates} inside the region (replacing {replaced});"
                f" left out {duplicates} already in OpenStreetMap; {time.monotonic() - started:.0f} s",
                flush=True,
            )
        return count


SOURCES: dict[str, Source] = {source.id: source for source in [FranceAgenceORE()]}


def ensure_schema(cur) -> None:
    cur.execute((REPO_ROOT / "schema" / "extra.sql").read_text())


def applicable(cur) -> list[tuple[Source, list[str]]]:
    region, _ = region_geojson(cur)
    # Features are clipped to the region: a source's areas can reach well beyond it.
    cur.execute("CREATE TEMP TABLE IF NOT EXISTS extra_region (geom geometry)")
    cur.execute("TRUNCATE extra_region")
    cur.execute(
        """INSERT INTO extra_region
           SELECT ST_Subdivide(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 3857), 128)""",
        (region,),
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS extra_region_geom ON extra_region USING gist (geom)"
    )
    cur.execute("ANALYZE extra_region")
    result = []
    for source in SOURCES.values():
        areas = source.areas(cur, region)
        if areas:
            result.append((source, areas))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import infrastructure data from outside OpenStreetMap."
    )
    parser.add_argument("--db-url", default="postgresql://osm:osm@localhost:5432/osm")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser(
        "list", help="sources covering the built region, with estimated sizes"
    )
    imp = sub.add_parser(
        "import", help="import sources (all applicable ones by default)"
    )
    imp.add_argument("sources", nargs="*")
    imp.add_argument(
        "--only",
        nargs="+",
        metavar="WORD",
        help="only the datasets whose name contains one of these words, e.g. --only gaz",
    )
    sub.add_parser(
        "dedupe",
        help="delete imported features OpenStreetMap already has (import does it as it goes)",
    )
    rem = sub.add_parser("remove", help="remove an imported source")
    rem.add_argument("source")
    off = sub.add_parser(
        "offer",
        help="before a build (no database needed): sources that may cover a Geofabrik region."
        " Exit 0: some, 1: none, 2: unknown region",
    )
    off.add_argument("--region-id", required=True)
    args = parser.parse_args()

    if args.command == "offer":
        region = region_geometry(args.region_id)
        if region is None:
            sys.exit(2)
        found = False
        for source in SOURCES.values():
            note = source.offer(region)
            if note:
                print(f"{source.name}: {note}")
                found = True
        sys.exit(0 if found else 1)

    conn = psycopg2.connect(args.db_url)
    cur = conn.cursor()
    ensure_schema(cur)
    conn.commit()

    if args.command == "dedupe":
        cur.execute("SELECT source FROM extra.source ORDER BY source")
        for (source_id,) in cur.fetchall():
            total = 0
            cur.execute(
                "SELECT DISTINCT location, voltage_class FROM extra.power_line WHERE source = %s ORDER BY 1, 2",
                (source_id,),
            )
            parts = [("line", location, cls) for location, cls in cur.fetchall()] + [
                ("substation", None, None),
                ("pipeline", None, None),
            ]
            for table, location, cls in parts:
                started = time.monotonic()
                removed = remove_osm_duplicates(cur, source_id, table, location, cls)
                conn.commit()
                total += removed
                what = f"{location} {cls} lines" if table == "line" else table + "s"
                print(
                    f"{source_id}: {what}: removed {removed} already in OpenStreetMap ({time.monotonic() - started:.0f} s)",
                    flush=True,
                )
            cur.execute(
                f"""UPDATE extra.source SET osm_duplicates = coalesce(osm_duplicates, 0) + %s,
                       features = {FEATURE_COUNT}
                    WHERE source = %s""",
                (total, source_id),
            )
            conn.commit()
            print(f"{source_id}: {total} removed in all.")
        print("Refresh the tile server: docker compose up -d --force-recreate tegola")
        return

    if args.command == "remove":
        cur.execute("DELETE FROM extra.source WHERE source = %s", (args.source,))
        conn.commit()
        print(f"Removed {args.source} ({cur.rowcount} source).")
        return

    _, region_name = region_geojson(cur)
    sources = applicable(cur)
    if args.command == "list":
        if not sources:
            print(f"No extra data sources cover {region_name}.")
        for source, areas in sources:
            print(
                f"{source.id}\t{source.name}\t{len(areas)} area(s): {', '.join(areas)}\t~{source.estimate(areas)} features before clipping to the region"
            )
        return

    wanted = set(args.sources) or {s.id for s, _ in sources}
    unknown = wanted - set(SOURCES)
    if unknown:
        sys.exit(
            f"Unknown source(s): {', '.join(sorted(unknown))}. Known: {', '.join(SOURCES)}"
        )
    for source, areas in sources:
        if source.id not in wanted:
            continue
        print(
            f"Importing {source.name} for {region_name} ({len(areas)} area(s): {', '.join(areas)})"
        )
        # The source's description; its data is replaced dataset by dataset (see run()).
        cur.execute(
            """INSERT INTO extra.source (source, name, country, licence, attribution, url, area)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (source) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
                   licence = EXCLUDED.licence, attribution = EXCLUDED.attribution, url = EXCLUDED.url,
                   area = EXCLUDED.area, features = NULL""",
            (
                source.id,
                source.name,
                source.country,
                source.licence,
                source.attribution,
                source.url,
                ", ".join(areas),
            ),
        )
        count = source.run(conn, cur, areas, args.only)
        # All of the source's features, also those of datasets not re-imported (--only).
        cur.execute(
            f"""UPDATE extra.source SET features = {FEATURE_COUNT},
                   osm_duplicates = CASE WHEN %s THEN coalesce(osm_duplicates, 0) ELSE 0 END + %s,
                   imported_at = now()
                WHERE source = %s""",
            (bool(args.only), source.duplicates, source.id),
        )
        conn.commit()
        print(f"  {count} features imported.")
    for name in wanted - {s.id for s, _ in sources}:
        print(f"{name} doesn't cover {region_name}; nothing imported.")
    # Tegola caches tiles up to zoom 13; recreating it drops the cache.
    print(
        "If the tile server is running, refresh it with: docker compose up -d --force-recreate tegola"
    )


if __name__ == "__main__":
    main()
