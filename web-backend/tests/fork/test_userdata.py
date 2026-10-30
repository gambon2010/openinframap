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
