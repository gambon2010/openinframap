"""src/fork/terrain: elevations decoded from Terrarium tiles, and contour lines traced
from them as on US military maps."""

import io

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from PIL import Image

from src.fork.terrain import contours, elevations


def terrarium(heights: np.ndarray) -> bytes:
    """A lossless WebP tile holding these heights, Terrarium encoded."""
    value = heights.astype(np.float64) + 32768
    red = np.floor(value / 256)
    green = np.floor(value - red * 256)
    blue = np.round((value - red * 256 - green) * 256)
    rgb = np.dstack([red, green, blue]).astype(np.uint8)
    out = io.BytesIO()
    Image.fromarray(rgb, "RGB").save(out, "WEBP", lossless=True)
    return out.getvalue()


def cone(size: int = 64, top: float = 250.0) -> np.ndarray:
    """A hill: `top` metres at the middle, falling 10 m a pixel."""
    rows, cols = np.mgrid[0:size, 0:size]
    distance = np.hypot(rows - size / 2, cols - size / 2)
    return (top - 10 * distance).astype(np.float32)


def test_terrarium_heights_decoded_exactly():
    heights = np.array([[0.0, 12.5], [-30.25, 4807.75]], dtype=np.float32)
    assert np.array_equal(elevations.decode(terrarium(heights)), heights)


def test_the_interval_follows_the_military_maps_scales():
    assert [contours.interval(z) for z in (9, 10, 11, 12, 13, 14, 16)] == [100, 100, 50, 20, 20, 10, 10]


def test_lines_every_interval_above_sea_level():
    assert contours.levels(np.array([-12.0, 3.0, 95.0]), 20) == [20, 40, 60, 80]


def test_a_hill_s_contours_are_rings_round_it_index_lines_marked():
    window = elevations.Window(cone(), left=0, top=0, width=64)
    lines = contours.tile_lines(window, 12)  # every 20 m
    heights = sorted({level for level, _ in lines})
    # Smoothing rounds the top off (250 m): up to 200 at least, every 20 m.
    assert heights[:10] == [20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
    ring_100 = [line for level, line in lines if level == 100]
    assert len(ring_100) == 1 and ring_100[0].is_closed
    # 15 pixels from the middle (250 - 10 * 15 = 100), in tile units; smoothing
    # moves a cone's rings a little (within 2 pixels).
    radius = shapely.Point(contours.EXTENT / 2, contours.EXTENT / 2).distance(ring_100[0])
    assert abs(radius - 15 * contours.EXTENT / 64) < 2 * contours.EXTENT / 64
    decoded = mapbox_vector_tile.decode(contours.encode(lines, 20))[contours.LAYER]["features"]
    index = {f["properties"]["ele"] for f in decoded if f["properties"]["index"]}
    assert index == {100, 200}


def test_smoothing_keeps_a_slope_and_leaves_unknown_heights_unknown():
    slope = np.tile(np.arange(20, dtype=np.float64) * 10, (20, 1))
    slope[:, :3] = np.nan
    smooth = contours.smoothed(slope, 1.5)
    assert np.isnan(smooth[:, :3]).all()
    assert smooth.shape == slope.shape
    # A straight slope stays, beyond the blur's reach of the edges (9 pixels).
    wide = np.tile(np.arange(40, dtype=np.float64) * 10, (40, 1))
    assert np.allclose(contours.smoothed(wide, 3)[20, 10:30], wide[20, 10:30])


def test_no_lines_over_the_sea_or_where_there_are_no_heights():
    flat_sea = elevations.Window(np.zeros((16, 16), dtype=np.float32), left=0, top=0, width=16)
    assert contours.tile_lines(flat_sea, 12) == []
    unknown = elevations.Window(np.full((16, 16), np.nan, dtype=np.float32), left=0, top=0, width=16)
    assert contours.tile_lines(unknown, 12) == []


class FakeFiles:
    """Terrain files holding zoom 13 tiles, each a flat height of its own."""

    def __init__(self, heights: dict[tuple[int, int, int], float]):
        self.tiles = {zxy: terrarium(np.full((512, 512), h, dtype=np.float32)) for zxy, h in heights.items()}

    def tile(self, z, x, y):
        return self.tiles.get((z, x, y))

    def version(self):
        return "test"


def test_a_window_reaches_into_the_neighbours_and_past_13_cuts_zoom_13(monkeypatch):
    monkeypatch.setattr(
        elevations.files, "TERRAIN_FILES", FakeFiles({(13, 10, 10): 100.0, (13, 11, 10): 200.0})
    )
    elevations.tile_heights.cache_clear()
    w = elevations.window(13, 10, 10, margin=4)
    assert w is not None and w.width == 512 and (w.left, w.top) == (4, 4)
    assert w.heights.shape == (520, 520)
    assert w.heights[260, 260] == 100 and w.heights[260, 518] == 200  # its east neighbour
    assert np.isnan(w.heights[0, 0])  # none to the north-west
    # Zoom 14, the east half of that tile: a 256-pixel part, the neighbour beside it.
    east = elevations.window(14, 21, 20, margin=4)
    assert east is not None and east.width == 256 and east.heights[130, 262] == 200
    assert elevations.window(13, 50, 50, margin=4) is None  # no terrain there
