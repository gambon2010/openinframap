"""Fork: the search box (search/__init__.py): everything else with a name (schema/search.sql)."""

import json
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .matching import plain, query_params, table_exists


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
        ORDER BY match_rank, importance, name, source, id
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
