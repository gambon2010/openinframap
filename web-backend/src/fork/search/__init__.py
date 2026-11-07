"""
Fork: the search box's backend. Registered ahead of upstream's identical route
(src/views/search.py, left as upstream has it), it adds to upstream's search:
word matching ("vianden" finds "Centrale de Vianden"), places (imposm/places.py)
and everything else with a name (schema/search.sql), ranked together.

- matching.py: matching a query in SQL, accents left out;
- stations.py, places.py, features.py, towers.py: one search per kind;
- ranking.py: the order of everything found together.
"""

import asyncio
import time

from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ... import Request, get_db
from ...util import cache_for

# The languages are upstream's (src/views/search.py).
from ...views.search import SEARCH_LANGUAGES
from .features import search_features
from .matching import plain, query_params
from .places import search_places
from .ranking import result_tier, sort_key
from .stations import search_plants, search_substations
from .towers import TOWER_QUERY, search_towers

__all__ = ["TOWER_QUERY", "plain", "query_params", "result_tier", "routes", "sort_key"]


@cache_for(86400)
async def search(request: Request) -> Response:
    database = get_db(request)
    query = request.query_params.get("q")
    language = request.query_params.get("lang", "en")
    if language not in SEARCH_LANGUAGES:
        language = "en"

    limit_str = request.query_params.get("limit", "10")
    try:
        limit = max(1, min(int(limit_str), 100))
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
        towers = tg.create_task(search_towers(database, query, limit))

    # Best match first (exact, then name prefix, then word, then name + town); for
    # equally good matches big places, then infrastructure, then small places; then
    # the biggest.
    results = sorted(
        await substations + await plants + await places + await features + await towers,
        key=lambda row: (row["match_rank"], result_tier(row), -sort_key(row)),
    )
    for row in results:
        del row["match_rank"]
    end = time.monotonic_ns()

    results = results[:limit]

    response = {"time": (end - start) / 1e9, "results": results}
    return JSONResponse(response)


routes = [Route("/search/typeahead", endpoint=search)]
