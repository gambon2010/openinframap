"""Fork: extra data (scripts/extra_data.py): French communes' outlines (Etalab's
administrative boundaries, from IGN's Admin Express), each with a short code
("WIS" for Wisches), to number buildings per commune (the backend's
building_numbers/). Not shown on the map themselves."""

from __future__ import annotations

import gzip
import json
import unicodedata
from typing import ClassVar

import psycopg2.extras

import netsafe

from .base import EXTRA_DIR, downloaded_on
from .france import FrenchSource

# Words left out of a commune's short code ("Saint-Jean-de-Luz": JEL... from Jean, Luz).
SMALL_WORDS = {
    "LE",
    "LA",
    "LES",
    "L",
    "DE",
    "DU",
    "DES",
    "D",
    "EN",
    "SUR",
    "SOUS",
    "ET",
    "AUX",
    "AU",
    "SAINT",
    "SAINTE",
}
CODE_LENGTH = 3


class FrenchCommunes(FrenchSource):
    """France's communes: their outlines (to 5 m) and a three-letter code each, unique
    within its département."""

    id = "fr-communes"
    name = "French communes (outlines, to number buildings)"
    licence = "Licence Ouverte 2.0 (Etalab)"
    attribution = "Etalab, IGN Admin Express"
    url = "https://www.data.gouv.fr/datasets/contours-administratifs/"
    DOWNLOAD = "https://etalab-datasets.geo.data.gouv.fr/contours-administratifs/latest/geojson/communes-5m.geojson.gz"
    FILE = EXTRA_DIR / "fr-communes-5m.geojson.gz"

    CHOICES: ClassVar[dict[str, tuple[str, list[str]]]] = {
        "communes": ("Commune outlines, to number buildings", ["communes"]),
    }

    def offer(self, region: dict) -> list[tuple[str, str, str]]:
        if not self.involved(region):
            return []
        cost = (
            f"downloaded {downloaded_on(self.FILE)}"
            if self.FILE.exists()
            else "90 MB, once for all of France"
        )
        return [("communes", self.CHOICES["communes"][0], cost)]

    def run(self, conn, cur, areas: list[str], only: list[str] | None = None) -> int:
        if only and not any(word in "communes" for word in only):
            return 0
        print("    communes")
        if self.refresh:
            self.FILE.unlink(missing_ok=True)
        netsafe.fetch_file(self.DOWNLOAD, self.FILE)
        with gzip.open(self.FILE, "rt", encoding="utf-8") as f:
            features = json.load(f)["features"]
        codes = short_codes(
            {f["properties"]["code"]: f["properties"]["nom"] for f in features}
        )
        cur.execute(
            "CREATE TEMP TABLE IF NOT EXISTS extra_commune (code text, name text, abbreviation text, outline text)"
        )
        cur.execute("TRUNCATE extra_commune")
        psycopg2.extras.execute_values(
            cur,
            "INSERT INTO extra_commune VALUES %s",
            [
                (
                    f["properties"]["code"],
                    f["properties"]["nom"],
                    codes[f["properties"]["code"]],
                    json.dumps(f["geometry"]),
                )
                for f in features
            ],
            page_size=2000,
        )
        cur.execute("DELETE FROM extra.commune WHERE source = %s", (self.id,))
        cur.execute(
            """INSERT INTO extra.commune (source, code, name, abbreviation, geometry)
               SELECT %s, code, name, abbreviation, g
                 FROM (SELECT *, ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(outline), 4326), 3857)) AS g
                         FROM extra_commune) s
                WHERE EXISTS (SELECT 1 FROM extra_region r WHERE ST_Intersects(r.geom, s.g))""",
            (self.id,),
        )
        kept = cur.rowcount
        conn.commit()
        print(
            f"      kept {kept} communes touching the region (of {len(features)})",
            flush=True,
        )
        return kept


def short_codes(names: dict[str, str]) -> dict[str, str]:
    """A three-letter code for each commune (INSEE code to name), unique within its
    département (the code's first two characters, three overseas): its first word's
    first three letters, else the next candidates (first letters of its words, its
    first letter and consonants...), in INSEE order so a commune always gets the same."""
    taken: dict[str, set[str]] = {}
    codes: dict[str, str] = {}
    for insee in sorted(names):
        department = insee[:3] if insee.startswith("97") else insee[:2]
        used = taken.setdefault(department, set())
        code = next(c for c in candidates(names[insee], insee) if c not in used)
        used.add(code)
        codes[insee] = code
    return codes


def candidates(name: str, insee: str) -> list[str]:
    """The codes a commune may get, best first; its INSEE code's last three digits last
    (always unique within a département)."""
    words = [w for w in plain(name).split() if w not in SMALL_WORDS] or plain(
        name
    ).split()
    letters = "".join(words)
    out: list[str] = []
    if len(letters) >= CODE_LENGTH:
        out.append(letters[:CODE_LENGTH])
    if len(words) >= CODE_LENGTH:
        out.append("".join(w[0] for w in words[:CODE_LENGTH]))
    if len(words) == 2:
        out += [words[0][:2] + words[1][0], words[0][0] + words[1][:2]]
    consonants = [c for c in letters[1:] if c not in "AEIOUY"]
    for i in range(len(consonants)):
        for j in range(i + 1, len(consonants)):
            out.append(letters[0] + consonants[i] + consonants[j])
    for i in range(1, len(letters)):
        for j in range(i + 1, len(letters)):
            out.append(letters[0] + letters[i] + letters[j])
    out.append(insee[-CODE_LENGTH:])
    return out


def plain(name: str) -> str:
    """A name in capitals without accents, its hyphens and apostrophes as spaces."""
    decomposed = unicodedata.normalize("NFKD", name)
    letters = "".join(c for c in decomposed if not unicodedata.combining(c))
    return "".join(c if c.isalpha() else " " for c in letters.upper())
