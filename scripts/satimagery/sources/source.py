"""Fork: satellite imagery. What a source declares (one file per source in this
folder, each with a SOURCE): the menus, sizes, inventory and the map's tiers all
work from these fields, so adding a country's photos is one small file."""

from __future__ import annotations

import math
from dataclasses import dataclass, field

# How a source is fetched: a tile server (template with {z} {x} {y} / {ty}), a WMS
# (GetMap with {bbox}), the agency's files one unit at a time (address: the
# converter module), ESA's cells (Sentinel-2), or cut out of a world file
# (Protomaps' background map).
FETCH_KINDS = ("tiles", "wms", "files", "cells", "extract")
# Which of the map's layers it makes: Blue Marble, Sentinel-2, aerial photos, the
# background map (vector).
LAYERS = ("overview", "regional", "detailed", "basemap")
# A zoom 0 pixel (256-pixel tiles) at the equator, metres.
EQUATOR_PIXEL_M = 156_543.0


@dataclass(frozen=True)
class Source:
    id: str  # the file's name; also in the files made ("fr-67.sat-detailed-fr_ign")
    name: str  # short, for the menus: "IGN"
    title: str  # longer, with the country: "France (IGN, BD ORTHO)"
    credit: str  # shown on the map
    layer: str  # one of LAYERS
    fetch: str  # one of FETCH_KINDS
    first_zoom: int  # made from this zoom
    last_zoom: int  # its most: past it the photos only stretch, or the server stops
    detail_m: float | None = None  # metres per pixel (None: vector)
    address: str = ""  # tile template, WMS GetMap, converter module
    regions: tuple[str, ...] = ()  # Geofabrik regions it covers (none: anywhere)
    bbox: tuple[float, float, float, float] | None = None  # a tighter limit
    units: str = ""  # downloaded unit by unit ("départements"), or as one area
    format: str = "jpg"
    tile_bytes: int = 22_000  # a kept tile, on average (measured)
    read_per_km2: int = 0  # downloaded per km², whatever the zoom (files); 0: the tiles
    per_second: int = 10  # tiles a second the server is asked for
    sizes: dict = field(default_factory=dict)  # more measured sizes, by name

    @property
    def resolution(self) -> str:
        if self.detail_m is None:
            return ""
        if self.detail_m < 1:
            return f"{round(self.detail_m * 100)} cm"
        return f"{self.detail_m:g} m"

    @property
    def label(self) -> str:
        """The menus' line: "IGN 20 cm"."""
        return f"{self.name} {self.resolution}".strip()

    def finest_zoom(self, latitude: float = 45.0) -> int:
        """The zoom whose pixel at that latitude comes nearest the source's own
        (a little coarser is fine: past it, a zoom only stretches the photos)."""
        assert self.detail_m
        pixel = EQUATOR_PIXEL_M * math.cos(math.radians(latitude))
        return math.floor(math.log2(pixel / (self.detail_m * 0.7)))
