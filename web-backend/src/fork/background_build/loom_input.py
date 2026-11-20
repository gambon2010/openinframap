"""Fork: an area's trams, metro and light rail as LOOM's input, a GeoJSON line graph
(scripts/offline_maps/transit.py runs LOOM on it; loom_tiles.py packs its tiles).

Each tram or metro way (sidings and depots left out) is an edge between its two end
nodes, with the lines running on it (OpenStreetMap's routes, transit_lines.py). A
line's id is its kind and letter ("tram:A"), so the map can tell trams from metro.

LOOM keeps a line only up to the stations it serves: past the last one, it trims
it away. So the routes' stops are stations, and so is every dead end of the tracks
(a route without its stops tagged would vanish otherwise).

One graph per network (tracks within NETWORK_GAP_M of each other: a city's trams,
its metro), each in a file of its own: LOOM takes seconds on a city and far longer
than a whole country's networks one by one on all of them at once.

    python -m src.fork.background_build.loom_input --area AREA [--folder DIR]
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any

import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely

from ..background import OFFLINE_MAPS_DIR
from .tiles import map_units
from .transit_lines import TRANSIT_KINDS, Line, in_order, line_of
from .zoomed_railways import mercator, source_of

# Tracks this close on the ground are one network (LOOM merges what runs side by
# side within 50 m: never split between two).
NETWORK_GAP_M = 60

# What a stop is tagged with in OpenStreetMap.
STOP_TAGS = (("railway", "tram_stop"), ("railway", "stop"), ("railway", "station"))
STOP_POSITION = ("public_transport", "stop_position")


def work_of(folder: Path, area: str) -> Path:
    """LOOM's working folder for an area (hidden: a step of the build): its inputs
    in-<n>.json, one per network; LOOM's outputs beside them (scripts' transit.py)."""
    return folder / f".{area}.loom"


def line_id(kind: str, ref: str) -> str:
    return f"{kind}:{ref}"


class _Reader(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        # Way id: its kind and points (lon, lat, node id).
        self.ways: dict[int, tuple[str, list[tuple[float, float, int]]]] = {}
        self.lines_on: dict[int, set[Line]] = {}
        self.stops: dict[int, tuple[float, float, str]] = {}

    def node(self, n) -> None:
        tags = {t.k: t.v for t in n.tags}
        stop_position = tags.get(STOP_POSITION[0]) == STOP_POSITION[1]
        is_stop = stop_position or any(tags.get(k) == v for k, v in STOP_TAGS)
        if is_stop and n.location.valid():
            self.stops[n.id] = (n.location.lon, n.location.lat, tags.get("name", ""))

    def way(self, w) -> None:
        kind = w.tags.get("railway")
        if kind not in TRANSIT_KINDS or w.tags.get("service") or len(w.nodes) < 2:
            return
        try:
            points = [(n.lon, n.lat, n.ref) for n in w.nodes]
        except osmium.InvalidLocationError:
            return  # a node outside the extract
        self.ways[w.id] = (kind, points)

    def relation(self, r) -> None:
        line = line_of({t.k: t.v for t in r.tags})
        if line is None:
            return
        for member in r.members:
            if member.type == "w":
                self.lines_on.setdefault(member.ref, set()).add(line)


def graphs(railways: Path) -> list[dict[str, Any]]:
    """The line graphs of a railways file's networks (zoomed_railways.source_of)."""
    reader = _Reader()
    reader.apply_file(str(railways), locations=True)
    with_lines = [way_id for way_id in reader.ways if reader.lines_on.get(way_id)]
    if not with_lines:
        return []
    areas = network_areas([reader.ways[way_id][1] for way_id in with_lines])
    tree = shapely.STRtree(areas)
    ways_in: list[list[int]] = [[] for _ in areas]
    for way_id in with_lines:
        lon, lat, _ = reader.ways[way_id][1][0]
        ways_in[network_at(tree, lon, lat) or 0].append(way_id)
    stops_in: list[list[int]] = [[] for _ in areas]
    for ref, (lon, lat, _) in reader.stops.items():
        network = network_at(tree, lon, lat)
        if network is not None:
            stops_in[network].append(ref)
    return [graph(reader, ways, stops) for ways, stops in zip(ways_in, stops_in)]


def network_at(areas: shapely.STRtree, lon: float, lat: float) -> int | None:
    """The network whose area a place is in (its index), None if in none."""
    found = areas.query(shapely.Point(mercator(np.array([[lon, lat]]))[0]), "intersects")
    return int(found[0]) if len(found) else None


def network_areas(ways: list[list[tuple[float, float, int]]]) -> np.ndarray:
    """Each network's area: its tracks widened by half NETWORK_GAP_M, merged where
    they touch."""
    lines = np.array([shapely.LineString(mercator(np.array(points)[:, :2])) for points in ways], dtype=object)
    _, south, _, north = shapely.total_bounds(lines)
    widened = shapely.buffer(lines, map_units(NETWORK_GAP_M / 2, (south + north) / 2))
    return shapely.get_parts(shapely.union_all(widened))


def graph(reader: _Reader, way_ids: list[int], stop_ids: list[int]) -> dict[str, Any]:
    """A network's line graph: its ways as edges, their end nodes (a dead end a
    station), its stops as stations."""
    edges = []
    ends: Counter[int] = Counter()
    nodes = {}
    for way_id in way_ids:
        kind, points = reader.ways[way_id]
        ends.update([points[0][2], points[-1][2]])
        for lon, lat, ref in (points[0], points[-1]):
            nodes[ref] = (lon, lat)
        edges.append(edge(way_id, kind, points, in_order(reader.lines_on[way_id])))
    used_nodes = [point(f"n{ref}", *nodes[ref], station=ends[ref] == 1) for ref in ends]
    stations = []
    for ref in stop_ids:
        lon, lat, name = reader.stops[ref]
        stations.append(point(f"s{ref}", lon, lat, station=True, label=name))
    return {"type": "FeatureCollection", "features": used_nodes + stations + edges}


def edge(way_id: int, kind: str, points: list, lines: tuple[Line, ...]) -> dict[str, Any]:
    """A way as an edge: between its end nodes, with its lines."""
    return {
        "type": "Feature",
        "geometry": {"type": "LineString", "coordinates": [[lon, lat] for lon, lat, _ in points]},
        "properties": {
            "id": f"w{way_id}",
            "from": f"n{points[0][2]}",
            "to": f"n{points[-1][2]}",
            "lines": [
                # The label too: LOOM's tiles carry the label, not the id.
                {"id": line_id(kind, ref), "label": line_id(kind, ref), "color": colour.lstrip("#")}
                for ref, colour in lines
            ],
        },
    }


def point(node_id: str, lon: float, lat: float, station: bool, label: str = "") -> dict[str, Any]:
    """A node; a station has a station id (LOOM keeps lines up to stations)."""
    props: dict[str, Any] = {"id": node_id}
    if station:
        props |= {"station_id": node_id, "station_label": label}
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": props}


def lines_in(collection: dict[str, Any]) -> set[str]:
    """The line ids on a line graph's edges (LOOM's input or output)."""
    return {
        line["id"]
        for feature in collection["features"]
        if feature["geometry"]["type"] == "LineString"
        for line in feature["properties"].get("lines", [])
    }


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="An area's trams and metro as LOOM's input.")
    parser.add_argument("--area", required=True)
    parser.add_argument("--folder", type=Path, default=OFFLINE_MAPS_DIR)
    args = parser.parse_args(argv)
    railways = source_of(args.folder / f"{args.area}.pmtiles")
    if not railways.exists():
        sys.exit(f"No railways file {railways.name}")
    networks = graphs(railways)
    work = work_of(args.folder, args.area)
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir()
    for n, collection in enumerate(networks):
        (work / f"in-{n}.json").write_text(json.dumps(collection))
    lines = set().union(*(lines_in(c) for c in networks))
    print(
        f"  {args.area}: {len(lines)} tram and metro lines in {len(networks)} networks for LOOM",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
