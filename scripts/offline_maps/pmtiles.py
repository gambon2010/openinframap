"""Fork: offline maps. A PMTiles v3 file's header: its zooms, what it covers, its
tiles' format, how many tiles it has (decoded by the pmtiles package)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from pmtiles.tile import deserialize_header

# The header's tile type byte, as the extension the tiles are served with.
FORMATS = {1: "mvt", 2: "png", 3: "jpg", 4: "webp", 5: "avif"}
# A PMTiles v3 header's length.
HEADER_BYTES = 127


@dataclass(frozen=True)
class Header:
    minzoom: int
    maxzoom: int
    format: str  # mvt, png, jpg, webp, avif ("" if it doesn't say)
    bounds: tuple[float, float, float, float] | None  # west, south, east, north
    tile_count: int  # tiles it addresses (0: empty)

    @property
    def zooms(self) -> tuple[int, int]:
        return self.minzoom, self.maxzoom


def read_header(path: Path) -> Header | None:
    """A file's header, None if it can't be read or isn't a PMTiles file."""
    try:
        with path.open("rb") as f:
            raw = f.read(HEADER_BYTES)
    except OSError:
        return None
    if len(raw) < HEADER_BYTES or raw[:7] != b"PMTiles":
        return None
    h = deserialize_header(raw)
    corners = (h["min_lon_e7"], h["min_lat_e7"], h["max_lon_e7"], h["max_lat_e7"])
    return Header(
        minzoom=h["min_zoom"],
        maxzoom=h["max_zoom"],
        format=FORMATS.get(h["tile_type"].value, ""),
        bounds=tuple(v / 1e7 for v in corners) if any(corners) else None,  # type: ignore[arg-type]
        tile_count=h["addressed_tiles_count"],
    )


# What `pmtiles extract --dry-run` says a cut-out would weigh.
DRY_RUN_SIZE = re.compile(r"archive size of ([0-9.]+) ([kMGT]?)B")
UNITS = {"": 1, "k": 1e3, "M": 1e6, "G": 1e9, "T": 1e12}


def dry_run_size(output: str) -> int | None:
    """The size a dry run printed, in bytes, None if it didn't say."""
    found = DRY_RUN_SIZE.findall(output)
    return int(float(found[-1][0]) * UNITS[found[-1][1]]) if found else None
