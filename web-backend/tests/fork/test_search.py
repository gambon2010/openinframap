"""Fork: search helpers (src/fork/search.py)."""

import re

from src.fork.search import plain, query_params, result_tier, sort_key


def test_plain_folds_case_and_accents():
    assert plain("Hôpital Saint-Éloi") == "hopital saint-eloi"
    assert plain("Œuvre Straße") == "oeuvre strasse"
    assert plain("ÆRØ") == "aerø"  # ø has no decomposition, like unaccent


def test_query_params_match_words_inside_names():
    params = query_params("Vianden", 5)
    assert params["query"] == "Vianden%"
    assert params["exact"] == "vianden"
    # The regex Postgres gets: \m (start of a word) then the escaped query.
    assert params["word"] == r"\mvianden"
    assert query_params("a.b", 5)["word"] == r"\m" + re.escape("a.b")


def test_result_tier_and_sort_key():
    assert result_tier({"type": "place", "place_type": "city"}) == 0
    assert result_tier({"type": "substation"}) == 1
    assert result_tier({"type": "place", "place_type": "hamlet"}) == 2
    assert sort_key({"type": "substation", "voltage": 380000}) == 380
    assert sort_key({"type": "plant", "output": 1_300_000_000}) == 1300
    assert sort_key({"type": "place", "population": 1000}) == 1000
    assert sort_key({"type": "feature"}) == 0
