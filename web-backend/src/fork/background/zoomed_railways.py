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
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

import numpy as np
import osmium  # type: ignore[import-untyped]
import shapely

from .close_lines import one_line_where_close
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


def read(path: Path) -> tuple[np.ndarray, list[dict[str, Any]]]:
    """The railway lines of a file (in metres), and their properties."""
    reader = _Reader()
    reader.apply_file(str(path), locations=True)
    return joined(reader.lines, reader.props)


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
    """The lines shown at a zoom (their rank's first zoom), simplified to a pixel, the
    close ones drawn as one up to ONE_LINE_UNTIL."""
    pixel = tile_size(z) / PIXELS
    keep = [i for i, p in enumerate(props) if FROM_ZOOM[p["rank"]] <= z]
    simple = shapely.simplify(lines[keep], pixel)
    kept_props = [props[i] for i in keep]
    if z > ONE_LINE_UNTIL:
        return simple, kept_props
    return one_line_for_close_tracks(simple, kept_props, CLOSE_PIXELS * pixel)


def one_line_for_close_tracks(lines: np.ndarray, props: list, distance: float) -> tuple[np.ndarray, list]:
    """Close tracks drawn as one: the more important rank kept, then the longer line."""
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
