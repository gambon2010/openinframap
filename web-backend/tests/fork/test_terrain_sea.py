"""background_build/terrain_sea.py: the sea flattened in a terrain tile, with the
background map's land as the mask."""

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np

from src.fork.background_build.terrain_sea import encode, flattened_tile, land_mask
from src.fork.terrain.elevations import TILE_PIXELS, decode


def heights(value: float) -> np.ndarray:
    return np.full((TILE_PIXELS, TILE_PIXELS), value, dtype=np.float32)


def test_terrarium_heights_come_back_exactly():
    grid = heights(0)
    grid[0, 0], grid[0, 1], grid[0, 2] = -12.5, 4807.25, 0.00390625  # 1/256 m: the finest step
    assert np.array_equal(decode(encode(grid)), grid)


def test_a_ship_at_sea_is_flattened_and_the_land_kept():
    grid = heights(0)
    grid[10, 10] = 120  # a ship, at sea
    grid[400, 400] = 350  # a hill, on land
    land = np.zeros((TILE_PIXELS, TILE_PIXELS), dtype=bool)
    land[256:, 256:] = True
    out = decode(flattened_tile(encode(grid), land))
    assert out[10, 10] == 0
    assert out[400, 400] == 350


def test_sea_below_zero_is_kept():
    grid = heights(-30)  # bathymetry
    sea = np.zeros((TILE_PIXELS, TILE_PIXELS), dtype=bool)
    tile = encode(grid)
    assert flattened_tile(tile, sea) is tile


def test_a_tile_all_on_land_or_without_a_background_tile_is_left_as_it_is():
    tile = encode(heights(200))
    assert flattened_tile(tile, np.ones((TILE_PIXELS, TILE_PIXELS), dtype=bool)) is tile
    assert flattened_tile(tile, None) is tile


def test_the_land_is_drawn_from_the_background_maps_earth_layer():
    # The west half of the tile is land (MVT coordinates: 4096 across, y down).
    west_half = {"type": "Polygon", "coordinates": [[(0, 0), (2048, 0), (2048, 4096), (0, 4096), (0, 0)]]}
    tile = mapbox_vector_tile.encode(
        [{"name": "earth", "features": [{"geometry": west_half, "properties": {}}]}],
        default_options={"y_coord_down": True},
    )
    mask = land_mask(tile)
    assert mask[100, 50] and mask[400, 200]
    assert not mask[100, 400] and not mask[400, 500]
