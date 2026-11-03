from datetime import datetime, timezone

from src.fork.about import templates


def render(**context):
    defaults = {"request": None, "url_for": lambda *a, **k: "/", "build": {}, "sources": [], "wikidata": 0}
    return templates.env.get_template("fork_about.html").render(**{**defaults, **context})


def test_the_maps_data_and_credits():
    html = render(
        build={
            "region_name": "France",
            "osm_timestamp": "2026-10-14T20:21:12Z",
            "built_at": "2026-10-16T16:39:59Z",
            "source": "https://download.geofabrik.de/europe/france-latest.osm.pbf",
            "git_commit": "7163224",
        },
        sources=[
            {
                "name": "Géorisques: ICPE",
                "licence": "Licence Ouverte 2.0 (Etalab)",
                "attribution": "Géorisques",
                "url": "https://www.georisques.gouv.fr",
                "features": 136000,
                "imported_at": datetime(2026, 10, 20, tzinfo=timezone.utc),
            }
        ],
        wikidata=1234,
    )
    assert "<strong>France</strong>" in html
    assert "2026-10-14" in html and "20:21 UTC" in html
    assert "136,000" in html and "2026-10-20" in html
    assert "Licence Ouverte 2.0" in html
    assert "1,234" in html
    assert "OpenStreetMap contributors" in html


def test_without_a_build_record():
    html = render()
    assert "No record of how this database was built" in html
    # Upstream's text about the public website is gone.
    assert "I'm Russ" not in html
