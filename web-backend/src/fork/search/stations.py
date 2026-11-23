"""Fork: the search box (search/__init__.py): substations and power plants, one
search for both: what differs is the table, the columns shown and what makes one
bigger (STATIONS)."""

import json
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# The country helper is upstream's (src/views/search.py).
from ...views.search import country_alpha_2
from .matching import match_rank, name_match, query_params

# Per kind: its table, its own columns (SQL), what orders equally good matches
# (the biggest first), and its own fields in a result.
STATIONS: dict[str, dict[str, Any]] = {
    "substation": {
        "table": "substation",
        "columns": "tags->'operator' AS operator, convert_voltage(voltage) AS voltage",
        "size": "convert_voltage(voltage)",
        "fields": lambda r: {
            "operator": r["operator"],
            "voltage": int(r["voltage"]) if r["voltage"] else None,
        },
    },
    "plant": {
        "table": "power_plant",
        "columns": "convert_power(output) as output, source, tags -> 'operator' AS operator",
        "size": "output",
        "fields": lambda r: {
            "output": int(r["output"]) if r["output"] else None,
            "source": r["source"],
            "operator": r["operator"],
        },
    },
}


async def search_stations(
    kind: str, database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    """Substations or power plants (kind) whose name, or name in the language,
    starts with the query or has a word that does; best match, then biggest, first."""
    station = STATIONS[kind]
    table = station["table"]
    result = await database.execute(
        text(
            f"""
        SELECT
            osm_id,
            name,
            tags->'name:{language}' AS loc_name,
            {station["columns"]},
            country.iso_sov1 AS country,
            ST_AsGeoJSON(ST_Transform(ST_Centroid(geometry), 4326)) AS geometry,
            {match_rank(language)} AS match_rank
        FROM {table}, countries.country_eez_sub AS country
        WHERE (
                {name_match("name")}
                OR {name_match(f"tags->'name:{language}'")}
              )
            AND ST_Intersects({table}.geometry, country.geom)
        ORDER BY match_rank, {station["size"]} DESC NULLS LAST, name ASC NULLS LAST, osm_id
        LIMIT :limit
        """
        ),
        query_params(query, limit),
    )
    return [
        {
            "type": kind,
            "id": r["osm_id"],
            "name": r["loc_name"] or r["name"],
            "local_name": r["name"],
            **station["fields"](r),
            "country": country_alpha_2(r["country"]),
            "geometry": json.loads(r["geometry"]),
            "match_rank": r["match_rank"],
        }
        for r in (row._mapping for row in result)
    ]


async def search_substations(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    return await search_stations("substation", database, query, language, limit)


async def search_plants(
    database: AsyncConnection, query: str, language: str, limit: Optional[int] = 10
) -> list[dict]:
    return await search_stations("plant", database, query, language, limit)
