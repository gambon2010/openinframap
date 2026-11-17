"""Fork: airports' stand lead-ins left out of the background map's roads.

Some airports' stand lead-in lines are mapped in OpenStreetMap as taxiways
(`aeroway=taxiway`, where `aeroway=taxilane` is meant: Entzheim since August 2025),
so the background map draws them as taxiways: a tangle of hooks over the aprons. The
build leaves them out (zoomed_out.py): at zooms 8 to 13 from the roads it makes, at
14 and 15 a cleaned roads layer for the tiles they're in.

A stand lead-in is a run of taxiways (ways joined end to end) tagged only
`aeroway=taxiway` (no name, ref, width or disused), shorter than SHORTER_THAN_M, with
an end that meets no other taxiway or runway (it ends at a stand). A named taxiway,
a corner joining two taxiways and a long apron lane stay. Checked at Entzheim against
upstream's map (openinframap.org, before the lead-ins were mapped): 94 of the 105
pieces it lacks go (left: the apron lane's new stretches, a lead-in looping back to
the lane, taxiway M's new end), nothing it has.
Read from <area>.taxiways.osm.pbf (the scripts' taxiways.py); no file, nothing left
out.
"""

from __future__ import annotations

from collections import Counter
from pathlib import Path
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely
from pmtiles.tile import zxy_to_tileid

from . import mvt, unzipped
from .tiles import HALF, map_units, tile_bounds, zipped
from .zoomed_railways import mercator

# <area>.taxiways.osm.pbf (the scripts' taxiways.py, scripts/tests/test_one_source.py).
TAXIWAYS = ".taxiways.osm.pbf"
SHORTER_THAN_M = 150
# Tags that make a taxiway one the map keeps.
KEPT_IF_TAGGED = ("name", "ref", "width", "disused")
# How far the background map's line may be from OpenStreetMap's (simplified at zoom 15).
NEAR_M = 2
# A piece of a background map's line this much inside a lead-in is the lead-in.
INSIDE = 0.9
REWRITTEN_ZOOMS = (14, 15)
ROADS = "roads"

# A point of a way, rounded: ways joined at a node share it.
Point = tuple[float, float]


def source_of(background_map: Path) -> Path:
    """<area>.taxiways.osm.pbf beside <area>.pmtiles."""
    return background_map.with_name(f"{background_map.stem}{TAXIWAYS}")


class _Reader(osmium.SimpleHandler):
    """How many taxiways and runways each point is on; the untagged taxiways'
    lines."""

    def __init__(self) -> None:
        super().__init__()
        self.uses: Counter[Point] = Counter()
        self.untagged: list[list[Point]] = []

    def way(self, w) -> None:
        try:
            points = [(round(n.lon, 7), round(n.lat, 7)) for n in w.nodes]
        except osmium.InvalidLocationError:
            return  # a node outside the extract
        self.uses.update(set(points))
        tagged = any(w.tags.get(key) for key in KEPT_IF_TAGGED)
        if w.tags.get("aeroway") == "taxiway" and not tagged and len(points) > 1:
            self.untagged.append(points)


def lead_ins(taxiways: Path) -> shapely.Geometry:
    """Where the stand lead-ins are, in web Mercator metres (widened by NEAR_M); empty
    without a taxiways file."""
    if not taxiways.exists():
        return shapely.Polygon()
    reader = _Reader()
    reader.apply_file(str(taxiways), locations=True)
    if not reader.untagged:
        return shapely.Polygon()
    runs = shapely.get_parts(shapely.line_merge(shapely.MultiLineString(reader.untagged)))
    found = [run for run in runs if is_lead_in(run, reader.uses)]
    if not found:
        return shapely.Polygon()
    in_metres = [shapely.LineString(mercator(np.array(run.coords))) for run in found]
    _, south, _, north = shapely.total_bounds(np.array(in_metres, dtype=object))
    return shapely.union_all(shapely.buffer(in_metres, map_units(NEAR_M, (south + north) / 2)))


def is_lead_in(run: shapely.LineString, uses: Counter[Point]) -> bool:
    """A run (degrees) short enough, with an end no other way meets."""
    ends = (run.coords[0], run.coords[-1])
    loose_end = any(uses[(round(x, 7), round(y, 7))] == 1 for x, y in ends)
    return loose_end and ground_length(run) < SHORTER_THAN_M


def ground_length(run: shapely.LineString) -> float:
    """A line's length (degrees) on the ground, in metres."""
    in_metres = mercator(np.array(run.coords))
    along = float(np.sum(np.hypot(*np.diff(in_metres, axis=0).T)))
    return along / map_units(1, float(in_metres[:, 1].mean()))


def is_taxiway(props: dict[str, Any]) -> bool:
    return props.get("kind") == "aeroway" and props.get("kind_detail") == "taxiway"


def without(line: shapely.Geometry, area: shapely.Geometry) -> shapely.Geometry:
    """A background map's taxiway line without its pieces that are lead-ins (a piece
    runs from junction to junction: the lane a lead-in leaves from stays whole)."""
    pieces = shapely.get_parts(shapely.line_merge(line))
    kept = [p for p in pieces if p.length == 0 or shapely.intersection(p, area).length / p.length < INSIDE]
    return shapely.multilinestrings(kept) if kept else shapely.MultiLineString()


def cleaned(tile: dict[str, Any] | None, area: shapely.Geometry) -> dict[str, Any] | None:
    """A decoded zoom 15 tile (zoomed_out.decoded: metres) without lead-ins."""
    if tile is None or shapely.is_empty(area):
        return tile
    for feature in tile.get(ROADS, {}).get("features", []):
        if is_taxiway(feature.get("properties", {})):
            feature["geometry"] = without(feature["geometry"], area)
    return tile


def rewritten_tiles(read, area: shapely.Geometry) -> list[tuple[int, bytes]]:
    """The roads layers of the zoom 14 and 15 tiles with lead-ins, without them (the
    companion's replace the background map's). `read(z, x, y)`: a tile's bytes."""
    out = []
    for z in REWRITTEN_ZOOMS:
        for x, y in tiles_over(area, z):
            data = read(z, x, y)
            layer = without_in_tile(data, z, x, y, area) if data else None
            if layer:
                out.append((zxy_to_tileid(z, x, y), layer))
    return out


def tiles_over(area: shapely.Geometry, z: int) -> list[tuple[int, int]]:
    """The tiles at a zoom any lead-in is in."""
    if shapely.is_empty(area):
        return []  # its bounds would be NaN
    size = 2 * HALF / 2**z
    found: set[tuple[int, int]] = set()
    for west, south, east, north in shapely.bounds(shapely.get_parts(area)):
        columns = range(int((west + HALF) // size), int((east + HALF) // size) + 1)
        rows = range(int((HALF - north) // size), int((HALF - south) // size) + 1)
        found.update((x, y) for x in columns for y in rows)
    return sorted(found)


def without_in_tile(data: bytes, z: int, x: int, y: int, area: shapely.Geometry) -> bytes | None:
    """A tile's roads layer without lead-ins (zipped), None if it had none."""
    tile = mapbox_vector_tile.decode(
        mvt.keep(unzipped(data), {ROADS}), default_options={"y_coord_down": True}
    )
    layer = tile.get(ROADS)
    if not layer:
        return None
    west, _, east, north = tile_bounds(z, x, y)
    scale = (east - west) / layer["extent"]
    in_tile = shapely.transform(area, lambda xy: (xy - [west, north]) / [scale, -scale])
    changed = False
    for feature in layer["features"]:
        feature["geometry"] = shapely.geometry.shape(feature["geometry"])
    for feature in layer["features"]:
        if not is_taxiway(feature["properties"]):
            continue
        line = feature["geometry"]
        kept = without(line, in_tile)
        if not shapely.equals(kept, shapely.line_merge(line)):
            changed = True
            feature["geometry"] = kept
    if not changed:
        return None
    features = [f for f in layer["features"] if not shapely.is_empty(f["geometry"])]
    encoded = mapbox_vector_tile.encode(
        [{"name": ROADS, "features": features}],
        default_options={"extents": layer["extent"], "y_coord_down": True},
    )
    return zipped(encoded)
