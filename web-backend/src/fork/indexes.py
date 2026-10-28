"""
Fork: the search indexes the fork's search (src/fork/search.py) needs, on top of
upstream's (create_indexes.py adds these to its lists): places, and trigram
indexes for matching a word anywhere in a name ("Centrale de Vianden").
"""

from typing import Optional

# (table, name expression) pairs searched by src/fork/search.py.
NAME_COLUMNS = [
    ("osm_power_substation", "tags->'name'"),
    ("power_substation_relation", "name"),
    ("osm_power_plant", "tags->'name'"),
    ("power_plant_relation", "name"),
    ("osm_place", "name"),  # local place search (imposm/places.py)
]


def word_indexes(suffix: str, lang_tag: Optional[str] = None) -> list[str]:
    """Trigram indexes for matching a word anywhere in a name."""
    queries = []
    for table, column in NAME_COLUMNS:
        expr = f"tags->'{lang_tag}'" if lang_tag else column
        queries.append(
            f"""CREATE INDEX CONCURRENTLY IF NOT EXISTS {table}_name_words{suffix}
                ON {table} USING gin (lower({expr}) gin_trgm_ops)
                WHERE {expr} IS NOT NULL"""
        )
    return queries


FORK_MAIN_INDEXES = [
    # Trusted extension: the database owner can enable it.
    "CREATE EXTENSION IF NOT EXISTS pg_trgm",
    """CREATE INDEX CONCURRENTLY IF NOT EXISTS osm_place_name
        ON osm_place(substr(lower(name), 1, 20) text_pattern_ops)
        WHERE name IS NOT NULL""",
] + word_indexes("")


def fork_language_indexes(lang: str) -> list[str]:
    return [
        f"""CREATE INDEX CONCURRENTLY IF NOT EXISTS osm_place_name_{lang}
            ON osm_place(substr(lower(tags->'name:{lang}'), 1, 20) text_pattern_ops)
            WHERE tags->'name:{lang}' IS NOT NULL""",
    ] + word_indexes(f"_{lang}", f"name:{lang}")
