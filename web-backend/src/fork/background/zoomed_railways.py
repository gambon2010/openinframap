"""Fork: the railways (zooms 6 to 15), for a background map's companion
(zoomed_out.py), layer LAYER, from <area>.railways.osm.pbf: the area's railway lines
cut out of its OpenStreetMap extract (scripts/offline_maps/extract.py).

The background map has railways only from zoom 11, all alike. OpenStreetMap says
more, which decides how a line is drawn (its rank) and from which zoom:

    main     high-speed, or usage=main            from zoom 6 (drawn like motorways)
    branch   usage=branch, or a plain line        from zoom 8 (like main roads)
    minor    industrial, tourist, tram, subway... from zoom 11
    service  sidings, yards, spurs, crossovers    from zoom 14

Each track of a double-track line is a line of its own: drawn side by side, their
white dashes fall out of step and the pair looks white. So up to zoom 14 a track
running close to one before it (a more important rank, or a longer line of the same)
is left out there: one line shows until they part. At zoom 15 every track shows.
Trams, metro and light rail (transit_lines.py) are one line at every zoom, apart
from the railways (a tram beside a railway stays), split into their lines from zoom
LINES_FROM.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely

from .close_lines import one_line_where_close
from .transit_lines import LINES_FROM, Line, in_order, is_transit, line_of, strands, without_lines
from .tiles import HALF, PIXELS, TileLayer, layer_tiles, tile_size

LAYER = "railways"
ZOOMS = range(6, 16)
KINDS = {"rail", "light_rail", "narrow_gauge", "subway", "tram", "funicular", "monorail", "preserved"}
RANKS = ("main", "branch", "minor", "service")  # the order lines give way in
FROM_ZOOM = {"main": 6, "branch": 8, "minor": 11, "service": 14}
# Close tracks drawn as one up to this zoom, closer than this many pixels.
ONE_LINE_UNTIL = 14
CLOSE_PIXELS = 3
# The tags kept as properties (what the map's styles and details read).
KEPT = ("name", "ref", "usage", "service")


def rank(tags: dict[str, str]) -> str:
    if tags.get("service"):
        return "service"
    if tags.get("highspeed") == "yes" or tags.get("usage") == "main":
        return "main"
    if tags.get("usage") == "branch" or (tags.get("railway") == "rail" and not tags.get("usage")):
        return "branch"
    return "minor"


def mercator(lon_lat: np.ndarray) -> np.ndarray:
    """Degrees to web Mercator metres."""
    lon, lat = lon_lat[:, 0], np.clip(lon_lat[:, 1], -85.0511, 85.0511)
    x = lon * HALF / 180
    y = np.log(np.tan((90 + lat) * math.pi / 360)) * HALF / math.pi
    return np.column_stack([x, y])


class _Reader(osmium.SimpleHandler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[shapely.Geometry] = []
        self.props: list[dict[str, Any]] = []
        self.way_ids: list[int] = []
        # The tram and metro lines on each way, by way id.
        self.lines_on: dict[int, set[Line]] = {}

    def relation(self, r) -> None:
        line = line_of({t.k: t.v for t in r.tags})
        if line is None:
            return
        for member in r.members:
            if member.type == "w":
                self.lines_on.setdefault(member.ref, set()).add(line)

    def way(self, w) -> None:
        tags = {t.k: t.v for t in w.tags}
        if tags.get("railway") not in KINDS or len(w.nodes) < 2:
            return
        try:
            lon_lat = np.array([(n.lon, n.lat) for n in w.nodes])
        except osmium.InvalidLocationError:
            return  # a node outside the extract
        props: dict[str, Any] = {"kind": tags["railway"], "rank": rank(tags)}
        props |= {k: tags[k] for k in KEPT if tags.get(k)}
        if tags.get("tunnel") not in (None, "no"):
            props["tunnel"] = True
        self.lines.append(shapely.LineString(mercator(lon_lat)))
        self.props.append(props)
        self.way_ids.append(w.id)

    def with_transit_lines(self) -> list[dict[str, Any]]:
        """Each tram, metro or light rail way's properties with the lines on it
        (read once the whole file is: the routes come after the ways)."""
        out = []
        for way_id, props in zip(self.way_ids, self.props):
            on_it = self.lines_on.get(way_id)
            if on_it and is_transit(props):
                props = props | {"lines": in_order(on_it)}
            out.append(props)
        return out


def read(path: Path) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """The railway lines of a file (in metres), and their properties."""
    reader = _Reader()
    reader.apply_file(str(path), locations=True)
    return joined(reader.lines, reader.with_transit_lines())


def joined(lines: list[shapely.Geometry], props: list[dict[str, Any]]) -> tuple[np.ndarray, list]:
    """Lines with the same properties joined end to end: a railway is many short
    ways in OpenStreetMap, and fewer, longer lines make lighter tiles and let the
    longer of two close lines be kept."""
    groups: dict[tuple, list[shapely.Geometry]] = {}
    for line, p in zip(lines, props):
        groups.setdefault(tuple(sorted(p.items())), []).append(line)
    out_lines: list[shapely.Geometry] = []
    out_props: list[dict[str, Any]] = []
    for key, group in groups.items():
        merged = shapely.get_parts(shapely.line_merge(shapely.multilinestrings(group)))
        out_lines += list(merged)
        out_props += [dict(key)] * len(merged)
    return np.array(out_lines, dtype=object), out_props


def shown(lines: np.ndarray, props: list, z: int) -> tuple[np.ndarray, list]:
    """The lines shown at a zoom (their rank's first zoom), simplified to a pixel:
    railways' close tracks drawn as one up to ONE_LINE_UNTIL, trams' and metros' at
    every zoom, split into their lines from LINES_FROM."""
    pixel = tile_size(z) / PIXELS
    keep = [i for i, p in enumerate(props) if FROM_ZOOM[p["rank"]] <= z]
    simple = shapely.simplify(lines[keep], pixel)
    kept_props = [props[i] for i in keep]
    rail_lines, rail_props = railways_shown(*only(simple, kept_props, transit=False), z, CLOSE_PIXELS * pixel)
    tram_lines, tram_props = transit_shown(*only(simple, kept_props, transit=True), z, CLOSE_PIXELS * pixel)
    return np.concatenate([rail_lines, tram_lines]), rail_props + tram_props


def only(lines: np.ndarray, props: list, transit: bool) -> tuple[np.ndarray, list]:
    """The trams, metro and light rail (transit), or the other railways."""
    chosen = [i for i, p in enumerate(props) if is_transit(p) == transit]
    return lines[chosen], [props[i] for i in chosen]


def railways_shown(lines: np.ndarray, props: list, z: int, close: float) -> tuple[np.ndarray, list]:
    """Close tracks drawn as one up to ONE_LINE_UNTIL; every track further in."""
    if z > ONE_LINE_UNTIL:
        return lines, props
    return one_line_for_close_tracks(lines, props, close)


def transit_shown(lines: np.ndarray, props: list, z: int, close: float) -> tuple[np.ndarray, list]:
    """Close tracks drawn as one at every zoom; from LINES_FROM a strand per line."""
    lines, props = one_line_for_close_tracks(lines, props, close)
    if z >= LINES_FROM:
        return strands(lines, props)
    return lines, [without_lines(p) for p in props]


def one_line_for_close_tracks(lines: np.ndarray, props: list, distance: float) -> tuple[np.ndarray, list]:
    """Close tracks drawn as one: the more important rank kept, then the longer line."""
    if not len(lines):
        return lines, props
    lengths = shapely.length(lines)
    priority = [(RANKS.index(p["rank"]), -length) for p, length in zip(props, lengths)]
    return one_line_where_close(lines, props, priority, distance)


def zoom_tiles(lines: np.ndarray, props: list, z: int) -> list[tuple[int, bytes]]:
    """A zoom's railway tiles (tile id, gzip)."""
    shown_lines, shown_props = shown(lines, props, z)
    return layer_tiles(TileLayer(LAYER, shown_lines, shown_props), z)


def source_of(background_map: Path) -> Path:
    """<area>.railways.osm.pbf beside <area>.pmtiles."""
    return background_map.with_name(f"{background_map.stem}.railways.osm.pbf")
