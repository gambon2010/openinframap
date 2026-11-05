"""Fork: satellite imagery. What each tier needs (tiles, composite cells) and how big it will be."""

from __future__ import annotations

import json
import math
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .download import cell_exists
from .sources import (
    AVERAGE_TILE_BYTES,
    REGIONAL_BYTES_PER_KM2,
    TIERS,
    WORLD_LAND_KM2,
    WORLD_OVERVIEW_BYTES,
    WORLD_OVERVIEW_ZOOM,
    WORLDCOVER_BYTES_PER_KM2,
    WORLDCOVER_LATITUDES,
)
from .tiles import (
    Ring,
    area_km2,
    block_count,
    box_touches_rings,
    rings_bbox,
    tile_blocks,
    tile_side_km,
    tiles_in_bbox,
)

# --- What each tier needs -----------------------------------------------------


def world_overview_tiles() -> list[tuple[int, int, int]]:
    """Every tile of the world to zoom 8."""
    return [
        (z, x, y)
        for z in range(TIERS["overview"][1] + 1)
        for x in range(2**z)
        for y in range(2**z)
    ]


def overview_tiles(rings: list[Ring]) -> list[tuple[int, int, int]]:
    """The world to zoom 5, then the region's bounding box to zoom 8."""
    out = [
        (z, x, y)
        for z in range(WORLD_OVERVIEW_ZOOM + 1)
        for x in range(2**z)
        for y in range(2**z)
    ]
    box = rings_bbox(rings)
    for z in range(WORLD_OVERVIEW_ZOOM + 1, TIERS["overview"][1] + 1):
        out += [(z, x, y) for x, y in tiles_in_bbox(box, z)]
    return out


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


def estimate(
    rings: list[Ring], regional_maxzoom: int = 12, detailed_maxzoom: int = 16
) -> dict:
    """Tiles, output size and download per tier (bytes), for the build script's menu."""
    area = area_km2(rings)
    lat = (rings_bbox(rings)[1] + rings_bbox(rings)[3]) / 2

    def tiles(minzoom: int, maxzoom: int) -> int:
        return int(
            sum(
                area / tile_side_km(lat, z) ** 2 + 1
                for z in range(minzoom, maxzoom + 1)
            )
        )

    overview = len(overview_tiles(rings))
    regional = tiles(TIERS["regional"][0], regional_maxzoom)
    detailed = tiles(TIERS["detailed"][0], detailed_maxzoom)
    return {
        "area_km2": round(area),
        "overview": {
            "tiles": overview,
            "bytes": overview * AVERAGE_TILE_BYTES["overview"],
        },
        "world_overview": {
            "tiles": len(world_overview_tiles()),
            "bytes": WORLD_OVERVIEW_BYTES,
        },
        # Sentinel-2 for the whole world, by max zoom: kept, and read from ESA.
        "world_regional": {
            str(z): {
                "bytes": WORLD_LAND_KM2 * REGIONAL_BYTES_PER_KM2[z],
                "download": WORLD_LAND_KM2 * WORLDCOVER_BYTES_PER_KM2[z],
            }
            for z in range(9, 14)
        },
        "regional": {
            "tiles": regional,
            "bytes": regional * AVERAGE_TILE_BYTES["regional"],
            "download": int(
                area * WORLDCOVER_BYTES_PER_KM2[13 if regional_maxzoom >= 13 else 12]
            ),
        },
        "detailed": {
            "tiles": detailed,
            "bytes": detailed * AVERAGE_TILE_BYTES["detailed"],
        },
        # Size of the detailed tier for each max zoom the build script offers.
        "detailed_by_zoom": {
            str(z): tiles(TIERS["detailed"][0], z) * AVERAGE_TILE_BYTES["detailed"]
            for z in (15, 16, 17)
        },
    }


def detailed_estimate(
    outlines: list[list[Ring]], source: dict, start: int | None = None
) -> dict:
    """Tiles and bytes from zoom `start` (default 14; more detail added later: the
    zoom after what's there) up to 15, 16, 17 (as far as the source goes)."""
    minzoom = start or TIERS["detailed"][0]
    counts = {
        z: block_count(tile_blocks(outlines, z))
        for z in range(minzoom, source["maxzoom"] + 1)
    }
    return {
        str(top): {
            "tiles": sum(counts[z] for z in range(minzoom, top + 1)),
            "bytes": sum(counts[z] for z in range(minzoom, top + 1)) * source["bytes"],
        }
        for top in range(max(15, minzoom), source["maxzoom"] + 1)
    }
