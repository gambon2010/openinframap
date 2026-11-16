"""Fork: the buildings zoomed out (zooms 12 to 14), from a background map's zoom 15
tiles, for its companion (zoomed_out.py), layer LAYER.

Protomaps' tiles hold every building only at zoom 15: below, its tile build merges
neighbouring buildings into blocks and keeps the big blocks (the background map's
pale city texture). The companion has the buildings big enough to see at each zoom
(MIN_AREA_M2). A zoom 12 block at a time (its 64 zoom 15 tiles): a building cut at
tile edges comes in pieces, joined by its id, then measured; from one list of
buildings come the block's zoom 12, 13 and 14 tiles.
"""

from __future__ import annotations

import gzip
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
from pmtiles.tile import zxy_to_tileid
from shapely import unary_union
from shapely.geometry import box
from shapely.geometry.base import BaseGeometry

from .tiles import BUFFER, EXTENT, PIXELS, children, ground_stretch, in_tile_units, tile_bounds

LAYER = "buildings_large"
SOURCE_LAYER = "buildings"  # the background map's
FULL_ZOOM = 15
BLOCK_ZOOM = 12
# The smallest building shown at each zoom: about 4 pixels across there.
MIN_AREA_M2 = {12: 10_000, 13: 2_500, 14: 600}
ZOOMS = tuple(MIN_AREA_M2)


def used(feature: dict[str, Any]) -> bool:
    """A whole building (not a part), with an id to join its pieces by."""
    return feature.get("properties", {}).get("kind") == "building" and feature.get("id") is not None


def block_buildings(tiles: dict[tuple[int, int], dict[str, Any]], bx: int, by: int) -> list[dict[str, Any]]:
    """The buildings of a zoom 12 block, whole (their pieces joined), in web Mercator,
    with their area on the ground: those big enough to show at some zoom. `tiles`:
    the block's zoom 15 tiles, decoded in metres, by (x, y)."""
    pieces: dict[int, list[BaseGeometry]] = {}
    heights: dict[int, float] = {}
    for x, y in children(BLOCK_ZOOM, bx, by, FULL_ZOOM):
        for f in tiles.get((x, y), {}).get(SOURCE_LAYER, {}).get("features", []):
            props = f.get("properties", {})
            if not used(f):
                continue
            geom = f["geometry"]
            if geom.is_empty:
                continue
            pieces.setdefault(int(f["id"]), []).append(geom if geom.is_valid else geom.buffer(0))
            if isinstance(props.get("height"), (int, float)):
                heights[int(f["id"])] = float(props["height"])
    stretch = ground_stretch(BLOCK_ZOOM, by) ** 2
    smallest = min(MIN_AREA_M2.values())
    found = []
    for building_id, parts in pieces.items():
        geom = parts[0] if len(parts) == 1 else unary_union(parts)
        area = geom.area * stretch
        if area >= smallest and geom.geom_type in ("Polygon", "MultiPolygon"):
            found.append({"id": building_id, "geom": geom, "area": area, "height": heights.get(building_id)})
    return found


def block_tiles(buildings: list[dict[str, Any]], bx: int, by: int) -> list[tuple[int, bytes]]:
    """The block's tiles at zooms 12 to 14 (tile id, gzip), each with the buildings
    big enough for its zoom, simplified to about a pixel, cut to the tile and its
    buffer. Tiles with none are left out."""
    out = []
    for z in ZOOMS:
        n = 1 << (z - BLOCK_ZOOM)
        big = [b for b in buildings if b["area"] >= MIN_AREA_M2[z]]
        if not big:
            continue
        for x in range(bx * n, (bx + 1) * n):
            for y in range(by * n, (by + 1) * n):
                bounds = tile_bounds(z, x, y)
                size = bounds[2] - bounds[0]
                margin = BUFFER / EXTENT * size
                clip = box(bounds[0] - margin, bounds[1] - margin, bounds[2] + margin, bounds[3] + margin)
                pixel = size / PIXELS
                features = []
                for b in big:
                    if not b["geom"].intersects(clip):
                        continue
                    geom = b["geom"].simplify(pixel, preserve_topology=True).intersection(clip)
                    if geom.is_empty or geom.geom_type not in ("Polygon", "MultiPolygon"):
                        geom = polygons_only(geom)
                        if geom is None:
                            continue
                    props: dict[str, Any] = {"kind": "building", "area_m2": round(b["area"])}
                    if b["height"] is not None:
                        props["height"] = b["height"]
                    features.append({"id": b["id"], "geometry": geom, "properties": props})
                if features:
                    moved = in_tile_units([f["geometry"] for f in features], bounds)
                    for feature, geometry in zip(features, moved):
                        feature["geometry"] = geometry
                    data = mapbox_vector_tile.encode(
                        [{"name": LAYER, "features": features}], default_options={"extents": EXTENT}
                    )
                    out.append((zxy_to_tileid(z, x, y), gzip.compress(data, compresslevel=6, mtime=0)))
    return out


def polygons_only(geom: BaseGeometry) -> BaseGeometry | None:
    """The areas of what cutting left (it can add lines or points along the cut)."""
    areas = [g for g in getattr(geom, "geoms", []) if g.geom_type in ("Polygon", "MultiPolygon")]
    return unary_union(areas) if areas else None
