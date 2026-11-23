"""Fork: extra data (scripts/extra_data.py), with the communes (communes.py): the
neighbourhoods of the communes INSEE splits (those over about 5,000 inhabitants), to
number their buildings per neighbourhood ("STR-NEU-12"). INSEE's IRIS (about 2,000
inhabitants each, IGN's outlines, Géoplateforme WFS, Licence Ouverte 2.0) grouped by
their "grand quartier", an IRIS code's first two digits after the commune's (Strasbourg:
116 IRIS, about 20 neighbourhoods): Neudorf from "Neudorf Ouest Nord-Ouest", "Neudorf
Est"... Communes INSEE doesn't split (one IRIS, type Z) have none: numbered whole."""

from __future__ import annotations

import gzip
import http.client
import json
from collections import Counter
from pathlib import Path

import httpx

import netsafe

WFS = "https://data.geopf.fr/wfs/ows"
LAYER = "STATISTICALUNITS.IRIS:contours_iris"
PAGE = 1000  # features per request (the service's pages)


def iris_of_department(
    client: httpx.Client, department: str, cache: Path
) -> list[dict]:
    """A département's IRIS in split communes (GeoJSON features), downloaded once into
    `cache`."""
    path = cache / f"{department}.json.gz"
    if path.exists():
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    features: list[dict] = []
    while True:
        params = {
            "SERVICE": "WFS",
            "VERSION": "2.0.0",
            "REQUEST": "GetFeature",
            "TYPENAMES": LAYER,
            "OUTPUTFORMAT": "application/json",
            "COUNT": str(PAGE),
            "STARTINDEX": str(len(features)),
            "SORTBY": "code_iris",
            "CQL_FILTER": f"code_insee LIKE '{department}%' AND type_iris <> 'Z'",
        }

        def get_page(params: dict = params) -> list[dict]:
            response = netsafe.checked(client.get(WFS, params=params))
            try:
                return response.json()["features"]
            except ValueError as error:
                # The service sometimes answers 200 with an empty body under load: an
                # answer cut short, retried like one.
                raise http.client.IncompleteRead(response.content) from error

        page = netsafe.safely(get_page, WFS, retries=3, pause=10, report=True)
        features += page
        if len(page) < PAGE:
            break
    cache.mkdir(parents=True, exist_ok=True)
    with gzip.open(path.with_suffix(".part"), "wt", encoding="utf-8") as f:
        json.dump(features, f)
    path.with_suffix(".part").rename(path)
    return features


def neighbourhoods_of(iris: list[dict]) -> dict[str, str]:
    """Each IRIS's neighbourhood (its code to the neighbourhood's): its grand quartier
    (the commune's code and the IRIS's first two digits: "674821205" is in "6748212")
    where the commune has several; else the IRIS itself (Molsheim's four IRIS are all
    in one grand quartier: Nord, Est, Sud-Est, Sud-Ouest are its neighbourhoods)."""
    quarters: dict[str, set[str]] = {}
    for feature in iris:
        code = feature["properties"]["code_iris"]
        quarters.setdefault(code[:5], set()).add(code[:7])
    found: dict[str, str] = {}
    for feature in iris:
        code = feature["properties"]["code_iris"]
        found[code] = code[:7] if len(quarters[code[:5]]) > 1 else code
    return found


def neighbourhood_names(iris: list[dict], of: dict[str, str]) -> dict[str, str]:
    """Each neighbourhood's name, unique within its commune: an IRIS's own, or what its
    IRIS's names start with ("Neudorf" from "Neudorf Ouest" and "Neudorf Est", else the
    first word most of them start with); two alike in a commune ("Canardière" twice
    in Strasbourg) are named by their first IRIS in full instead, then numbered."""
    names: dict[str, list[tuple[str, str]]] = {}
    for feature in iris:
        props = feature["properties"]
        names.setdefault(of[props["code_iris"]], []).append(
            (props["code_iris"], props["nom_iris"])
        )
    chosen = {
        code: shared_start([name for _, name in sorted(found)])
        for code, found in names.items()
    }
    return unique_in_communes(
        chosen, {code: min(found)[1] for code, found in names.items()}
    )


def unique_in_communes(
    chosen: dict[str, str], fuller: dict[str, str]
) -> dict[str, str]:
    """Names made unique within each commune: a name two neighbourhoods share becomes
    their fuller one; if still shared, the neighbourhood's code's last digits added."""
    for step in (lambda code: fuller[code], lambda code: f"{chosen[code]} {code[-2:]}"):
        counts = Counter((code[:5], name) for code, name in chosen.items())
        chosen = {
            code: step(code) if counts[(code[:5], name)] > 1 else name
            for code, name in chosen.items()
        }
    return chosen


def shared_start(names: list[str]) -> str:
    """The words every name starts with, else the most common first word."""
    split = [name.split() for name in names]
    shared: list[str] = []
    for words in zip(*split, strict=False):
        if len(set(words)) != 1:
            break
        shared.append(words[0])
    if shared:
        return " ".join(shared)
    return Counter(words[0] for words in split if words).most_common(1)[0][0]


def commune_of(neighbourhood: str) -> str:
    """A neighbourhood's commune (its first five characters: the INSEE code)."""
    return neighbourhood[:5]
