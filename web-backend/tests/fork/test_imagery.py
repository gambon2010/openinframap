"""src/fork/imagery.py: the imagery list the scripts write, served as it is."""

import json

from starlette.applications import Starlette
from starlette.testclient import TestClient

from src.fork import imagery


def test_the_list_as_written_or_empty(tmp_path, monkeypatch):
    monkeypatch.setattr(imagery, "IMAGERY_LIST", tmp_path / "imagery.json")
    client = TestClient(Starlette(routes=imagery.routes))
    assert client.get("/imagery").json() == []  # none yet
    listed = [{"file": "world.sat-overview", "format": "jpg", "minzoom": 0, "maxzoom": 8}]
    (tmp_path / "imagery.json").write_text(json.dumps(listed))
    assert client.get("/imagery").json() == listed
    (tmp_path / "imagery.json").write_text("half writ")
    assert client.get("/imagery").json() == []  # unreadable: none
