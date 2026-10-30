"""Fork: extra data (scripts/extra_data.py): Géorisques: French classified installations (ICPE), Seveso sites among them."""

import gzip
import json
import time
from typing import ClassVar

import httpx
import psycopg2
import psycopg2.extras

from .base import EXTRA_DIR, downloaded_on, remove_osm_duplicates
from .france import FrenchSource


class GeorisquesICPE(FrenchSource):
    """French "installations classées pour la protection de l'environnement" (ICPE):
    industrial sites, quarries, wind farms and large livestock farms regulated for
    their risks or pollution, Seveso sites among them, from Géorisques' API."""

    id = "fr-georisques-icpe"
    name = "Géorisques: French classified installations (ICPE)"
    # Géorisques data is published under Licence Ouverte; no page states it for the
    # API itself.
    licence = "Licence Ouverte 2.0 (Etalab)"
    attribution = "Géorisques (French Ministry of Ecological Transition, BRGM)"
    url = "https://www.georisques.gouv.fr"
    API = "https://georisques.gouv.fr/api/v1/installations_classees"
    PAGE_SIZE = 1000  # the most the API accepts
    CACHE = EXTRA_DIR / "georisques-icpe"
    refresh = False

    CHOICES: ClassVar[dict[str, tuple[str, list[str]]]] = {
        "icpe": (
            "Classified installations, Seveso sites among them (Géorisques ICPE)",
            ["icpe"],
        ),
    }

    def offer(self, region: dict) -> list[tuple[str, str, str]]:
        involved = self.involved(region)
        if not involved:
            return []
        saved = self.CACHE / "all.json.gz"
        where = (
            "all of France"
            if involved >= self.NATIONAL_FROM
            else f"{involved} département(s)"
        )
        if saved.exists():
            cost = f"downloaded {downloaded_on(saved)}, no download needed"
        elif involved >= self.NATIONAL_FROM:
            cost = "~40,000 sites, ~3 minutes to download"
        else:
            cost = "a few hundred sites each, seconds"
        return [("icpe", self.CHOICES["icpe"][0], f"{where}: {cost}")]

    def fetch(self, department: str | None) -> list[dict]:
        """All the sites of a département (or of France), page by page."""
        params = {"page_size": self.PAGE_SIZE}
        if department:
            params["departement"] = department
        rows: list[dict] = []
        page, pages = 1, 1
        while page <= pages:
            for attempt in range(1, 4):
                try:
                    response = self.http.get(self.API, params={**params, "page": page})
                    response.raise_for_status()
                    break
                except httpx.HTTPError as error:
                    print(
                        f"      page {page}: attempt {attempt} failed ({str(error).splitlines()[0][:100]})",
                        flush=True,
                    )
                    if attempt == 3:
                        raise
                    time.sleep(10 * attempt)
            body = response.json()
            rows += body.get("data") or []
            pages = body.get("total_pages") or 0
            page += 1
        return rows

    def sites(self, areas: list[str]) -> list[dict]:
        """The downloaded sites covering `areas` (kept in data/extra/georisques-icpe/)."""
        national = len(areas) >= self.NATIONAL_FROM
        # A national download covers any smaller region too (sites outside it are
        # left out by the region outline).
        everything = self.CACHE / "all.json.gz"
        scopes = (
            ["all"] if national or (everything.exists() and not self.refresh) else areas
        )
        rows: list[dict] = []
        for scope in scopes:
            path = self.CACHE / f"{scope}.json.gz"
            if self.refresh:
                path.unlink(missing_ok=True)
            if path.exists():
                print(
                    f"      {scope}: using the download from {downloaded_on(path)}",
                    flush=True,
                )
            else:
                started = time.monotonic()
                data = self.fetch(None if scope == "all" else scope)
                self.CACHE.mkdir(parents=True, exist_ok=True)
                with gzip.open(path.with_suffix(".part"), "wt", encoding="utf-8") as f:
                    json.dump(data, f)
                path.with_suffix(".part").rename(path)
                print(
                    f"      {scope}: downloaded {len(data)} sites in {time.monotonic() - started:.0f} s",
                    flush=True,
                )
            with gzip.open(path, "rt", encoding="utf-8") as f:
                rows += json.load(f)
        return rows

    @staticmethod
    def category(row: dict) -> str:
        seveso = row.get("statutSeveso") or ""
        if "haut" in seveso:
            return "seveso_high"
        if "bas" in seveso:
            return "seveso_low"
        if row.get("eolienne"):
            return "wind"
        if row.get("carriere"):
            return "quarry"
        if row.get("bovins") or row.get("porcs") or row.get("volailles"):
            return "livestock"
        return "industry"

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        if only and not any(word in "icpe" for word in only):
            return 0
        print("    installations classées")
        rows = self.sites(areas)
        # Only operating sites under the two regulated regimes (authorisation,
        # registration). Left out: closing sites, and "other regimes" / "not ICPE"
        # records (80,000 lower-tier declarations, without details).
        keep = [
            r
            for r in rows
            if (r.get("etatActivite") or "").startswith("En exploitation")
            and r.get("longitude") is not None
            and r.get("latitude") is not None
        ]
        values = []
        for r in keep:
            inspections = sorted(
                i.get("dateInspection") or "" for i in r.get("inspections") or []
            )
            activities = [
                " ".join(
                    x
                    for x in (
                        a.get("nature"),
                        a.get("quantiteTotale")
                        and f"({float(a['quantiteTotale']):g} {a.get('unite') or ''})".replace(
                            " )", ")"
                        ),
                    )
                    if x
                )
                for a in (r.get("rubriques") or [])[:6]
                if a.get("nature")
            ]
            details = {
                "category": self.category(r),
                "seveso": r.get("statutSeveso"),
                "regime": r.get("regime"),
                "status": r.get("etatActivite"),
                "ied": r.get("ied") or None,
                "national_priority": r.get("prioriteNationale") or None,
                "naf": r.get("codeNaf"),
                "commune": r.get("commune"),
                "activities": activities or None,
                "inspections": len(inspections) or None,
                "last_inspection": inspections[-1]
                if inspections and inspections[-1]
                else None,
                "aiot": r.get("codeAIOT"),
            }
            values.append(
                (
                    r.get("raisonSociale"),
                    json.dumps({k: v for k, v in details.items() if v}),
                    (r.get("date_maj") or "")[:10] or None,
                    r["longitude"],
                    r["latitude"],
                )
            )
        cur.execute(
            "CREATE TEMP TABLE IF NOT EXISTS extra_icpe (name text, details jsonb, updated date, lon float, lat float)"
        )
        cur.execute("TRUNCATE extra_icpe")
        psycopg2.extras.execute_values(
            cur, "INSERT INTO extra_icpe VALUES %s", values, page_size=5000
        )
        cur.execute(
            "DELETE FROM extra.facility WHERE source = %s AND kind = 'icpe'", (self.id,)
        )
        replaced = cur.rowcount
        cur.execute(
            """INSERT INTO extra.facility (source, kind, name, details, updated, geometry)
               SELECT %s, 'icpe', name, details, updated, g
                 FROM (SELECT *, ST_Transform(ST_SetSRID(ST_MakePoint(lon, lat), 4326), 3857) AS g FROM extra_icpe) s
                WHERE EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, s.g))""",
            (self.id,),
        )
        kept = cur.rowcount
        duplicates = remove_osm_duplicates(cur, self.id, "icpe")
        self.duplicates += duplicates
        self.duplicates_by["icpe"] = duplicates
        conn.commit()
        print(
            f"      kept {kept - duplicates} operating sites inside the region (of {len(rows)} records;"
            f" replacing {replaced}); left out {duplicates} already in OpenStreetMap",
            flush=True,
        )
        return kept - duplicates
