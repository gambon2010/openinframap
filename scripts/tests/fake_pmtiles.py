"""A file that reads as a PMTiles file (its header only): what the scripts look at
to know an offline map's zooms, tile format and bounds."""

import struct
from pathlib import Path

TILE_TYPES = {"mvt": 1, "png": 2, "jpg": 3, "webp": 4}


def header(
    minzoom: int = 0,
    maxzoom: int = 8,
    tile_format: str = "",
    bounds: tuple[float, float, float, float] | None = None,
) -> bytes:
    raw = bytearray(127)
    raw[:7], raw[7] = b"PMTiles", 3
    raw[99] = TILE_TYPES.get(tile_format, 0)
    raw[100], raw[101] = minzoom, maxzoom
    if bounds:
        struct.pack_into("<4i", raw, 102, *(round(v * 1e7) for v in bounds))
    return bytes(raw)


def write(path: Path, minzoom: int = 0, maxzoom: int = 8, **more) -> Path:
    path.write_bytes(header(minzoom, maxzoom, **more))
    return path
