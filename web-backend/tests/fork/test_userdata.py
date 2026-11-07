"""Fork: My layers' backend (src/fork/userdata/): what can be checked without a database."""

import asyncio
import uuid
from types import SimpleNamespace

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


def test_migrations_are_numbered_and_split_cleanly():
    found = schema.migrations()
    # 001, 002...: none missing, none twice.
    assert [n for n, _, _ in found] == list(range(1, len(found) + 1))
    assert schema.LATEST == len(found)
    assert schema.statements(found[0][2])[0].strip() == "CREATE SCHEMA IF NOT EXISTS userdata"
    for _, name, sql in found:
        for statement in schema.statements(sql):
            # ensure_schema runs them one at a time (split on ";\n"): a statement
            # split in the middle would leave unbalanced brackets.
            assert statement.count("(") == statement.count(")"), (name, statement[:80])
            assert ";" not in statement.rstrip().rstrip(";"), (name, statement[:80])


def test_a_migration_name_is_checked(tmp_path):
    (tmp_path / "1_bad.sql").write_text("SELECT 1")
    with pytest.raises(ValueError, match="NNN_name"):
        schema.migrations(tmp_path)


class FakeDb:
    """Answers the version queries; records the statements run."""

    def __init__(self, version):
        self.version, self.ran, self.committed = version, [], False

    async def execute(self, statement, params=None):
        sql = str(statement)
        self.ran.append((sql, params))
        if "to_regclass('userdata.schema_version')" in sql:
            return SimpleNamespace(scalar=lambda: self.version > 0)
        if "max(version)" in sql:
            return SimpleNamespace(scalar=lambda: self.version)
        if "INSERT INTO userdata.schema_version" in sql:
            self.version = params["v"]
        return SimpleNamespace(scalar=lambda: None)

    async def commit(self):
        self.committed = True


def test_only_the_new_migrations_run(monkeypatch):
    monkeypatch.setattr(
        schema,
        "MIGRATIONS",
        [(1, "first", "CREATE TABLE one (a int);\n"), (2, "second", "-- note\nALTER TABLE one ADD b int;\n")],
    )
    monkeypatch.setattr(schema, "LATEST", 2)
    db = FakeDb(version=1)
    asyncio.run(schema.ensure_schema(db))  # type: ignore[arg-type]
    ran = [sql for sql, _ in db.ran]
    assert "ALTER TABLE one ADD b int" in ran and "CREATE TABLE one (a int)" not in ran
    assert any("pg_advisory_xact_lock" in sql for sql in ran)
    assert db.version == 2 and db.committed
    # Up to date: nothing but the version check.
    again = FakeDb(version=2)
    asyncio.run(schema.ensure_schema(again))  # type: ignore[arg-type]
    assert len(again.ran) == 2 and not again.committed


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
