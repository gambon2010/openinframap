"""Fork: the roads zoomed out (zooms 8 to 13), copied down from a background map's
zoom 15 tiles into its companion (zoomed_out.py), as a layer named like the
background map's own, "roads": where the companion has it, the backend sends it
instead of the background map's (background/__init__.py).

Why: below zoom 15 Protomaps' tiles leave things out. Below zoom 12 a road is one
merged line without its tunnel mark (a tunnel can't be drawn dashed); most small
roads come only at zoom 14, paths too; some stretches of big roads only at 15 (their
min_zoom says 16). Copied from zoom 15, every feature keeps its properties, and shows
from the zoom `from_zoom` says.

At each zoom a road group (same properties) is joined into long lines, simplified to
about a pixel, then cut into the zoom's tiles.
"""

from __future__ import annotations

import gzip
from collections import defaultdict
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import shapely
from pmtiles.tile import zxy_to_tileid

from .tiles import BUFFER, EXTENT, PIXELS, in_tile_units, tile_bounds

LAYER = "roads"
ZOOMS = range(8, 14)
# The properties kept: what the map's road styles read at these zooms. No more, so
# a road's pieces join into one line (a bridge or another min_zoom would part them).
KEPT = ("kind", "kind_detail", "is_tunnel", "is_link")
# Small roads from zoom 12, paths and tracks from 13 (Protomaps: most from 14).
SMALL_ROADS_FROM = 12
PATHS_FROM = 13
# Big roads from these zooms at the latest, whatever their min_zoom (Protomaps gives
# a few stretches of motorway 16, so they'd only be in its zoom 15 tiles).
BIG_ROADS_BY = {"motorway": 8, "trunk": 8, "primary": 9, "secondary": 10, "tertiary": 11}

SNAP_DECIMALS = 2  # metres rounded to the centimetre before joining

# A group of roads: the zoom they show from, and their properties (KEPT).
Key = tuple[int, tuple[tuple[str, Any], ...]]


def from_zoom(props: dict[str, Any]) -> int:
    """The first zoom a road is in the companion's tiles (Protomaps puts a feature
    in the tiles from one zoom before its min_zoom)."""
    kind = props.get("kind")
    protomaps = int(props.get("min_zoom", ZOOMS[-1] + 1)) - 1
    if kind == "minor_road":
        return SMALL_ROADS_FROM
    if kind in ("path", "other") and props.get("kind_detail") != "pier":
        return PATHS_FROM
    if kind in ("highway", "major_road"):
        latest = BIG_ROADS_BY.get(str(props.get("kind_detail", "")).removesuffix("_link"), protomaps)
        return min(protomaps, latest)
    return protomaps


def used(feature: dict[str, Any]) -> bool:
    """A road shown at some zoom of the companion's."""
    return from_zoom(feature.get("properties", {})) <= ZOOMS[-1]


def collect(tile: dict[str, Any], bounds: tuple[float, float, float, float], groups: dict[Key, list]) -> None:
    """A decoded zoom 15 tile's roads (in metres), cut back to the tile itself (its
    buffer is its neighbours'), added to their group."""
    for feature in tile.get(LAYER, {}).get("features", []):
        if not used(feature):
            continue
        props = feature.get("properties", {})
        line = shapely.clip_by_rect(feature["geometry"], *bounds)
        if line.is_empty:
            continue
        kept = tuple((k, props[k]) for k in KEPT if k in props)
        groups[(from_zoom(props), kept)].append(line)


def joined(groups: dict[Key, list]) -> dict[Key, shapely.Geometry]:
    """Each group's pieces (cut at tile edges) joined into long lines."""
    out = {}
    for key, pieces in groups.items():
        lines = [g for g in shapely.get_parts(np.array(pieces, dtype=object)) if shapely.get_type_id(g) == 1]
        if lines:
            # Rounded to the centimetre: two pieces' shared end, computed from two
            # tiles, differs in the last digits, and only equal ends are joined.
            snapped = shapely.transform(
                shapely.multilinestrings(lines), lambda xy: np.round(xy, SNAP_DECIMALS)
            )
            out[key] = shapely.line_merge(snapped)
    return out


def simplified(roads: dict[Key, shapely.Geometry], z: int) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """The roads shown at a zoom, simplified to about a pixel there: single lines and
    their properties. Short ones too: a road's piece between two others (a junction,
    a bridge) left out would be a hole in it."""
    pixel = tile_size(z) / PIXELS
    lines, props = [], []
    for (shown_from, kept), geometry in roads.items():
        if shown_from > z:
            continue
        properties = dict(kept)
        for line in shapely.get_parts(shapely.simplify(geometry, pixel)):
            lines.append(line)
            props.append(properties)
    return np.array(lines, dtype=object), props


def tile_size(z: int) -> float:
    west, _, east, _ = tile_bounds(z, 0, 0)
    return east - west


def zoom_tiles(roads: dict[Key, shapely.Geometry], z: int, tiles=None) -> list[tuple[int, bytes]]:
    """A zoom's tiles (tile id, gzip) with the roads shown there; `tiles` the (x, y)
    to make, by default every one a road reaches."""
    lines, props = simplified(roads, z)
    if not len(lines):
        return []
    tree = shapely.STRtree(lines)
    out = []
    for x, y in tiles if tiles is not None else reached(lines, z):
        data = encode(lines, props, tree, z, x, y)
        if data:
            out.append((zxy_to_tileid(z, x, y), data))
    return out


def reached(lines: np.ndarray, z: int) -> list[tuple[int, int]]:
    """The tiles of a zoom that any of the lines reaches."""
    size = tile_size(z)
    half = size * 2**z / 2
    found = set()
    for west, south, east, north in shapely.bounds(lines):
        for x in range(int((west + half) // size), int((east + half) // size) + 1):
            for y in range(int((half - north) // size), int((half - south) // size) + 1):
                found.add((x, y))
    return sorted(found)


def encode(lines: np.ndarray, props: list, tree: shapely.STRtree, z: int, x: int, y: int) -> bytes | None:
    """One tile: the lines cut to it and its buffer, encoded and zipped."""
    bounds = tile_bounds(z, x, y)
    margin = BUFFER / EXTENT * (bounds[2] - bounds[0])
    rect = (bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
    found = tree.query(shapely.box(*rect))
    if not len(found):
        return None
    cut = shapely.clip_by_rect(lines[found], *rect)
    in_units = in_tile_units(cut, bounds)
    features = [
        {"geometry": line, "properties": props[i]}
        for i, line in zip(found, in_units)
        if not line.is_empty and shapely.get_type_id(line) in (1, 5)
    ]
    if not features:
        return None
    data = mapbox_vector_tile.encode(
        [{"name": LAYER, "features": features}], default_options={"extents": EXTENT}
    )
    return gzip.compress(data, compresslevel=6, mtime=0)


def merge_into(groups: dict[Key, list], more: dict[Key, shapely.Geometry]) -> None:
    for key, geometry in more.items():
        groups[key].append(geometry)


def coarse(roads: dict[Key, shapely.Geometry], below: int) -> dict[Key, shapely.Geometry]:
    """The roads shown before zoom `below`, simplified for it: what a zoom 10 block
    hands back for the zoomed out tiles made at the end (zooms 8 and 9)."""
    pixel = tile_size(below - 1) / PIXELS
    return {
        key: shapely.simplify(geometry, pixel)
        for key, geometry in roads.items()
        if key[0] < below
    }


def new_groups() -> dict[Key, list]:
    return defaultdict(list)
