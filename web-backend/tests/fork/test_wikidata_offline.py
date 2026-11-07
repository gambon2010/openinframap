"""src/fork/wikidata_offline.py: popups from the offline Wikidata cache."""

import asyncio
import json

import httpx

from src.fork import wikidata_offline as wo


def run(coroutine):
    return asyncio.run(coroutine)


def test_cache_lookups(tmp_path):
    (tmp_path / "Q1.json").write_text(json.dumps({"id": "Q1"}))
    (tmp_path / "Q2.json").write_text("not json")
    (tmp_path / "Q3.jpg").write_bytes(b"x")
    assert wo.cached_entity("Q1", tmp_path) == {"id": "Q1"}
    assert wo.cached_entity("Q2", tmp_path) is None
    assert wo.cached_entity("Q9", tmp_path) is None
    assert wo.local_image("Q3", tmp_path) == "/local-images/Q3.jpg"
    assert wo.local_image("Q9", tmp_path) is None


def test_entity_from_the_cache_first_and_none_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(wo, "WIKIDATA_JSON_DIR", tmp_path)
    (tmp_path / "Q1.json").write_text(json.dumps({"id": "Q1"}))
    asked = []

    async def online(wikidata_id, client):
        asked.append(wikidata_id)
        if wikidata_id == "Q3":
            raise httpx.ConnectError("no network")
        return {"id": wikidata_id, "online": True}

    get = wo.offline_get_wikidata(online)
    assert run(get("Q1", None)) == {"id": "Q1"}  # no request
    assert run(get("Q2", None)) == {"id": "Q2", "online": True}
    assert run(get("Q3", None)) is None
    assert asked == ["Q2", "Q3"]


def test_the_item_shown_gets_its_downloaded_picture(tmp_path, monkeypatch):
    monkeypatch.setattr(wo, "IMAGES_DIR", tmp_path)
    (tmp_path / "Q5.png").write_bytes(b"x")

    async def commons(filename, client, width=300):
        if filename == "offline.jpg":
            raise httpx.ReadTimeout("no network")
        return {"imageinfo": [{"thumburl": f"https://commons/{filename}"}]}

    thumbnail = wo.offline_get_commons_thumbnail(commons)

    async def details(wikidata_id, client):
        # As upstream's wikidata_json: the picture asked for by file name.
        return (await thumbnail("Plant.jpg", client)) or {}

    shown = wo.remembering_item(details)
    assert run(shown("Q5", None)) == {"imageinfo": [{"thumburl": "/local-images/Q5.png"}]}
    assert run(shown("Q6", None))["imageinfo"][0]["thumburl"] == "https://commons/Plant.jpg"
    assert run(thumbnail("offline.jpg", None)) is None


def test_installed_where_upstream_uses_them():
    from src import data
    from src.views import area, wikidata

    wo.install()
    wo.install()  # once
    assert data.get_wikidata is wikidata.get_wikidata is area.get_wikidata
    assert data.get_wikidata.__wrapped__.__module__ == "src.data"
    assert wikidata.get_commons_thumbnail is area.get_commons_thumbnail
    assert wikidata.wikidata_json.__wrapped__.__module__ == "src.views.wikidata"
