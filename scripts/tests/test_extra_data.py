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
