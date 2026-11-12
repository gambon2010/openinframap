"""Fork: offline maps. A PMTiles v3 file's header: its zooms, what it covers, its
tiles' format. The one reader the scripts have (the backend has the pmtiles
package)."""

from __future__ import annotations

import struct
from dataclasses import dataclass
from pathlib import Path

# The header's tile type byte, as the extension the tiles are served with.
FORMATS = {1: "mvt", 2: "png", 3: "jpg", 4: "webp", 5: "avif"}


@dataclass(frozen=True)
class Header:
    minzoom: int
    maxzoom: int
    format: str  # mvt, png, jpg, webp, avif ("" if it doesn't say)
    bounds: tuple[float, float, float, float] | None  # west, south, east, north

    @property
    def zooms(self) -> tuple[int, int]:
        return self.minzoom, self.maxzoom


def read_header(path: Path) -> Header | None:
    """A file's header, None if it can't be read or isn't a PMTiles file."""
    try:
        with path.open("rb") as f:
            raw = f.read(127)
    except OSError:
        return None
    if len(raw) < 127 or raw[:7] != b"PMTiles":
        return None
    corners = struct.unpack_from("<4i", raw, 102)
    return Header(
        minzoom=raw[100],
        maxzoom=raw[101],
        format=FORMATS.get(raw[99], ""),
        bounds=tuple(v / 1e7 for v in corners) if any(corners) else None,  # type: ignore[arg-type]
    )
