"""scripts/satimagery/sources/: one file per offline map source. The contract every
source keeps, so the menus, sizes, inventory and the map's tiers can rely on it."""

import importlib
import pkgutil

import pytest

from satimagery import sources
from satimagery.sources.source import FETCH_KINDS, LAYERS, Source

MODULES = [m.name for m in pkgutil.iter_modules(sources.__path__) if m.name != "source"]


def test_every_file_is_read():
    assert sorted(sources.SOURCES) == sorted(MODULES)
    assert {"blue_marble", "sentinel2", "protomaps", "fr_ign"} <= set(MODULES)


@pytest.mark.parametrize("name", MODULES)
def test_a_source_declares_what_the_menus_need(name):
    s = importlib.import_module(f"satimagery.sources.{name}").SOURCE
    assert isinstance(s, Source) and s.id == name
    assert s.name and s.title and s.credit
    # Credits travel in VITE_SATELLITE_TIERS, between ";" and after "|".
    assert ";" not in s.credit and "|" not in s.credit
    assert s.layer in LAYERS and s.fetch in FETCH_KINDS and s.address
    assert 0 <= s.first_zoom <= s.last_zoom <= 22
    if s.layer == "basemap":
        assert s.detail_m is None
        return
    # Imagery: never made past the zoom where its pixels only stretch.
    assert s.detail_m and s.last_zoom <= s.finest_zoom()
    assert s.tile_bytes > 0 and s.per_second > 0
    if s.fetch == "tiles":
        assert "{z}" in s.address and "{x}" in s.address
        assert "{y}" in s.address or "{ty}" in s.address
    if s.fetch == "wms":
        assert "{bbox}" in s.address
    if s.fetch == "files":
        # Downloaded unit by unit with a converter module, read whole.
        assert s.units and s.read_per_km2 > 0
        converter = importlib.import_module(f"satimagery.{s.address}")
        # What the menu asks of a source fetched by units.
        for function in (
            "units_in",
            "unit_name",
            "unit_code",
            "unit_of",
            "unit_file",
            "unit_estimate",
            "jobs",
        ):
            assert callable(getattr(converter, function)), function
    if s.layer == "detailed":
        assert s.regions and s.first_zoom == sources.AERIAL_FIRST_ZOOM
    if s.bbox:
        west, south, east, north = s.bbox
        assert -180 <= west < east <= 180 and -90 <= south < north <= 90


def test_the_zoom_where_pixels_stretch():
    # Sentinel-2's 10 m: zoom 13 (~13 m a pixel at 45°); 14 would only stretch it.
    assert sources.SENTINEL2.finest_zoom() == 13
    assert sources.BLUE_MARBLE.finest_zoom() == 8
    assert sources.SOURCES["fr_ign"].finest_zoom() == 19
    assert sources.SOURCES["fr_ign"].label == "IGN 20 cm"
    assert sources.SENTINEL2.label == "Sentinel-2 10 m"
