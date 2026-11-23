"""src/fork/terrain: elevations decoded from Terrarium tiles, and contour lines traced
from them as on US military maps."""

import io
import math

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from PIL import Image

from src.fork.terrain import contour_marks, contours, elevations

# A tile row in France at zoom 12 (about 45° north): a pixel there is 13.4 m.
ROW_45N = 1468


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
    lines = contours.tile_lines(window, 12, ROW_45N)  # every 20 m
    heights = sorted({c.level for c in lines})
    # Smoothing rounds the top off (250 m): up to 200 at least, every 20 m.
    assert heights[:10] == [20, 40, 60, 80, 100, 120, 140, 160, 180, 200]
    ring_100 = [c.line for c in lines if c.level == 100]
    assert len(ring_100) == 1 and ring_100[0].is_closed
    # 15 pixels from the middle (250 - 10 * 15 = 100), in tile units; smoothing
    # moves a cone's rings a little (within 2 pixels).
    radius = shapely.Point(contours.EXTENT / 2, contours.EXTENT / 2).distance(ring_100[0])
    assert abs(radius - 15 * contours.EXTENT / 64) < 2 * contours.EXTENT / 64
    decoded = mapbox_vector_tile.decode(contours.encode(lines))[contours.LAYER]["features"]
    index = {f["properties"]["ele"] for f in decoded if f["properties"]["kind"] == "index"}
    assert index == {100, 200}
    # A hill isn't a depression; its slopes too steep for supplementary lines.
    assert not any(c.depression for c in lines)
    assert not any(c.kind == "supplementary" for c in lines)


def test_a_hollow_s_rings_are_depressions_their_inside_on_the_right():
    bowl = (500 - cone(top=250)).astype(np.float32)  # 250 m at the bottom, rising 10 m a pixel
    lines = contours.tile_lines(elevations.Window(bowl, left=0, top=0, width=64), 12, ROW_45N)
    ring = next(c for c in lines if c.level == 360)
    assert ring.depression and ring.line.is_closed
    # Rows grow downwards: inside on the right is clockwise on screen, which shapely
    # (rows up) calls counter-clockwise.
    assert shapely.LinearRing(ring.line.coords).is_ccw


def test_supplementary_lines_at_half_the_interval_on_level_ground_only():
    plain = np.tile(np.linspace(1, 39, 64), (64, 1)).astype(np.float32)  # 38 m over 6.9 km
    lines = contours.tile_lines(elevations.Window(plain, left=0, top=0, width=64), 12, ROW_45N)
    assert {c.level for c in lines if c.kind == "supplementary"} == {10, 30}
    assert {c.level for c in lines if c.kind != "supplementary"} == {20}
    # Zoomed out (zoom 11), none: supplementary lines are the 1:50,000 sheets'.
    zoomed_out = contours.tile_lines(elevations.Window(plain, left=0, top=0, width=64), 11, ROW_45N // 2)
    assert not any(c.kind == "supplementary" for c in zoomed_out)


def test_level_ground_is_where_regular_lines_would_be_an_inch_apart_on_screen():
    pixel = contour_marks.ground_metres_per_pixel(12, ROW_45N)
    assert 13 < pixel < 14
    # 20 m lines 96 pixels (1.3 km) apart: a slope of 20 / 1300.
    assert contour_marks.flattest_slope(20, 12, ROW_45N) == 20 / (96 * pixel)


def test_smoothing_keeps_a_slope_and_leaves_unknown_heights_unknown():
    slope = np.tile(np.arange(20, dtype=np.float64) * 10, (20, 1))
    slope[:, :3] = np.nan
    smooth = contours.smoothed(slope, 1.5)
    assert np.isnan(smooth[:, :3]).all()
    assert smooth.shape == slope.shape
    # A straight slope stays, beyond the blur's reach of the edges (SciPy's: four
    # spreads, 12 pixels).
    wide = np.tile(np.arange(40, dtype=np.float64) * 10, (40, 1))
    assert np.allclose(contours.smoothed(wide, 3)[20, 13:27], wide[20, 13:27])


def test_no_lines_over_the_sea_or_where_there_are_no_heights():
    flat_sea = elevations.Window(np.zeros((16, 16), dtype=np.float32), left=0, top=0, width=16)
    assert contours.tile_lines(flat_sea, 12, ROW_45N) == []
    unknown = elevations.Window(np.full((16, 16), np.nan, dtype=np.float32), left=0, top=0, width=16)
    assert contours.tile_lines(unknown, 12, ROW_45N) == []


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


def test_a_point_s_height_between_the_pixels_around_it(monkeypatch):
    rows, cols = np.mgrid[0:512, 0:512]
    slope = (cols * 2.0).astype(np.float32)  # 2 m a pixel, rising east
    fake = FakeFiles({})
    fake.tiles[(13, 4240, 2880)] = terrarium(slope)
    monkeypatch.setattr(elevations.files, "TERRAIN_FILES", fake)
    elevations.tile_heights.cache_clear()
    # The middle of that tile: between pixel centres 255 and 256 (510 and 512 m).
    lon = (4240 + 0.5) / 2**13 * 360 - 180
    n = math.pi * (1 - 2 * (2880 + 0.5) / 2**13)
    lat = math.degrees(math.atan(math.sinh(n)))
    assert abs(elevations.elevation(lon, lat) - 511) < 0.05
    assert elevations.elevation(lon + 1, lat) is None  # no terrain there


def test_horn_s_slope_of_a_plane_and_a_flat():
    # Rising 1 m a pixel eastwards, 1 m pixels: 45°.
    plane = np.array([[0, 1, 2], [0, 1, 2], [0, 1, 2]], dtype=np.float64)
    assert abs(elevations.horn_slope(plane, 1.0) - 45) < 1e-9
    assert elevations.horn_slope(np.full((3, 3), 300.0), 6.6) == 0
