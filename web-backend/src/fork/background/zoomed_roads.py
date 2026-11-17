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

from collections import defaultdict
from typing import Any

import numpy as np
import shapely

from .close_lines import one_line_where_close
from .tiles import PIXELS, TileLayer, layer_tiles, tile_size

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

# Carriageways closer than this many pixels drawn as one (close_lines.py).
CLOSE_PIXELS = 3
BIG_KINDS = ("highway", "major_road")  # in the order they're kept
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


def zoom_tiles(roads: dict[Key, shapely.Geometry], z: int, tiles=None) -> list[tuple[int, bytes]]:
    """A zoom's tiles (tile id, gzip) with the roads shown there; `tiles` the (x, y)
    to make, by default every one a road reaches."""
    lines, props = simplified(roads, z)
    lines, props = one_line_for_carriageways(lines, props, CLOSE_PIXELS * tile_size(z) / PIXELS)
    return layer_tiles(TileLayer(LAYER, lines, props), z, tiles)


def one_line_for_carriageways(lines: np.ndarray, props: list, distance: float) -> tuple[np.ndarray, list]:
    """A motorway's (or main road's) two carriageways drawn as one line where they
    run side by side, their tunnels too: motorways kept before main roads, before
    slip roads, then the longer line. Smaller roads are left as they are."""
    big = [i for i, p in enumerate(props) if p.get("kind") in BIG_KINDS]
    others = [i for i in range(len(props)) if props[i].get("kind") not in BIG_KINDS]
    lengths = shapely.length(lines[big])
    priority = [
        (BIG_KINDS.index(props[i]["kind"]), bool(props[i].get("is_link")), -length)
        for i, length in zip(big, lengths)
    ]
    kept_lines, kept_props = one_line_where_close(lines[big], [props[i] for i in big], priority, distance)
    all_lines = np.concatenate([lines[others], kept_lines]) if len(kept_lines) else lines[others]
    return all_lines, [props[i] for i in others] + kept_props


def merge_into(groups: dict[Key, list], more: dict[Key, shapely.Geometry]) -> None:
    for key, geometry in more.items():
        groups[key].append(geometry)


def coarse(roads: dict[Key, shapely.Geometry], below: int) -> dict[Key, shapely.Geometry]:
    """The roads shown before zoom `below`, simplified for it: what a zoom 10 block
    hands back for the zoomed out tiles made at the end (zooms 8 and 9)."""
    pixel = tile_size(below - 1) / PIXELS
    return {key: shapely.simplify(geometry, pixel) for key, geometry in roads.items() if key[0] < below}


def new_groups() -> dict[Key, list]:
    return defaultdict(list)
