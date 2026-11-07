"""Fork: the search box (search/__init__.py): towers by their number along a line."""

import json
import re
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .matching import plain, table_exists


# "23 marlenheim", "tower 23a marlenheim", "pylône n°23 reichstett": a tower's number
# on a line (tower_numbers.py) and words of the line's name or stations.
TOWER_QUERY = re.compile(r"^(?:(?:tower|pylon|pylone|support)\s+)?(?:n°\s*)?(\d{1,4}[a-z]{0,3})\s+(\S.*)$")


async def search_towers(database: AsyncConnection, query: str, limit: Optional[int] = 10) -> list[dict]:
    """Towers by their number along a line (fork: tower_numbers.py)."""
    match = TOWER_QUERY.match(plain(query).strip())
    if not match or not await table_exists(database, "tower_number"):
        return []
    words = match.group(2).split()
    params: dict = {"number": match.group(1), "limit": limit}
    for i, word in enumerate(words):
        params[f"word{i}"] = r"\m" + re.escape(word)
    matches = " AND ".join(f"l.search ~ :word{i}" for i in range(len(words)))
    result = await database.execute(
        text(
            f"""SELECT n.number, n.total, n.voltage, l.name, l.start_name, l.end_name,
                       ST_AsGeoJSON(ST_Transform(n.geometry, 4326)) AS geometry
                  FROM tower_number AS n JOIN tower_line AS l USING (line_id)
                 WHERE n.number = :number AND {matches}
                 ORDER BY n.voltage DESC, l.name NULLS LAST, n.osm_id, l.line_id
                 LIMIT :limit"""
        ),
        params,
    )
    found = []
    for row in result:
        r = row._mapping
        line = r["name"] or " – ".join(n for n in (r["start_name"], r["end_name"]) if n)
        found.append(
            {
                "type": "feature",
                "source": "osm",
                "kind": "power_tower",
                "subtype": None,
                "name": f"{r['number']}/{r['total']} · {line} ({r['voltage'] // 1000} kV)",
                "local_name": None,
                "operator": None,
                "town": None,
                "layer": "P",
                "geometry": json.loads(r["geometry"]),
                "match_rank": 0,
            }
        )
    return found
