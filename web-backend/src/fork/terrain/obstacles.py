"""Fork: what stands on the ground along a line of sight (sight.py): the terrain's
elevations are the bare ground (IGN's model in France), so buildings and trees are
added from the background map's own tiles (zoom 15: every building, forest and wood
areas). A building stands as high as OpenStreetMap says, else as high as the line of
sight's card says (8 m at first); trees as high as it says (15 m at first): the
background map has no tree heights. Each tile is decoded once (a spatial index over
its shapes) and kept a while: a line crosses many points of the same tile."""

from __future__ import annotations

import math
from dataclasses import dataclass
from functools import lru_cache

import mapbox_vector_tile  # type: ignore[import-untyped]
import shapely

from ..background import ARCHIVES, unzipped

ZOOM = 15  # the background map's tiles holding every building
EXTENT = 4096  # a vector tile's coordinates across
FOREST_KINDS = ("forest", "wood")
CACHED_TILES = 256


@dataclass(frozen=True)
class Obstacle:
    height: float  # metres above the ground
    kind: str  # "building", "trees", "" (nothing)


NOTHING = Obstacle(0.0, "")


@dataclass(frozen=True)
class Heights:
    """The heights taken where the map gives none (metres)."""

    trees: float = 15.0
    buildings: float = 8.0


@dataclass(frozen=True)
class Standing:
    """A building or a wood in a tile: its kind, and its height if the map gives one."""

    kind: str
    height: float | None

    def obstacle(self, heights: Heights) -> Obstacle:
        if self.height is not None:
            return Obstacle(self.height, self.kind)
        return Obstacle(heights.trees if self.kind == "trees" else heights.buildings, self.kind)


def obstacles_at(points: list[tuple[float, float]], heights: Heights = Heights()) -> list[Obstacle]:
    """What stands at each point (lon, lat): the tallest building or trees there."""
    found = [NOTHING] * len(points)
    by_tile: dict[tuple[int, int], list[tuple[int, float, float]]] = {}
    for index, (lon, lat) in enumerate(points):
        x, y, px, py = tile_position(lon, lat)
        by_tile.setdefault((x, y), []).append((index, px, py))
    version = ARCHIVES.version()
    for (x, y), entries in by_tile.items():
        shapes = tile_shapes(x, y, version)
        if shapes is None:
            continue
        indexes = [index for index, _, _ in entries]
        standing = shapes.at([(px, py) for _, px, py in entries], heights)
        for index, obstacle in zip(indexes, standing):
            found[index] = obstacle
    return found


def tile_position(lon: float, lat: float) -> tuple[int, int, float, float]:
    """The zoom 15 tile a point is in, and where in it (the tile's own coordinates,
    0 to EXTENT, y down)."""
    n = 2**ZOOM
    fx = (lon + 180) / 360 * n
    fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
    x, y = int(fx), int(fy)
    return x, y, (fx - x) * EXTENT, (fy - y) * EXTENT


@dataclass
class TileShapes:
    """A tile's buildings and trees, with an index over them."""

    shapes: list[shapely.Geometry]
    standing: list[Standing]
    tree: shapely.STRtree

    def at(self, positions: list[tuple[float, float]], heights: Heights = Heights()) -> list[Obstacle]:
        """The tallest obstacle at each position."""
        points = shapely.points(positions)
        found = [NOTHING] * len(positions)
        point_index, shape_index = self.tree.query(points, predicate="within")
        for p, s in zip(point_index, shape_index):
            obstacle = self.standing[s].obstacle(heights)
            if obstacle.height > found[p].height:
                found[p] = obstacle
        return found


@lru_cache(maxsize=CACHED_TILES)
def tile_shapes(x: int, y: int, version: str) -> TileShapes | None:
    """A background tile's buildings and trees (None: no tile there). `version`: the
    files' version, so a rebuilt map is read again."""
    found = ARCHIVES.tile(ZOOM, x, y)
    if found is None:
        return None
    return shapes_of(mapbox_vector_tile.decode(unzipped(found[0]), default_options={"y_coord_down": True}))


def shapes_of(layers: dict) -> TileShapes:
    """A decoded tile's buildings and forests, as obstacles."""
    shapes: list[shapely.Geometry] = []
    standing: list[Standing] = []
    for feature in layers.get("buildings", {}).get("features", []):
        shapes.append(shapely.geometry.shape(feature["geometry"]))
        standing.append(Standing("building", building_height(feature["properties"])))
    for feature in layers.get("landuse", {}).get("features", []):
        if feature["properties"].get("kind") in FOREST_KINDS:
            shapes.append(shapely.geometry.shape(feature["geometry"]))
            standing.append(Standing("trees", None))
    return TileShapes(shapes, standing, shapely.STRtree(shapes))


def building_height(properties: dict) -> float | None:
    """A building's height as OpenStreetMap gives it (through Protomaps), if it does."""
    height = properties.get("height")
    return float(height) if isinstance(height, int | float) and height > 0 else None
