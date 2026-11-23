"""schema/fork/site-rules.sql and site-overrides.sql give only kinds the map draws
(web/src/fork/modules/sites/style.ts's site_kinds), or those sites.sql resolves."""

import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCHEMA = REPO_ROOT / "schema" / "fork"
STYLE = REPO_ROOT / "web" / "src" / "fork" / "modules" / "sites" / "style.ts"
# Kinds the name rules give that sites.sql turns into others (or leaves out).
RESOLVED_IN_SITES_SQL = {"not_military", "shooting_stand", "military_camp"}


def drawn_kinds() -> set[str]:
    style = STYLE.read_text()
    table = style[style.index("export const site_kinds") :]
    table = table[: table.index("\n}\n")]
    return set(re.findall(r"'([a-z_]+)'", table))


def rule_rows() -> list[tuple[int, str, str]]:
    sql = (SCHEMA / "site-rules.sql").read_text()
    return [
        (int(priority), kind, language)
        for priority, kind, language in re.findall(
            r"^\s*\((\d+), '([a-z_]+)', (?:true|false), '([a-z]{2})',",
            sql,
            re.MULTILINE,
        )
    ]


def test_the_rules_give_kinds_the_map_draws():
    rows = rule_rows()
    assert len(rows) > 20, "the rules' rows weren't read"
    unknown = {kind for _, kind, _ in rows} - drawn_kinds() - RESOLVED_IN_SITES_SQL
    assert not unknown


def test_a_kind_is_one_priority_in_every_language():
    priorities: dict[str, set[int]] = {}
    for priority, kind, _ in rule_rows():
        priorities.setdefault(kind, set()).add(priority)
    assert all(len(p) == 1 for p in priorities.values()), priorities


def test_the_overrides_give_kinds_the_map_draws():
    sql = (SCHEMA / "site-overrides.sql").read_text()
    kinds = re.findall(
        r"^\s*\(-?\d+::bigint, '(?:[^']|'')*',\s*'([a-z_]+)'", sql, re.MULTILINE
    )
    assert len(kinds) == sql.count("::bigint"), "an override's row wasn't read"
    # 'none': not a site, left out (sites.sql).
    assert set(kinds) - {"none"} <= drawn_kinds()


def kind_by_name(name: str) -> str | None:
    """The kind the first matching rule gives a name, as military_kind reads them
    (Postgres' word marks \\m and \\M are Python's \\b)."""
    sql = (SCHEMA / "site-rules.sql").read_text()
    rows = re.findall(
        r"^\s*\((\d+), '([a-z_]+)', (?:true|false), '[a-z]{2}', '((?:[^']|'')*)'\)",
        sql,
        re.MULTILINE,
    )
    for _, kind, pattern in sorted(rows, key=lambda row: int(row[0])):
        python_pattern = pattern.replace("''", "'").replace(r"\m", r"\b")
        if re.search(python_pattern.replace(r"\M", r"\b"), name, re.IGNORECASE):
            return kind
    return None


def test_a_parade_ground_is_not_a_range_but_a_swiss_training_ground_is():
    assert kind_by_name("Place d'armes") is None
    assert kind_by_name("Place d’armes de Bure") == "military_range"
    assert kind_by_name("Champ de tir de Suippes") == "military_range"


def test_a_lunette_is_a_fortification():
    assert kind_by_name("Lunette d'Arçon") == "military_fort"
