"""src/fork/terrain/sight.py: line of sight over made-up ground (as GDAL's viewshed:
curvature less refraction, an observer 2 m up)."""

import pytest

from src.fork.terrain import obstacles, sight

# Two points 1.1 km apart on a meridian, and 33 km apart.
NEAR = ((7.0, 47.0), (7.0, 47.01))
FAR = ((7.0, 47.0), (7.0, 47.3))


@pytest.fixture(autouse=True)
def bare_ground(monkeypatch):
    """Nothing stands on the ground unless a test says so (no background map read)."""
    monkeypatch.setattr(
        sight.obstacles, "obstacles_at", lambda points, heights: [obstacles.NOTHING] * len(points)
    )


def standing(at_lat, obstacle):
    """An obstacle on the points between two latitudes (`at_lat`: (south, north))."""
    south, north = at_lat
    return lambda points, heights: [
        obstacle if south < lat < north else obstacles.NOTHING for _, lat in points
    ]


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


def test_the_horizon_from_2_m_on_the_sea_is_5_45_km(monkeypatch):
    """The textbook horizon with the standard refraction: sqrt(2 R h / (1 - 1/7)),
    5453 m for eyes 2 m up (5048 m without refraction): a person lying on the sea is
    seen just inside it, hidden just past it."""
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 0.0))
    degrees_per_metre = 1 / 111_195  # along a meridian, on the mean sphere
    inside = ((7.0, 47.0), (7.0, 47.0 + 5300 * degrees_per_metre))
    past = ((7.0, 47.0), (7.0, 47.0 + 5600 * degrees_per_metre))
    assert sight.line_of_sight(*inside).target_seen
    assert sight.line_of_sight(*past).target_seen is False


def test_no_terrain_under_an_end_no_answer(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", lambda lon, lat: None)
    assert sight.line_of_sight(*NEAR).target_seen is None


def test_a_building_between_hides_the_target_and_says_so(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    block = standing((47.004, 47.005), obstacles.Obstacle(15.0, "building"))
    found = sight.line_of_sight(*NEAR, obstacles_at=block)
    assert found.target_seen is False and found.blocked_by == "building"
    assert 440 < found.blocked_at < 560
    assert found.margin < 0  # hidden by that much
    # Its surface, as the chart draws it, stands on the ground.
    on_it = [s for s in found.samples if s.obstacle.kind == "building"]
    assert all(abs(s.apparent - 215.0) < 1 for s in on_it)


def test_trees_at_the_observer_s_feet_are_left_out(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    # A wood over the first 20 m: the observer stands at its edge.
    wood = standing((46.9, 47.00018), obstacles.Obstacle(20.0, "trees"))
    found = sight.line_of_sight(*NEAR, obstacles_at=wood)
    assert found.target_seen and found.margin > 0


def test_trees_hide_the_ground_behind_them(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    wood = standing((47.003, 47.004), obstacles.Obstacle(20.0, "trees"))
    found = sight.line_of_sight(*NEAR, obstacles_at=wood)
    assert found.blocked_by == "trees"
    assert not any(s.seen for s in found.samples if s.distance > 500)


def test_hidden_only_by_trees_it_may_still_be_seen(monkeypatch):
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    wood = standing((47.003, 47.004), obstacles.Obstacle(20.0, "trees"))
    found = sight.line_of_sight(*NEAR, obstacles_at=wood)
    assert found.target_seen is False and found.through_trees


def test_trees_then_a_ridge_the_ridge_is_named(monkeypatch):
    # Trees 40 m tall at about 0.35 km, a 10 m rise at about 0.8 km: the rise is a sure
    # stop, and the margin is how far it, not the taller trees, rises over the line
    # (about 9 m; the trees about 38 m).
    ridge = ground(lambda lat: 210.0 if 47.007 < lat < 47.008 else 200.0)
    monkeypatch.setattr(sight.elevations, "elevation", ridge)
    wood = standing((47.003, 47.004), obstacles.Obstacle(40.0, "trees"))
    found = sight.line_of_sight(*NEAR, obstacles_at=wood)
    assert found.blocked_by == "ground" and not found.through_trees
    assert 770 < found.blocked_at < 890
    assert -11 < found.margin < -8


def test_nothing_is_added_where_the_terrain_already_holds_it(monkeypatch):
    """Off bare ground (outside France: Copernicus' surface model) trees aren't added again."""
    monkeypatch.setattr(sight.elevations, "elevation", ground(lambda lat: 200.0))
    wood = standing((47.003, 47.004), obstacles.Obstacle(20.0, "trees"))
    found = sight.line_of_sight(*NEAR, obstacles_at=wood, bare_ground=lambda lon, lat: False)
    assert found.target_seen and not found.obstacles_counted
