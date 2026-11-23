"""Fork: the search box (search/__init__.py): cities, towns, villages… (imposm/places.py)."""

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from ...views.search import country_alpha_2
from .matching import match_rank, name_match, query_params, table_exists
from .ranking import PLACE_ORDER


# A place mapped both as a point and as an area shows up twice; results with
# the same name and type closer than this (degrees, ~5 km) are merged.
DUPLICATE_DISTANCE = 0.05


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
            convert_integer(NULLIF(population, '')) DESC NULLS LAST, name, osm_id
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
