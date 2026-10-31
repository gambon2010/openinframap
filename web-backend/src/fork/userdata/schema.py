"""Fork: the userdata schema (userdata.sql), made on first use."""

from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

SCHEMA_SQL = (Path(__file__).parent / "userdata.sql").read_text()


async def ensure_schema(db: AsyncConnection) -> None:
    """Create the userdata schema on first use (databases built before it existed).
    Checked on each request (it's cheap): the database can be rebuilt while the
    backend runs."""
    # The newest table: an older database gets what it lacks (every statement in
    # userdata.sql is "if not exists", so running it again is safe).
    exists = (await db.execute(text("SELECT to_regclass('userdata.status_change') IS NOT NULL"))).scalar()
    if not exists:
        # One statement at a time (asyncpg doesn't run several in one call).
        for statement in SCHEMA_SQL.split(";\n"):
            code = "\n".join(line for line in statement.splitlines() if not line.strip().startswith("--"))
            if code.strip():
                await db.execute(text(code))
        await db.commit()
