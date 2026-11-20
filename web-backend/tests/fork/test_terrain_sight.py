"""src/fork/terrain/sight.py: line of sight over made-up ground (as GDAL's viewshed:
curvature less refraction, an observer 2 m up)."""

from src.fork.terrain import sight

# Two points 1.1 km apart on a meridian, and 33 km apart.
NEAR = ((7.0, 47.0), (7.0, 47.01))
FAR = ((7.0, 47.0), (7.0, 47.3))


def ground(height_at):
    """Elevations by latitude (`height_at(lat)`), whatever the longitude."""
    return lambda lon, lat: height_at(lat)


def test_flat_ground_near_seen_all_along(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    found = sight.line_of_sight(*NEAR)
    assert found.target_seen and found.blocked_at is None
    assert all(s.seen for s in found.samples)
    assert abs(found.samples[-1].distance - 1112) < 5


def test_a_ridge_between_hides_the_target_and_the_ground_behind_it(monkeypatch):
    ridge = ground(lambda lat: 260.0 if 47.004 < lat < 47.005 else 200.0)
    monkeypatch.setattr(sight.elevations, "elevation", ridge)
    found = sight.line_of_sight(*NEAR)
    assert found.target_seen is False
    assert 440 < found.blocked_at < 560  # the ridge, about 0.45 km away
    behind = [s for s in found.samples if s.distance > 600]
    assert not any(s.seen for s in behind)
    # A 100 m mast there still doesn't clear it (the line passes 242 m over the
    # ridge's 260 m); a 200 m one does (282 m).
    assert not sight.line_of_sight(*NEAR, target=100).target_seen
    assert sight.line_of_sight(*NEAR, target=200).target_seen


def test_the_earth_s_curvature_hides_what_is_far_on_flat_ground(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 0.0))
    # 33 km at 2 m: well past the horizon (about 5 km with refraction).
    assert sight.line_of_sight(*FAR).target_seen is False
    # From 100 m up to a 50 m tower, both see over the bulge.
    assert sight.line_of_sight(*FAR, observer=100, target=50).target_seen


def test_no_terrain_under_an_end_no_answer(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", lambda lon, lat: None)
    assert sight.line_of_sight(*NEAR).target_seen is None
