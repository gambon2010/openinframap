"""Fork: the search box (search/__init__.py): matching a query in SQL: names that start
with it or have a word that does, how well (match_rank), accents left out (plain)."""

import re
import unicodedata
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection


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


async def table_exists(database: AsyncConnection, name: str) -> bool:
    result = await database.execute(text("SELECT to_regclass(:name) IS NOT NULL"), {"name": name})
    return bool(result.scalar())


def plain(text_: str) -> str:
    """Lower case without accents, like lower(unaccent(...)) in schema/search.sql."""
    text_ = text_.lower().replace("œ", "oe").replace("æ", "ae").replace("ß", "ss")
    return "".join(c for c in unicodedata.normalize("NFKD", text_) if not unicodedata.combining(c))
