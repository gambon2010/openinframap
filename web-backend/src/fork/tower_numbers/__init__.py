"""
Fork: number the towers (pylons) along each power line, for those without a ref:
"tower 23 of 61, Graffenstaden - Marlenheim, from Graffenstaden". Shown in a
tower's details (GET /grid/tower/<osm_id>, grid/tower.py), as its label from zoom 16
(tegola/layers.fork.yml) and found by the search ("23 marlenheim", search/towers.py).

Every line of the grid network (schema/grid.sql) is followed (line_trace/) from
one of its stations, A: the one its name starts with, else the first by name. Its
towers are numbered by how far along the line they are. A tower on several lines
(shared pylons) has a number on each.

Run after the grid is built (scripts/build-region.sh, import-db.sh):

    uv run python -m src.fork.tower_numbers

- numbering.py: the lines followed, how far along each stretch is;
- labels.py: the labels in order ("23", "23a");
- register.py: the numbers people saw, kept;
- write.py: the tables.

Writes tower_line (one row per line), tower_line_edge (where each stretch of the
network is along its line) and tower_number (schema/tower-numbers.sql makes them
empty first, as Tegola serves tower_number). Uses DATABASE_URL, else the local
database.
"""

from __future__ import annotations

import os
import time

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from ..line_trace import load_index
from ..userdata.schema import ensure_schema
from .labels import base, label_towers, letters
from .numbering import Line, all_lines, line_name, number_line, start_station
from .register import number_from_register
from .write import write

__all__ = [
    "Line",
    "all_lines",
    "base",
    "label_towers",
    "letters",
    "line_name",
    "main",
    "number_from_register",
    "number_line",
    "start_station",
    "write",
]

DEFAULT_URL = "postgresql+asyncpg://osm:osm@localhost:5432/osm"


async def main() -> None:
    engine = create_async_engine(os.environ.get("DATABASE_URL", DEFAULT_URL))
    began = time.monotonic()
    async with engine.connect() as database:
        await ensure_schema(database)  # the register (userdata)
        index = await load_index(database)
        lines = all_lines(index)
        print(f"{len(lines):,} lines followed in {time.monotonic() - began:.0f} s.")
        await write(database, lines)
        count = (await database.execute(text("SELECT count(*) FROM tower_number"))).scalar()
        await database.commit()
    await engine.dispose()
    print(f"{count:,} towers numbered in {time.monotonic() - began:.0f} s.")
