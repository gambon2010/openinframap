"""Fork: the points of interest the background map's zoom 15 tiles hold (Protomaps'
`pois` layer: every named shop, restaurant, office... from OpenStreetMap, most with
no floor written): those inside a building's outline, for the list of what's inside it
(indoor/__init__.py). The street's furniture is left out."""

from __future__ import annotations

import mapbox_vector_tile  # type: ignore[import-untyped]
from shapely.geometry import Point, shape
from shapely.geometry.base import BaseGeometry
from shapely.prepared import prep

from . import ARCHIVES, unzipped
from .buildings import FULL_ZOOM, to_degrees
from .mvt import keep

POIS_LAYER = "pois"
# Kinds that aren't what's inside a building: trees, benches, lamps, crossings...
STREET = {
    "tree",
    "bench",
    "street_lamp",
    "waste_basket",
    "bicycle_parking",
    "crossing",
    "tram_crossing",
    "tram_level_crossing",
    "level_crossing",
    "traffic_signals",
    "bollard",
    "address",
    "administrative",
}


def pois_in(outline: BaseGeometry, tiles: list[tuple[int, int]]) -> list[dict]:
    """The named points of interest inside an outline (degrees), from the tiles given:
    each one's name, kind ("restaurant") and place (lon, lat)."""
    inside = prep(outline)
    found = []
    for tx, ty in tiles:
        for feature in tile_pois(tx, ty):
            props = feature.get("properties", {})
            if not props.get("name") or props.get("kind") in STREET:
                continue
            point = to_degrees(shape(feature["geometry"]), tx, ty)
            if isinstance(point, Point) and inside.contains(point):
                found.append({"name": props["name"], "what": props.get("kind"), "at": [point.x, point.y]})
    return found


def tile_pois(x: int, y: int) -> list[dict]:
    """A zoom 15 tile's points of interest, in its own coordinates (y down)."""
    found = ARCHIVES.tile(FULL_ZOOM, x, y)
    if not found:
        return []
    layers = mapbox_vector_tile.decode(
        keep(unzipped(found[0]), {POIS_LAYER}), default_options={"y_coord_down": True}
    )
    return list(layers.get(POIS_LAYER, {}).get("features", []))
