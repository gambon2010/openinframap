"""Fork: extra data (scripts/extra_data.py): Agence ORE: French electricity and gas distribution networks."""

import csv
import gzip
import json
import time
from pathlib import Path
from typing import ClassVar

import httpx

import netsafe

from .base import EXTRA_DIR, downloaded_on, remove_osm_duplicates
from .france import FrenchSource


class FranceAgenceORE(FrenchSource):
    """French electricity and gas distribution networks (all operators: Enedis,
    Strasbourg Électricité Réseaux, Vialis, GRDF, Régaz, …), as consolidated by
    Agence ORE. Downloaded whole or per département."""

    id = "fr-agence-ore"
    name = "Agence ORE: French electricity and gas distribution networks"
    licence = "Licence Ouverte 2.0 (Etalab)"
    attribution = "Agence ORE and French distribution network operators"
    url = "https://opendata.agenceore.fr"

    CHOICES: ClassVar[dict[str, tuple[str, list[str]]]] = {
        "electricity": (
            "Electricity distribution lines and substations (Agence ORE)",
            ["tension", "postes"],
        ),
        "gas": ("Gas distribution pipes (Agence ORE)", ["gaz"]),
        "biomethane": ("Biomethane injection points (Agence ORE)", ["biomethane"]),
    }
    # (all of France, per département), from the France import
    COST: ClassVar[dict[str, tuple[str, str]]] = {
        "electricity": (
            "~15 million features, ~5 GB, 2-3 hours to download",
            "~150,000 features and a few minutes per département",
        ),
        "gas": (
            "~4.3 million pipes, ~1 GB, ~35 minutes to download",
            "~45,000 pipes and ~20 seconds per département",
        ),
        "biomethane": ("851 sites, seconds", "a few sites, seconds"),
    }

    def offer(self, region: dict) -> list[tuple[str, str, str]]:
        involved = self.involved(region)
        if not involved:
            return []
        national = involved >= self.NATIONAL_FROM
        result = []
        for key, (label, words) in self.CHOICES.items():
            datasets = [d for d in self.DATASETS if any(w in d for w in words)]
            # Earlier downloads are reused (data/extra/agence-ore/): say so.
            saved = [self.cache_file(d, "all") for d in datasets]
            if all(p.exists() for p in saved):
                cost = f"downloaded {min(downloaded_on(p) for p in saved)}, no download needed"
            else:
                cost = self.COST[key][0] if national else self.COST[key][1]
            where = "all of France" if national else f"{involved} département(s)"
            result.append((key, label, f"{where}: {cost}"))
        return result

    API = "https://opendata.agenceore.fr/api/explore/v2.1/catalog/datasets"
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

    def where(self, departments: list[str]) -> str:
        return "code_departement IN (" + ", ".join(f'"{d}"' for d in departments) + ")"

    def estimate(self, areas: list[str]) -> int | None:
        total = 0
        for dataset, (table, _, _) in self.DATASETS.items():
            # Sites are a small national file (and use another département field).
            where = {} if table == "facility" else {"where": self.where(areas)}
            url = f"{self.API}/{dataset}/records"
            query = {**where, "limit": 0}
            # Asked for before a build: retried, no waiting for the connection.
            response = netsafe.safely(
                lambda url=url, query=query: netsafe.checked(
                    self.http.get(url, params=query)
                ),
                url,
                wait=False,
            )
            total += response.json()["total_count"]
        return total

    # Raw downloads are kept, like the OSM extracts in data/osm/, so re-importing
    # (a rebuild, another region, new rules) doesn't download them again (all of
    # France takes 3-4 hours). One national file per dataset, or one per
    # département for datasets fetched that way; each row has its département, so
    # any region can be cut from them. --refresh downloads them again.
    CACHE = EXTRA_DIR / "agence-ore"
    refresh = False
    fetched = 0  # files downloaded (rather than reused)

    def cache_file(self, dataset: str, scope: str) -> Path:
        return self.CACHE / dataset / f"{scope}.csv.gz"

    def fetch(
        self,
        dataset: str,
        select: str,
        where: str | None,
        path: Path,
        attempts: int = 3,
    ) -> bool:
        """Download a dataset's CSV export (filtered by `where`) to `path` (gzipped).
        Their server sometimes drops a long download midway: retried; False if every
        attempt failed."""
        params = {"select": select}
        if where:
            params["where"] = where
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".part")
        url = f"{self.API}/{dataset}/exports/csv"

        def download() -> None:
            with (
                self.http.stream("GET", url, params=params) as response,
                gzip.open(partial, "wb", compresslevel=5) as out,
            ):
                response.raise_for_status()
                for chunk in response.iter_bytes():
                    out.write(chunk)

        try:
            netsafe.safely(download, url, retries=attempts, pause=10, report=True)
        except httpx.HTTPError:
            partial.unlink(missing_ok=True)
            return False
        partial.rename(path)
        self.fetched += 1
        return True

    def files(
        self, dataset: str, select: str, areas: list[str], national: bool
    ) -> list[Path]:
        """The downloaded files covering `areas`, downloading what's missing."""
        everything = self.cache_file(dataset, "all")
        per_department = [self.cache_file(dataset, d) for d in areas]
        if self.refresh:
            everything.unlink(missing_ok=True)
            for path in per_department:
                path.unlink(missing_ok=True)
        if everything.exists():
            return [everything]
        if national and dataset not in self.BY_DEPARTMENT:
            if self.fetch(dataset, select, None, everything, attempts=2):
                return [everything]
            print(
                "      the national download keeps failing: by département instead",
                flush=True,
            )
        for department, path in zip(areas, per_department):
            if not path.exists() and not self.fetch(
                dataset, select, self.where([department]), path
            ):
                raise RuntimeError(
                    f"{dataset}: downloading département {department} failed"
                )
        return per_department

    def import_biomethane(self, conn, cur, dataset: str) -> int:
        """Biomethane injection points: small, so read whole and kept if in the region."""
        print(f"    {dataset}")
        path = self.cache_file(dataset, "all")
        if self.refresh:
            path.unlink(missing_ok=True)
        if path.exists():
            print(f"      using the download from {downloaded_on(path)}", flush=True)
        elif not self.fetch(dataset, "*", None, path):
            raise RuntimeError(f"{dataset}: download failed")
        with gzip.open(path, "rt", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f, delimiter=";"))
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

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        cur.execute(
            """CREATE TEMP TABLE IF NOT EXISTS extra_staging
                 (department text, operator text, attribute text, updated text, geojson text)"""
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
            select = f"code_departement,nom_grd,{attribute},date_maj,geometry"
            cur.execute("TRUNCATE extra_staging")
            print(
                f"    {dataset} ({'all of France' if national else 'départements ' + ', '.join(areas)})"
            )
            started = time.monotonic()
            self.fetched = 0
            paths = self.files(dataset, select, areas, national)
            fetched = time.monotonic() - started
            started = time.monotonic()
            for path in paths:
                with gzip.open(path, "rb") as f:
                    cur.copy_expert(
                        "COPY extra_staging FROM STDIN WITH (FORMAT csv, DELIMITER ';', HEADER true)",
                        f,
                    )
            if not national:
                # A national file covers more than the region needs.
                cur.execute(
                    "DELETE FROM extra_staging WHERE department <> ALL(%s)", (areas,)
                )
            cur.execute("SELECT count(*) FROM extra_staging")
            rows = cur.fetchone()[0]
            if self.fetched:
                print(f"      downloaded {rows} in {fetched:.0f} s", flush=True)
            else:
                oldest = min(downloaded_on(p) for p in paths)
                print(
                    f"      {rows} from the download of {oldest} (--refresh to download again)",
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
            self.duplicates_by[dataset] = duplicates
            # Saved dataset by dataset: what's done shows on the map and survives a later failure.
            conn.commit()
            print(
                f"      kept {inserted - duplicates} inside the region (replacing {replaced});"
                f" left out {duplicates} already in OpenStreetMap; {time.monotonic() - started:.0f} s",
                flush=True,
            )
        return count
