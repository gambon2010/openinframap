"""src/fork/background/mvt.py: a tile's layers listed, kept or dropped, undecoded."""

import mapbox_vector_tile  # type: ignore[import-untyped]

from src.fork.background import mvt


def tile(*names: str) -> bytes:
    return mapbox_vector_tile.encode(
        [
            {"name": name, "features": [{"geometry": "POINT(1 1)", "properties": {"n": i}}]}
            for i, name in enumerate(names)
        ]
    )


def test_the_layers_in_order():
    assert [name for name, _ in mvt.layers(tile("water", "roads", "places"))] == ["water", "roads", "places"]


def test_kept_or_dropped_layers_still_decode():
    data = tile("water", "roads", "places")
    assert set(mapbox_vector_tile.decode(mvt.drop(data, {"roads"}))) == {"water", "places"}
    assert set(mapbox_vector_tile.decode(mvt.keep(data, {"roads"}))) == {"roads"}
    # A tile is its layers end to end: one dropped and another's added.
    joined = mvt.drop(data, {"roads"}) + tile("roads")
    assert set(mapbox_vector_tile.decode(joined)) == {"water", "places", "roads"}


def test_an_empty_tile():
    assert mvt.layers(b"") == []
