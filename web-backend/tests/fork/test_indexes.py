"""Fork: search indexes (src/fork/indexes.py)."""

from src.fork.indexes import FORK_MAIN_INDEXES, fork_language_indexes


def test_statements_can_run_again():
    # create_indexes.py runs after every build and import: nothing may fail if it exists.
    for statement in [*FORK_MAIN_INDEXES, *fork_language_indexes("fr")]:
        assert "IF NOT EXISTS" in statement.upper(), statement[:60]


def test_language_indexes_name_the_language():
    assert any("name:de" in s for s in fork_language_indexes("de"))
