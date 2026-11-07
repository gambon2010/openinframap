"""The backend's answers on the real database, compared with the ones it gave before
(docs/plans/refactor-5e.md): searches, routes over the grid, lines, towers, and the
tower numbers. Opt-in, like the scripts' real build:

    OIM_TEST_REAL_DB=1 uv run pytest tests/fork/test_answers.py

The first run picks the questions from the database built (stations, lines and
towers chosen the same way each time), records the answers in
data/test-answers/<region>.json and skips; later runs compare. OIM_RECORD=1 records
again (after a rebuild of the database, or a change meant to change the answers).
OIM_TEST_DB_URL: the database (default: the local one).
"""

from __future__ import annotations

import hashlib
import json
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import pytest

pytestmark = pytest.mark.skipif(
    os.environ.get("OIM_TEST_REAL_DB") != "1", reason="opt-in: OIM_TEST_REAL_DB=1"
)

DB_URL = os.environ.get("OIM_TEST_DB_URL", "postgresql+asyncpg://osm:osm@localhost:5432/osm")
ANSWERS_DIR = Path(__file__).resolve().parents[3] / "data" / "test-answers"

SEARCHES = [
    "strasbourg",
    "marlenheim",
    "23 marlenheim",
    "tower 5 graffenstaden",
    "poste",
    "centrale",
    "vianden",
    "edf",
    "rte",
    "seveso",
    "hopital",
    "paris",
    "lyon",
    "48.58, 7.75",
    "zzqqxx",
    "saint",
    "barrage",
    "aeroport",
]


@asynccontextmanager
async def lifespan(app) -> AsyncIterator[dict]:
    import httpx
    from sqlalchemy.ext.asyncio import create_async_engine

    engine = create_async_engine(DB_URL)
    async with httpx.AsyncClient() as client:
        yield {"http_client": client, "db_engine": engine}
    await engine.dispose()


def client():
    """The app's routes with its database connection, without the login (the
    answers are what's compared, not who may ask)."""
    from starlette.applications import Starlette
    from starlette.middleware import Middleware
    from starlette.testclient import TestClient

    from src import main

    app = Starlette(lifespan=lifespan, routes=main.routes, middleware=[Middleware(main.DBSessionMiddleware)])
    return TestClient(app)


def query(sql: str) -> list:
    import asyncio

    from sqlalchemy import text
    from sqlalchemy.ext.asyncio import create_async_engine

    async def run() -> list:
        engine = create_async_engine(DB_URL)
        async with engine.connect() as db:
            rows = (await db.execute(text(sql))).all()
        await engine.dispose()
        return [tuple(r) for r in rows]

    return asyncio.run(run())


def questions() -> list[str]:
    """The addresses asked: searches, then stations, lines and towers picked from
    the database (by a hash of their id: the same ones each time)."""
    stations = [
        f"{'plant' if kind == 'plant' else 'substation'}/{osm_id}"
        for kind, osm_id in query(
            """SELECT kind, osm_id FROM grid_node
                WHERE kind IN ('substation', 'plant') AND osm_id IS NOT NULL
                ORDER BY md5(osm_id::text) LIMIT 20"""
        )
    ]
    lines = [
        r[0]
        for r in query(
            """SELECT osm_id FROM osm_power_line
                WHERE voltage IS NOT NULL ORDER BY md5(osm_id::text) LIMIT 12"""
        )
    ]
    towers = [r[0] for r in query("SELECT DISTINCT osm_id FROM tower_number ORDER BY 1 LIMIT 400")][::40]
    asked = [f"/search/typeahead?q={q}&limit=10" for q in SEARCHES]
    asked += [f"/grid/route?from={a}&to={b}&paths=3" for a, b in zip(stations[0::2], stations[1::2])]
    asked += [f"/grid/line/{line}" for line in lines]
    asked += [f"/grid/tower/{tower}" for tower in towers]
    return asked


def answer(response) -> object:
    """What's compared: the status and the JSON, without how long it took."""
    try:
        body = response.json()
    except ValueError:
        body = response.text
    if isinstance(body, dict):
        body.pop("time", None)
    return {"status": response.status_code, "body": body}


def tower_numbers_digest() -> str:
    """Every tower's number, line and label, as one fingerprint."""
    rows = query(
        """SELECT osm_id, line_id, voltage, number, total, label, text
             FROM tower_number ORDER BY osm_id, line_id, voltage"""
    )
    digest = hashlib.sha256()
    for row in rows:
        digest.update(repr(row).encode())
    return f"{len(rows)} rows, {digest.hexdigest()}"


def test_the_answers_are_the_same():
    region = (query("SELECT value FROM oim_build_info WHERE key = 'region_id'") or [("db",)])[0][0]
    path = ANSWERS_DIR / f"{region}.json"
    record = os.environ.get("OIM_RECORD") == "1" or not path.exists()
    if record:
        asked = questions()
    else:
        saved = json.loads(path.read_text())
        asked = list(saved["answers"])
    with client() as http:
        answers = {address: answer(http.get(address)) for address in asked}
    towers = tower_numbers_digest()
    if record:
        ANSWERS_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps({"tower_numbers": towers, "answers": answers}, indent=1, ensure_ascii=False)
        )
        pytest.skip(f"recorded {len(answers)} answers in {path}")
    different = [a for a in asked if answers[a] != saved["answers"][a]]
    assert not different, f"{len(different)} answers changed, e.g. {different[:3]}"
    assert towers == saved["tower_numbers"]
