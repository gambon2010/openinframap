"""Fork: the userdata schema, made and kept up to date by numbered migrations
(migrations/NNN_name.sql, run once each, in order). The database records which it
has run (userdata.schema_version); a change to the schema is a new file, never an
edit of one already run. Checked on each request (it's cheap): the database can be
rebuilt or restored from an older export while the backend runs."""

from __future__ import annotations

import re
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

MIGRATIONS_DIR = Path(__file__).parent / "migrations"
# Two backends (or two requests) migrating at once: one waits for the other.
LOCK = 7_301_957


def migrations(folder: Path = MIGRATIONS_DIR) -> list[tuple[int, str, str]]:
    """(number, name, SQL) of every migration, in order."""
    found = []
    for path in sorted(folder.glob("*.sql")):
        match = re.fullmatch(r"(\d{3})_(\w+)\.sql", path.name)
        if not match:
            raise ValueError(f"A migration is named NNN_name.sql: {path.name}")
        found.append((int(match.group(1)), match.group(2), path.read_text()))
    return found


MIGRATIONS = migrations()
LATEST = MIGRATIONS[-1][0]


def statements(sql: str) -> list[str]:
    """A migration's statements, one at a time (asyncpg runs one per call); comment
    lines left out."""
    found = []
    for statement in sql.split(";\n"):
        code = "\n".join(line for line in statement.splitlines() if not line.strip().startswith("--"))
        if code.strip():
            found.append(code)
    return found


async def schema_version(db: AsyncConnection) -> int:
    """The last migration the database has run (0: none, or from before migrations)."""
    if not (await db.execute(text("SELECT to_regclass('userdata.schema_version') IS NOT NULL"))).scalar():
        return 0
    return int(
        (await db.execute(text("SELECT coalesce(max(version), 0) FROM userdata.schema_version"))).scalar()
        or 0
    )


async def ensure_schema(db: AsyncConnection) -> None:
    """Run the migrations the database hasn't run yet. A database from before
    migrations has version 0: 001 is "if not exists" throughout, so it's safe on it."""
    if await schema_version(db) >= LATEST:
        return
    await db.execute(text("SELECT pg_advisory_xact_lock(:lock)"), {"lock": LOCK})
    await db.execute(text("CREATE SCHEMA IF NOT EXISTS userdata"))
    await db.execute(
        text(
            """CREATE TABLE IF NOT EXISTS userdata.schema_version (
                   version integer PRIMARY KEY,
                   name text NOT NULL,
                   applied_at timestamptz NOT NULL DEFAULT now()
               )"""
        )
    )
    done = await schema_version(db)  # another one may have run them meanwhile
    for number, name, sql in MIGRATIONS:
        if number <= done:
            continue
        for statement in statements(sql):
            await db.execute(text(statement))
        await db.execute(
            text("INSERT INTO userdata.schema_version (version, name) VALUES (:v, :n)"),
            {"v": number, "n": name},
        )
    await db.commit()
