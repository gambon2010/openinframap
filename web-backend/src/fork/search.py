"""
Fork: the search box's backend. Registered ahead of upstream's identical route
(src/views/search.py, left as upstream has it), it adds to upstream's search:
word matching ("vianden" finds "Centrale de Vianden"), places (imposm/places.py)
and everything else with a name (schema/search.sql), ranked together.
"""

import asyncio
import json
import re
import time
import unicodedata
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import Request, get_db
from ..util import cache_for

# The languages and country helper are upstream's (src/views/search.py).
from ..views.search import SEARCH_LANGUAGES, country_alpha_2


def query_params(query: str, limit: Optional[int]) -> dict:
    # Names that start with the query, or with a word in them that does
    # ("vianden" also finds "Centrale de Vianden"). \m is "start of a word" in
    # Postgres regexes. Prefix matches rank first, as before.
    return {
        "query": f"{query}%",
        "exact": query.lower(),
        "word": r"\m" + re.escape(query.lower()),
        "limit": limit,
    }


def name_match(column: str) -> str:
    """SQL condition: the name in `column` starts with the query or has a word that does."""
    return f"""((substr(lower({column}), 1, 20) LIKE lower(:query))
                OR (lower({column}) ~ :word))"""


def match_rank(language: str) -> str:
    """SQL expression: 0 = exact name, 1 = name starts with the query, 2 = a word does."""
    return f"""CASE
            WHEN lower(name) = :exact OR lower(tags->'name:{language}') = :exact THEN 0
            WHEN substr(lower(name), 1, 20) LIKE lower(:query)
                OR substr(lower(tags->'name:{language}'), 1, 20) LIKE lower(:query) THEN 1
            ELSE 2 END"""


# Place types (fork: imposm/places.py), most important first. Countries down to
# towns rank above infrastructure with an equally good name match; smaller
# places below it.
PLACE_ORDER = [
    "country",
    "state",
    "province",
    "region",
    "county",
    "city",
    "municipality",
    "town",
    "archipelago",
    "island",
    "borough",
    "suburb",
    "village",
    "quarter",
    "islet",
    "hamlet",
    "neighbourhood",
]
MAJOR_PLACES = set(PLACE_ORDER[: PLACE_ORDER.index("island") + 1])
# A place mapped both as a point and as an area shows up twice; results with
# the same name and type closer than this (degrees, ~5 km) are merged.
DUPLICATE_DISTANCE = 0.05


async def table_exists(database: AsyncConnection, name: str) -> bool:
    result = await database.execute(text("SELECT to_regclass(:name) IS NOT NULL"), {"name": name})
    return bool(result.scalar())


async def search_substations(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    results = await database.execute(
        text(
            f"""
        SELECT
            osm_id,
            name,
            tags->'name:{language}' AS loc_name,
            tags->'operator' AS operator,
            convert_voltage(voltage) AS voltage,
            country.iso_sov1 AS country,
            ST_AsGeoJSON(ST_Transform(ST_Centroid(geometry), 4326)) AS geometry,
            {match_rank(language)} AS match_rank
        FROM substation, countries.country_eez_sub AS country
        WHERE (
                {name_match("name")}
                OR {name_match(f"tags->'name:{language}'")}
              )
            AND ST_Intersects(substation.geometry, country.geom)
        ORDER BY match_rank, convert_voltage(voltage) DESC NULLS LAST, name ASC NULLS LAST
        LIMIT :limit
        """
        ),
        query_params(query, limit),
    )
    return [
        {
            "type": "substation",
            "id": row._mapping["osm_id"],
            "name": row._mapping["loc_name"] or row._mapping["name"],
            "local_name": row._mapping["name"],
            "operator": row._mapping["operator"],
            "voltage": int(row._mapping["voltage"]) if row._mapping["voltage"] else None,
            "country": country_alpha_2(row._mapping["country"]),
            "geometry": json.loads(row._mapping["geometry"]),
            "match_rank": row._mapping["match_rank"],
        }
        for row in results
    ]


async def search_plants(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    result = await database.execute(
        text(
            f"""
        SELECT
            osm_id,
            name,
            tags->'name:{language}' AS loc_name,
            convert_power(output) as output,
            source,
            tags -> 'operator' AS operator,
            country.iso_sov1 AS country,
            ST_AsGeoJSON(ST_Transform(ST_Centroid(geometry), 4326)) AS geometry,
            {match_rank(language)} AS match_rank
        FROM power_plant, countries.country_eez_sub AS country
        WHERE ({name_match("name")}
                OR {name_match(f"tags->'name:{language}'")}
              )
            AND ST_Intersects(power_plant.geometry, country.geom)
        ORDER BY match_rank, output DESC NULLS LAST, name ASC NULLS LAST
        LIMIT :limit
    """
        ),
        query_params(query, limit),
    )
    return [
        {
            "type": "plant",
            "id": row._mapping["osm_id"],
            "name": row._mapping["loc_name"] or row._mapping["name"],
            "local_name": row._mapping["name"],
            "output": int(row._mapping["output"]) if row._mapping["output"] else None,
            "source": row._mapping["source"],
            "operator": row._mapping["operator"],
            "country": country_alpha_2(row._mapping["country"]),
            "geometry": json.loads(row._mapping["geometry"]),
            "match_rank": row._mapping["match_rank"],
        }
        for row in result
    ]


async def search_places(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    """Cities, towns, villages… from the local database (fork: replaces OpenCage)."""
    if not await table_exists(database, "osm_place"):
        return []  # database built before places were imported
    # The country is optional here, so place search also works without EEZ data.
    if await table_exists(database, "countries.country_eez_sub"):
        country = """(SELECT c.iso_sov1 FROM countries.country_eez_sub AS c
                       WHERE ST_Intersects(c.geom, ST_PointOnSurface(osm_place.geometry)) LIMIT 1)"""
    else:
        country = "NULL"
    place_order = " ".join(f"WHEN '{t}' THEN {i}" for i, t in enumerate(PLACE_ORDER))
    params = query_params(query, limit)
    params["limit"] = (limit or 10) * 3  # room for merging duplicates
    result = await database.execute(
        text(
            f"""
        SELECT
            osm_id,
            name,
            tags->'name:{language}' AS loc_name,
            type,
            convert_integer(NULLIF(population, '')) AS population,
            {country} AS country,
            ST_AsGeoJSON(ST_Transform(ST_PointOnSurface(geometry), 4326)) AS geometry,
            {match_rank(language)} AS match_rank
        FROM osm_place
        WHERE {name_match("name")} OR {name_match(f"tags->'name:{language}'")}
        ORDER BY match_rank, CASE type {place_order} ELSE 99 END,
            convert_integer(NULLIF(population, '')) DESC NULLS LAST, name
        LIMIT :limit
        """
        ),
        params,
    )
    places: list[dict] = []
    for row in result:
        geometry = json.loads(row._mapping["geometry"])
        name = row._mapping["loc_name"] or row._mapping["name"]
        lon, lat = geometry["coordinates"]
        if any(
            p["name"].lower() == name.lower()
            and p["place_type"] == row._mapping["type"]
            and abs(p["geometry"]["coordinates"][0] - lon) < DUPLICATE_DISTANCE
            and abs(p["geometry"]["coordinates"][1] - lat) < DUPLICATE_DISTANCE
            for p in places
        ):
            continue
        places.append(
            {
                "type": "place",
                "id": row._mapping["osm_id"],
                "name": name,
                "local_name": row._mapping["name"],
                "place_type": row._mapping["type"],
                "population": row._mapping["population"],
                "country": country_alpha_2(row._mapping["country"]) if row._mapping["country"] else None,
                "geometry": geometry,
                "match_rank": row._mapping["match_rank"],
            }
        )
    return places[:limit]


def plain(text_: str) -> str:
    """Lower case without accents, like lower(unaccent(...)) in schema/search.sql."""
    text_ = text_.lower().replace("œ", "oe").replace("æ", "ae").replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFKD", text_) if not unicodedata.combining(c))


async def search_features(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    """Everything else with a name (fork: schema/search.sql): critical sites, power
    lines, telecoms, pipelines, water, and the extra data from outside OSM."""
    if not await table_exists(database, "search_feature"):
        return []  # database built before search_feature existed
    # Matched without accents: "hopital" finds "Hôpital".
    query = plain(query)
    params = query_params(query, limit)
    # Several words can also be the name and the town: "mairie duppigheim".
    words = query.split()
    town_match = "FALSE"
    if len(words) > 1:
        town_match = " AND ".join(f"name_town ~ :town_word{i}" for i in range(len(words)))
        for i, word in enumerate(words):
            params[f"town_word{i}"] = r"\m" + re.escape(word)
    result = await database.execute(
        text(
            f"""
        SELECT
            source, kind, subtype, name, names->'name:{language}' AS loc_name, detail, town,
            layer, ST_AsGeoJSON(geometry) AS geometry,
            CASE
                WHEN name_plain = :exact THEN 0
                WHEN substr(name_plain, 1, 20) LIKE :query THEN 1
                WHEN name_plain ~ :word THEN 2
                ELSE 3 END AS match_rank
        FROM search_feature
        WHERE substr(name_plain, 1, 20) LIKE :query OR name_plain ~ :word OR ({town_match})
        ORDER BY match_rank, importance, name
        LIMIT :limit
        """
        ),
        params,
    )
    return [
        {
            "type": "feature",
            "source": row._mapping["source"],
            "kind": row._mapping["kind"],
            "subtype": row._mapping["subtype"],
            "name": row._mapping["loc_name"] or row._mapping["name"],
            "local_name": row._mapping["name"],
            "operator": row._mapping["detail"],
            "town": row._mapping["town"],
            "layer": row._mapping["layer"],
            "geometry": json.loads(row._mapping["geometry"]),
            "match_rank": row._mapping["match_rank"],
        }
        for row in result
    ]


def result_tier(row: dict) -> int:
    """0 = big places, 1 = infrastructure, 2 = small places (for equally good matches)."""
    if row["type"] != "place":
        return 1
    return 0 if row["place_type"] in MAJOR_PLACES else 2


def sort_key(row: dict) -> int:
    if row["type"] == "substation" and row["voltage"]:
        return row["voltage"] // 1000

    if row["type"] == "plant" and row["output"]:
        return row["output"] // 1000000

    if row["type"] == "place" and row["population"]:
        return row["population"]

    return 0


@cache_for(86400)
async def search(request: Request) -> Response:
    database = get_db(request)
    query = request.query_params.get("q")
    language = request.query_params.get("lang", "en")
    if language not in SEARCH_LANGUAGES:
        language = "en"

    limit_str = request.query_params.get("limit", "10")
    try:
        limit = min(int(limit_str), 100)
    except ValueError:
        raise HTTPException(400, "Invalid limit")

    if not query:
        raise HTTPException(400, "No query provided")

    start = time.monotonic_ns()
    async with asyncio.TaskGroup() as tg:
        substations = tg.create_task(search_substations(database, query, language, limit))
        plants = tg.create_task(search_plants(database, query, language, limit))
        places = tg.create_task(search_places(database, query, language, limit))
        features = tg.create_task(search_features(database, query, language, limit))

    # Best match first (exact, then name prefix, then word, then name + town); for
    # equally good matches big places, then infrastructure, then small places; then
    # the biggest.
    results = sorted(
        await substations + await plants + await places + await features,
        key=lambda row: (row["match_rank"], result_tier(row), -sort_key(row)),
    )
    for row in results:
        del row["match_rank"]
    end = time.monotonic_ns()

    results = results[:limit]

    response = {"time": (end - start) / 1e9, "results": results}
    return JSONResponse(response)


routes = [Route("/search/typeahead", endpoint=search)]
