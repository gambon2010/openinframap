"""scripts/fetch_images.py: the offline Wikidata cache (entity JSON and Commons
thumbnails), with a fake database cursor and a fake HTTP client."""

import json

import psycopg2
import pytest

import fetch_images as fi
import netsafe


@pytest.fixture(autouse=True)
def folders(tmp_path, monkeypatch):
    """The cache in a temporary folder; no waiting between requests."""
    monkeypatch.setattr(fi, "IMAGES_DIR", tmp_path / "images")
    monkeypatch.setattr(fi, "WIKIDATA_JSON_DIR", tmp_path / "json")
    (tmp_path / "images").mkdir()
    (tmp_path / "json").mkdir()
    monkeypatch.setattr(fi.time, "sleep", lambda _: None)
    monkeypatch.setattr(netsafe, "connection", netsafe.Connection())


class Cursor:
    def __init__(self, rows_by_table):
        self.rows_by_table, self.rows = rows_by_table, []

    def execute(self, sql):
        table = sql.split(" FROM ")[1].split()[0]
        if table not in self.rows_by_table:
            raise psycopg2.Error(f"no table {table}")
        self.rows = self.rows_by_table[table]

    def fetchall(self):
        return self.rows

    def close(self):
        pass


class Conn:
    def __init__(self, rows_by_table):
        self.cur, self.rolled_back = Cursor(rows_by_table), 0

    def cursor(self):
        return self.cur

    def rollback(self):
        self.rolled_back += 1


def test_wikidata_ids_from_every_table(capsys):
    conn = Conn(
        {
            "osm_power_plant": [("Q1",), ("q2",), ("not an id",), (None,)],
            "osm_power_substation": [("Q1",), ("Q3",)],
        }
    )
    # Valid IDs only, upper case, once each; a missing table is skipped (rolled back).
    assert fi.get_wikidata_ids(conn) == {"Q1", "Q2", "Q3"}
    assert conn.rolled_back == len(fi.TAGGED_TABLES) - 2
    assert "could not query" in capsys.readouterr().err


def test_small_helpers():
    assert list(fi.chunks([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]
    (fi.IMAGES_DIR / "Q7.png").write_bytes(b"x")
    assert fi.local_path("Q7") == fi.IMAGES_DIR / "Q7.png"
    assert fi.local_path("Q8") is None
    image = {"mainsnak": {"datatype": "commonsMedia", "datavalue": {"value": "A.jpg"}}}
    assert fi.image_of({"claims": {"P18": [image]}}) == "A.jpg"
    assert fi.image_of({"claims": {}}) is None


def test_part_of_references_not_cached_yet():
    (fi.WIKIDATA_JSON_DIR / "Q10.json").write_text("{}")

    def part_of(*ids):
        return {
            "claims": {
                "P361": [{"mainsnak": {"datavalue": {"value": {"id": i}}}} for i in ids]
            }
        }

    entities = {
        "Q1": part_of("Q10", "q11"),
        "Q2": part_of("Q12"),
        "Q3": {"claims": {"P361": [{}]}},
    }
    assert fi.collect_p361_ids(entities) == {"Q11", "Q12"}


class Response:
    def __init__(self, data=None, content=b""):
        self.data, self.content, self.status_code = data, content, 200

    def json(self):
        return self.data

    def raise_for_status(self):
        pass


class Client:
    """Answers like Wikidata, Commons and their CDN; records what it was asked."""

    def __init__(self):
        self.asked = []

    def get(self, url, params=None, follow_redirects=False):
        self.asked.append((url, params))
        if "wikidata" in url:
            ids = params["ids"].split("|")
            return Response(
                {
                    "entities": {
                        i: ({"missing": ""} if i == "Q404" else {"id": i, "claims": {}})
                        for i in ids
                    }
                }
            )
        if "commons" in url:
            titles = params["titles"].split("|")
            return Response(
                {
                    "query": {
                        "pages": {
                            str(n): {
                                "title": t,
                                "imageinfo": [{"thumburl": f"https://up/{n}.png"}],
                            }
                            for n, t in enumerate(titles)
                        }
                    }
                }
            )
        return Response(content=b"image bytes")


def test_entities_fetched_cached_and_missing_ones_skipped():
    client = Client()
    got = fi.fetch_entity_data(client, ["Q1", "Q404"])
    assert set(got) == {"Q1"}
    assert json.loads((fi.WIKIDATA_JSON_DIR / "Q1.json").read_text())["id"] == "Q1"
    assert not (fi.WIKIDATA_JSON_DIR / "Q404.json").exists()


def test_step_entities_reads_the_cache_first():
    image = {
        "mainsnak": {"datatype": "commonsMedia", "datavalue": {"value": "Plant.jpg"}}
    }
    (fi.WIKIDATA_JSON_DIR / "Q5.json").write_text(
        json.dumps({"claims": {"P18": [image]}})
    )
    client = Client()
    fetched, images = fi.step_entities(client, ["Q5", "Q6"], "/3")
    # Q5 from the cache (no request for it), Q6 from Wikidata.
    assert set(fetched) == {"Q5", "Q6"}
    assert client.asked[0][1]["ids"] == "Q6"
    assert images == {"Q5": "Plant.jpg"}


def test_thumbnails_and_images():
    client = Client()
    urls = fi.step_thumbnail_urls(client, {"Q5": "Plant.jpg", "Q6": "Dam.jpg"})
    assert set(urls) == {"Q5", "Q6"} and all(
        u.startswith("https://up/") for u in urls.values()
    )
    assert fi.step_images(client, urls) == (2, 0)
    assert (fi.IMAGES_DIR / "Q5.png").read_bytes() == b"image bytes"


def test_count_prints_what_is_missing(monkeypatch, capsys):
    (fi.WIKIDATA_JSON_DIR / "Q1.json").write_text("{}")
    (fi.IMAGES_DIR / "Q1.jpg").write_bytes(b"x")
    (fi.WIKIDATA_JSON_DIR / "Q2.json").write_text("{}")
    monkeypatch.setattr(fi, "wikidata_ids", lambda url, quiet: {"Q1", "Q2", "Q3"})
    monkeypatch.setattr("sys.argv", ["fetch_images.py", "--count"])
    fi.main()
    # launch.sh reads the last line: IDs missing their JSON, IDs missing an image.
    assert capsys.readouterr().out.strip().splitlines()[-1] == "1 2"
