"""Fork: My layers' backend (src/fork/userdata/): what can be checked without a database."""

import uuid
from pathlib import Path

import pytest
from starlette.exceptions import HTTPException

from src.fork import userdata
from src.fork.userdata import layers, schema
from src.fork.userdata.changes import parse_uuid


def test_parse_uuid():
    value = uuid.uuid4()
    assert parse_uuid(str(value), "layer") == value
    for bad in ("", "nope", None, 12):
        with pytest.raises(HTTPException) as e:
            parse_uuid(bad, "layer")
        assert e.value.status_code == 400
        assert "layer" in e.value.detail


def test_schema_statements_split_cleanly():
    # ensure_schema runs userdata.sql statement by statement (split on ";\n").
    sql = (Path(userdata.__file__).parent / "userdata.sql").read_text()
    statements = [s.strip() for s in sql.split(";\n") if s.strip()]
    assert any("CREATE TABLE IF NOT EXISTS userdata.change" in s for s in statements)
    for statement in statements:
        # A statement split in the middle would leave unbalanced brackets.
        assert statement.count("(") == statement.count(")"), statement[:80]


def test_schema_is_upgraded_by_its_newest_addition():
    sql = (Path(userdata.__file__).parent / "userdata.sql").read_text()
    assert "CREATE TABLE IF NOT EXISTS userdata.situation" in sql
    assert "userdata.feature_status" not in sql  # statuses removed (2026-11-06)
    # ensure_schema checks for the newest addition (the last statement makes that
    # table), so older databases get everything.
    last = [s for s in sql.split(";\n") if s.strip()][-1]
    assert f"CREATE TABLE IF NOT EXISTS {schema.NEWEST_TABLE} " in last


def test_parse_time():
    from datetime import datetime, timezone

    from src.fork.userdata.changes import parse_time

    assert parse_time("2026-10-30T10:00:00Z") == datetime(2026, 10, 30, 10, tzinfo=timezone.utc)
    assert parse_time("2026-10-30T10:00:00").tzinfo is not None  # no zone: UTC
    assert parse_time("not a date").tzinfo is not None  # unreadable: now
    assert parse_time(None).tzinfo is not None


class FakeRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


@pytest.mark.parametrize("body", [ValueError("bad"), [1, 2], "text"])
def test_read_json_rejects_what_is_not_an_object(body):
    import asyncio

    with pytest.raises(HTTPException) as e:
        asyncio.run(layers.read_json(FakeRequest(body)))
    assert e.value.status_code == 400


def test_read_json():
    import asyncio

    assert asyncio.run(layers.read_json(FakeRequest({"name": "x"}))) == {"name": "x"}


def test_routes_are_where_they_were():
    from src.fork import map_data

    paths = {route.path for route in userdata.routes} | {route.path for route in map_data.routes}
    assert paths == {
        "/userdata",
        "/userdata/save",
        "/userdata/history",
        "/userdata/events",
        "/userdata/settings/{key}",
        "/userdata/situations",
        "/userdata/situations/{situation_id}",
        "/userdata/images",
        "/userdata/images/{image_id}",
        "/userdata/layers/{layer_id}/access",
        "/userdata/source-feature",
    }


def test_the_logged_in_user_or_anyone_without_the_middleware():
    from types import SimpleNamespace

    from src.fork.userdata.users import ANYONE, User, current_user

    alice = User(id="1", name="Alice")
    assert current_user(SimpleNamespace(scope={"user": alice})) is alice  # type: ignore[arg-type]
    assert current_user(SimpleNamespace(scope={})) is ANYONE  # type: ignore[arg-type]


def test_live_events_are_server_sent_events():
    from src.fork.userdata.events import STREAMING, event, summary

    assert event("changes", {"changes": []}, 12) == 'id: 12\nevent: changes\ndata: {"changes": []}\n\n'
    assert event("ready", {}).startswith("event: ready\n")
    assert "/userdata/events" in STREAMING
    changes = [
        {"layer_id": "b", "author": "Bob"},
        {"layer_id": "a", "author": None},
        {"layer_id": "b", "author": "Bob"},
    ]
    assert summary(changes) == {"count": 3, "layers": ["a", "b"], "authors": ["Bob"]}
