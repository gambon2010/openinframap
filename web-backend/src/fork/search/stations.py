"""Fork: the search box (search/__init__.py): substations and power plants."""

import json
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# The country helper is upstream's (src/views/search.py).
from ...views.search import country_alpha_2
from .matching import match_rank, name_match, query_params


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
        ORDER BY match_rank, convert_voltage(voltage) DESC NULLS LAST, name ASC NULLS LAST, osm_id
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
        ORDER BY match_rank, output DESC NULLS LAST, name ASC NULLS LAST, osm_id
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
