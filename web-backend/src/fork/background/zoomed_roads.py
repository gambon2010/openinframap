"""Fork: the roads zoomed out (zooms 8 to 13), copied down from a background map's
zoom 15 tiles into its companion (zoomed_out.py), as a layer named like the
background map's own, "roads": where the companion has it, the backend sends it
instead of the background map's (background/__init__.py).

Why: below zoom 15 Protomaps' tiles leave things out. Below zoom 12 a road is one
merged line without its tunnel mark (a tunnel can't be drawn dashed); most small
roads come only at zoom 14, paths too; some stretches of big roads only at 15 (their
min_zoom says 16). Copied from zoom 15, every feature keeps its properties, and shows
from the zoom `from_zoom` says.

At each zoom a road group (same properties) is drawn as Planetiler draws roads
zoomed out (it makes the background map; its LoopLineMerger, see
oliverwipfli.ch/improving-linestring-merging-in-planetiler-2024-10-30): simplified to
about a pixel, snapped to a grid of a sixteenth of one so ends that meet there are
one point, joined end to end, what's shorter than a quarter of a pixel left out
(specks, and a roundabout shrunk to a tiny ring; Planetiler also cuts small loops
made of several lines, rare at these sizes). A dual carriageway stays two lines:
zoomed out they overlap as one road (merging them is a known hard problem, no
method keeping junctions right). Then cut into the zoom's tiles.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Any

import numpy as np
import shapely

from .tiles import PIXELS, TileLayer, layer_tiles, tile_size

LAYER = "roads"
ZOOMS = range(8, 14)
# The properties kept: what the map's road styles read at these zooms. No more, so
# a road's pieces join into one line (a bridge or another min_zoom would part them).
KEPT = ("kind", "kind_detail", "is_tunnel", "is_link")
# Small roads from zoom 12, paths and tracks from 13 (Protomaps: most from 14).
SMALL_ROADS_FROM = 12
PATHS_FROM = 13
# Big roads: the earliest and the latest zoom each shows from, whatever Protomaps'
# min_zoom says. It gives a few stretches of motorway 16 (they'd only be in its zoom
# 15 tiles), and brings many secondary and tertiary roads in at 9 (zoomed out, a web
# of them). 0: no earliest.
BIG_ROAD_ZOOMS = {
    "motorway": (0, 8),
    "trunk": (0, 8),
    "primary": (0, 9),
    "secondary": (10, 10),
    "tertiary": (11, 11),
}

# Zoomed out, each zoom's lines snapped to a grid of this many points a pixel, and
# what's shorter than this many pixels left out (Planetiler's).
SNAP_PER_PIXEL = 16
SMALLEST_PIXELS = 0.25
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
        detail = str(props.get("kind_detail", "")).removesuffix("_link")
        earliest, latest = BIG_ROAD_ZOOMS.get(detail, (0, protomaps))
        return min(max(protomaps, earliest), latest)
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
    """The roads shown at a zoom, drawn for it (drawn_at): single lines and their
    properties."""
    pixel = tile_size(z) / PIXELS
    lines, props = [], []
    for (shown_from, kept), geometry in roads.items():
        if shown_from > z:
            continue
        drawn = drawn_at(geometry, pixel)
        lines += drawn
        props += [dict(kept)] * len(drawn)
    return np.array(lines, dtype=object), props


def drawn_at(geometry: shapely.Geometry, pixel: float) -> list:
    """A road group's lines for a zoom (`pixel`: its pixel's size): simplified to a
    pixel, snapped to a sixteenth of one, joined end to end, without what's
    shorter than a quarter of a pixel."""
    grid = pixel / SNAP_PER_PIXEL
    snapped = shapely.transform(shapely.simplify(geometry, pixel), lambda xy: np.round(xy / grid) * grid)
    parts = shapely.get_parts(snapped)
    joined = shapely.get_parts(shapely.line_merge(shapely.multilinestrings(parts)))
    return [
        line
        for line in joined
        if shapely.get_type_id(line) == 1 and shapely.length(line) >= SMALLEST_PIXELS * pixel
    ]


def zoom_tiles(
    roads: dict[Key, shapely.Geometry], z: int, tiles=None, beyond: tuple[list, list] = ([], [])
) -> list[tuple[int, bytes]]:
    """A zoom's tiles (tile id, gzip) with the roads shown there and `beyond` (lines,
    properties: the background map's own past the area, beyond_area.py); `tiles` the
    (x, y) to make, by default every one a road reaches."""
    lines, props = simplified(roads, z)
    if beyond[0]:
        lines = np.concatenate([lines, np.array(beyond[0], dtype=object)])
        props = props + beyond[1]
    return layer_tiles(TileLayer(LAYER, lines, props), z, tiles)


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
