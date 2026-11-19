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
        r"^\s*\(-?\d+::bigint, '(?:[^']|'')*', '([a-z_]+)'", sql, re.MULTILINE
    )
    assert kinds, "the overrides' rows weren't read"
    assert set(kinds) <= drawn_kinds()
