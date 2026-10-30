"""Fork: My layers' backend (src/fork/userdata.py): what can be checked without a database."""

import uuid
from pathlib import Path

import pytest
from starlette.exceptions import HTTPException

from src.fork import userdata
from src.fork.userdata import parse_uuid


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


def test_schema_has_situations_and_is_upgraded_by_its_newest_table():
    sql = (Path(userdata.__file__).parent / "userdata.sql").read_text()
    assert "CREATE TABLE IF NOT EXISTS userdata.situation" in sql
    # ensure_schema checks for the newest table, so older databases get it too.
    assert "to_regclass('userdata.situation')" in Path(userdata.__file__).read_text()


def test_parse_time():
    from datetime import datetime, timezone

    from src.fork.userdata import parse_time

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
        asyncio.run(userdata.read_json(FakeRequest(body)))
    assert e.value.status_code == 400


def test_read_json():
    import asyncio

    assert asyncio.run(userdata.read_json(FakeRequest({"name": "x"}))) == {"name": "x"}
