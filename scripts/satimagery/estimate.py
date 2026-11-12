"""Fork: satellite imagery. What a download needs: the world's Blue Marble tiles,
the Sentinel-2 composite's cells over an outline, an aerial source's tiles and size."""

from __future__ import annotations

import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .download import cell_exists
from .sources import AERIAL_FIRST_ZOOM, BLUE_MARBLE, WORLDCOVER_LATITUDES, Source
from .tiles import Ring, block_count, box_touches_rings, rings_bbox, tile_blocks

# --- What each tier needs -----------------------------------------------------


def world_overview_tiles() -> list[tuple[int, int, int]]:
    """Every tile of the world to zoom 8."""
    return [
        (z, x, y)
        for z in range(BLUE_MARBLE.last_zoom + 1)
        for x in range(2**z)
        for y in range(2**z)
    ]


def worldcover_cells(rings: list[Ring]) -> list[str]:
    """The 1°×1° cells of the composite that touch the outline ("N49E006": the cell
    whose south-west corner is 49°N 6°E)."""
    west, south, east, north = rings_bbox(rings)
    cells = []
    for lat in range(math.floor(south), math.floor(north) + 1):
        for lon in range(math.floor(west), math.floor(east) + 1):
            if box_touches_rings((lon, lat, lon + 1, lat + 1), rings):
                ns = f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}"
                ew = f"{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
                cells.append(ns + ew)
    return cells


def world_cells(cache: Path) -> list[str]:
    """Every cell of the composite (land only), found once by asking for each 1°
    cell (in parallel; a few minutes) and kept in `cache`."""
    if cache.exists():
        return json.loads(cache.read_text())
    names = [
        f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}"
        for lat in WORLDCOVER_LATITUDES
        for lon in range(-180, 180)
    ]
    print(
        f"  Finding the composite's cells ({len(names):,} to check)...", file=sys.stderr
    )
    with ThreadPoolExecutor(max_workers=32) as pool:
        found = [c for c, ok in zip(names, pool.map(cell_exists, names)) if ok]
    cache.write_text(json.dumps(found))
    return found


def detailed_estimate(outlines: list[list[Ring]], source: Source) -> dict:
    """An aerial source's tiles and bytes from its first zoom up to 15, 16, 17 (as
    far as it goes), inside every outline."""
    counts = {
        z: block_count(tile_blocks(outlines, z))
        for z in range(AERIAL_FIRST_ZOOM, source.last_zoom + 1)
    }
    return {
        str(top): {
            "tiles": sum(counts[z] for z in range(AERIAL_FIRST_ZOOM, top + 1)),
            "bytes": sum(counts[z] for z in range(AERIAL_FIRST_ZOOM, top + 1))
            * source.tile_bytes,
        }
        for top in range(15, source.last_zoom + 1)
    }
