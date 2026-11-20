"""Fork: LOOM's tiles of an area's trams and metro (scripts/offline_maps/transit.py
runs LOOM on loom_input.py's graph) packed into <area>.transit.pmtiles, served at
/background/transit (transit.py).

LOOM draws each line in its lane, side by side where lines share a track, joined
through junctions (its layers "lines" and "inner-connections", their offsets
written into the geometry, one set of tiles per zoom). Kept here: the lines and
the joins, each piece with its line ("tram:A": `kind` and `ref`), its colour, and
`tunnel` where it runs underground (LOOM doesn't say: the tunnel tracks of the
railways file, widened, cut each piece; widened as far as LOOM spreads a bundle of
lanes at each zoom, or the outer lanes would come out above ground). Beside them
the lines' stops (line_stops.py), shown when a line is highlighted.

    python -m src.fork.background_build.loom_tiles --area AREA [--folder DIR]
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import mapbox_vector_tile  # type: ignore[import-untyped]
import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely
from pmtiles.tile import Compression, TileType, zxy_to_tileid
from pmtiles.writer import Writer

from ..paths import OFFLINE_MAPS_DIR
from .line_stops import STOPS_LAYER, StopIndex, stops
from .loom_input import lines_in, work_of
from .tiles import EXTENT, HALF, in_tile_units, map_units, tile_bounds, zipped
from ..background.transit import TRANSIT
from .transit_lines import TRANSIT_KINDS
from .zoomed_railways import mercator, source_of

LAYERS = ("lines", "inner-connections")
ZOOMS = range(12, 19)
# A tunnel track widened by this much on the ground (a track's own spread)...
TUNNEL_REACH_M = 15
# ...and by as far as LOOM spreads a bundle of lanes to one side, in its pixels (256
# to a tile; scripts/offline_maps/transit.py: a lane 1.5 of them, five lanes 7.5).
BUNDLE_HALF_PX = 4
LOOM_TILE_PX = 256


def transit_of(folder: Path, area: str) -> Path:
    return folder / f"{area}{TRANSIT}"


@dataclass
class Around:
    """What the railways file adds to LOOM's tiles: where the lines run underground
    at each zoom (web Mercator metres), and their stops."""

    underground: dict[int, shapely.Geometry]
    stops: StopIndex


class _Tunnels(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[shapely.Geometry] = []

    def way(self, w) -> None:
        if w.tags.get("railway") not in TRANSIT_KINDS or w.tags.get("tunnel") in (None, "no"):
            return
        try:
            lon_lat = np.array([(n.lon, n.lat) for n in w.nodes])
        except osmium.InvalidLocationError:
            return  # a node outside the extract
        if len(lon_lat) > 1:
            self.lines.append(shapely.LineString(mercator(lon_lat)))


def tunnels(railways: Path) -> dict[int, shapely.Geometry]:
    """Where the trams and metro run underground at each zoom of ZOOMS, in web
    Mercator metres: the tunnel tracks widened by TUNNEL_REACH_M and a bundle's
    spread there."""
    reader = _Tunnels()
    reader.apply_file(str(railways), locations=True)
    if not reader.lines:
        return {z: shapely.Polygon() for z in ZOOMS}
    lines = np.array(reader.lines, dtype=object)
    _, south, _, north = shapely.total_bounds(lines)
    on_the_ground = map_units(TUNNEL_REACH_M, (south + north) / 2)
    return {z: shapely.union_all(shapely.buffer(lines, on_the_ground + bundle_spread(z))) for z in ZOOMS}


def bundle_spread(z: int) -> float:
    """How far LOOM spreads a bundle of lanes to one side at a zoom (web Mercator
    metres)."""
    return BUNDLE_HALF_PX * 2 * HALF / (LOOM_TILE_PX * 2**z)


def tile_paths(work: Path) -> dict[tuple[int, int, int], list[Path]]:
    """LOOM's tiles at the zooms kept, by tile (z, x, y): each network's own
    (tiles-<n>/z/x/y.mvt), several where networks share a tile."""
    found: dict[tuple[int, int, int], list[Path]] = {}
    for path in work.glob("tiles-*/*/*/*.mvt"):
        z, x, y = int(path.parent.parent.name), int(path.parent.name), int(path.stem)
        if z in ZOOMS:
            found.setdefault((z, x, y), []).append(path)
    return found


def repacked(files: list[Path], z: int, x: int, y: int, around: Around) -> bytes | None:
    """A tile from LOOM's tiles of it (one per network there): their lines and joins
    only, their properties ours, cut where they go underground, and the stops there;
    None if no lines."""
    bounds = tile_bounds(z, x, y)
    features: dict[str, list] = {name: [] for name in LAYERS}
    for path in files:
        tile = mapbox_vector_tile.decode(path.read_bytes(), default_options={"y_coord_down": True})
        for name in LAYERS:
            layer = tile.get(name)
            for feature in layer["features"] if layer else []:
                features[name] += pieces(feature, layer["extent"], bounds, around.underground[z])
    layers = [{"name": name, "features": found} for name, found in features.items() if found]
    if not layers:
        return None
    stops_here = around.stops.layer(bounds)
    if stops_here:
        layers.append(stops_here)
    return zipped(mapbox_vector_tile.encode(layers, default_options={"extents": EXTENT}))


def pieces(feature: dict[str, Any], extent: int, bounds: tuple, underground: shapely.Geometry) -> list[dict]:
    """A LOOM line or join with our properties, in tile units: above ground and in a
    tunnel, a piece each."""
    west, _, east, north = bounds
    scale = (east - west) / extent
    in_units = shapely.geometry.shape(feature["geometry"])
    in_metres = shapely.transform(in_units, lambda xy: xy * [scale, -scale] + [west, north])
    kind, _, ref = str(feature["properties"].get("line", "")).partition(":")
    props = {"kind": kind, "ref": ref, "colour": "#" + str(feature["properties"].get("line-color", "888888"))}
    above = shapely.difference(in_metres, underground)
    below = shapely.intersection(in_metres, underground)
    out = []
    if not shapely.is_empty(above):
        out.append({"geometry": in_tile_units(above, bounds), "properties": props})
    if not shapely.is_empty(below):
        out.append({"geometry": in_tile_units(below, bounds), "properties": props | {"tunnel": True}})
    return out


def write(path: Path, tiles: list[tuple[int, bytes]], area: str) -> None:
    """The tiles, in tile id order, as a PMTiles file covering the world (the backend
    asks for each tile)."""
    with path.open("wb") as f:
        writer = Writer(f)
        for tile_id, data in tiles:
            writer.write_tile(tile_id, data)
        writer.finalize(
            {
                "tile_type": TileType.MVT,
                "tile_compression": Compression.GZIP,
                "min_zoom": ZOOMS[0],
                "max_zoom": ZOOMS[-1],
                "min_lon_e7": -1800000000,
                "min_lat_e7": -850000000,
                "max_lon_e7": 1800000000,
                "max_lat_e7": 850000000,
                "center_zoom": ZOOMS[0],
                "center_lon_e7": 0,
                "center_lat_e7": 0,
            },
            {
                "name": f"{area} trams and metro",
                "vector_layers": [
                    {
                        "id": name,
                        "fields": {
                            "kind": "String",
                            "ref": "String",
                            "colour": "String",
                            "tunnel": "Boolean",
                        },
                    }
                    for name in LAYERS
                ]
                + [{"id": STOPS_LAYER, "fields": {"name": "String", "lines": "String"}}],
            },
        )


def lost_lines(work: Path) -> set[str]:
    """The lines LOOM was given (in-<n>.json) but didn't draw (out-<n>.json)."""
    given: set[str] = set()
    drawn: set[str] = set()
    for path in work.glob("in-*.json"):
        given |= lines_in(json.loads(path.read_text()))
    for path in work.glob("out-*.json"):
        drawn |= lines_in(json.loads(path.read_text()))
    return given - drawn


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="LOOM's tiles packed into <area>.transit.pmtiles.")
    parser.add_argument("--area", required=True)
    parser.add_argument("--folder", type=Path, default=OFFLINE_MAPS_DIR)
    args = parser.parse_args(argv)
    railways = source_of(args.folder / f"{args.area}.pmtiles")
    around = Around(tunnels(railways), StopIndex(stops(railways)))
    work = work_of(args.folder, args.area)
    tiles = []
    for (z, x, y), files in sorted(tile_paths(work).items(), key=lambda t: zxy_to_tileid(*t[0])):
        data = repacked(files, z, x, y, around)
        if data:
            tiles.append((zxy_to_tileid(z, x, y), data))
    out = transit_of(args.folder, args.area)
    partial = out.with_name(f".{out.name}.part")
    write(partial, tiles, args.area)
    partial.replace(out)
    lost = ", ".join(sorted(lost_lines(work))) or "none"
    print(f"  {args.area}: {len(tiles):,} tram and metro tiles; lines not drawn: {lost}", file=sys.stderr)


if __name__ == "__main__":
    main()
