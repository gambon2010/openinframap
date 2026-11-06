"""scripts/extra_data.py: outlines and classification (no network, no database)."""

from extra_data import GeorisquesICPE, inside, outer_rings

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]],
}


def test_outer_rings():
    assert outer_rings(SQUARE) == [SQUARE["coordinates"][0]]
    multi = {
        "type": "MultiPolygon",
        "coordinates": [SQUARE["coordinates"], SQUARE["coordinates"]],
    }
    assert len(outer_rings(multi)) == 2


def test_inside():
    rings = outer_rings(SQUARE)
    assert inside([5, 5], rings)
    assert not inside([15, 5], rings)
    assert not inside([5, -1], rings)


def test_icpe_categories():
    category = GeorisquesICPE.category
    assert category({"statutSeveso": "Seveso seuil haut"}) == "seveso_high"
    assert category({"statutSeveso": "Seveso seuil bas"}) == "seveso_low"
    assert category({"eolienne": True}) == "wind"
    assert category({"carriere": True}) == "quarry"
    assert category({"porcs": True}) == "livestock"
    assert category({}) == "industry"
    # Seveso wins over the rest.
    assert (
        category({"statutSeveso": "Seveso seuil haut", "eolienne": True})
        == "seveso_high"
    )


def test_which_sources_and_datasets_an_import_takes():
    from types import SimpleNamespace

    import pytest

    from extradata import SOURCES
    from extradata.cli import wanted_sources

    covering = [(s, ["67"]) for s in SOURCES.values()]

    def args(sources=(), choose=None, only=None):
        return SimpleNamespace(sources=list(sources), choose=choose, only=only)

    # Nothing asked for: every source that covers the region, every dataset.
    assert wanted_sources(args(), covering) == (set(SOURCES), None)
    # A choice: only its source, only its datasets.
    assert wanted_sources(args(choose="gas"), covering) == ({"fr-agence-ore"}, ["gaz"])
    assert wanted_sources(args(choose="gas,icpe"), covering)[0] == set(SOURCES)
    with pytest.raises(SystemExit, match="Unknown choice"):
        wanted_sources(args(choose="nope"), covering)
    with pytest.raises(SystemExit, match="Unknown source"):
        wanted_sources(args(sources=["nope"]), covering)
