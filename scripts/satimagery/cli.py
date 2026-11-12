"""Fork: satellite imagery. The command line (python3 scripts/satellite.py <command>)."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import netsafe

from .bdortho import TILER_IMAGE, command_bdortho
from .download import MBTiles, cell_exists, download_tiles
from .estimate import world_cells, world_overview_tiles, worldcover_cells
from .extract import PMTILES_IMAGE, command_basemap, command_large_buildings
from .gdal import docker_run, regional_pipeline, to_pmtiles
from .inventory import imagery_summary, imagery_tiers
from .maps import command_maps
from .sources import (
    AERIAL,
    AERIAL_FIRST_ZOOM,
    BLUE_MARBLE,
    GDAL_IMAGE,
    SENTINEL2,
    SOURCES,
    WORLD_BBOX,
    Source,
    tile_url,
    worldcover_url,
)
from .tiles import (
    Ring,
    block_count,
    block_tiles,
    box_ring,
    load_rings,
    rings_bbox,
    tile_blocks,
)

# --- Commands -----------------------------------------------------------------


def print_progress(done: int, total: int) -> None:
    print(f"\r  {done:,}/{total:,} tiles", end="", file=sys.stderr, flush=True)
    if done == total:
        print(file=sys.stderr)


def command_overview(args) -> None:
    """NASA Blue Marble, the whole world to zoom 8: one file for every region."""
    tiles, bbox = world_overview_tiles(), WORLD_BBOX
    out = Path(args.out).resolve()
    minzoom, maxzoom, attribution = (
        BLUE_MARBLE.first_zoom,
        BLUE_MARBLE.last_zoom,
        BLUE_MARBLE.credit,
    )
    mbtiles = out.with_suffix(".mbtiles")
    # The world takes about an hour: a download stopped half-way goes on from there.
    writer = MBTiles(
        mbtiles, "Blue Marble", "jpg", minzoom, maxzoom, attribution, bbox, resume=True
    )
    done = {z: writer.has(z) for z in range(minzoom, maxzoom + 1)}
    try:
        found = download_tiles(
            tiles,
            BLUE_MARBLE.address,
            writer,
            threads=8,
            progress=print_progress,
            skip=lambda z, x, y: (x, y) in done[z],
        )
    finally:
        writer.close()  # kept for the next run, even when stopped
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


def command_regional(args) -> None:
    out = Path(args.out).resolve()
    if args.world:
        cells = world_cells(out.parent / ".worldcover-cells.json")
    elif args.outline:
        rings = load_rings(args.outline)
        with ThreadPoolExecutor(max_workers=16) as pool:
            names = worldcover_cells(rings)
            cells = [c for c, ok in zip(names, pool.map(cell_exists, names)) if ok]
    else:
        sys.exit("regional needs --outline or --world")
    if not cells:
        sys.exit("The Sentinel-2 composite has nothing over this region.")
    print(f"  {len(cells)} cells of the Sentinel-2 composite", file=sys.stderr)
    with tempfile.TemporaryDirectory(dir=out.parent, prefix=".satellite-") as tmp:
        work = Path(tmp)
        (work / "cells.txt").write_text(
            "".join(f"/vsicurl/{worldcover_url(c)}\n" for c in cells)
        )
        if not args.world:
            (work / "area.geojson").write_text(Path(args.outline).read_text())
        env = {
            "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
            "GDAL_HTTP_MULTIRANGE": "YES",
            "GDAL_HTTP_MAX_RETRY": "5",
            "GDAL_HTTP_RETRY_DELAY": "3",
            "VSI_CACHE": "TRUE",
            "GDAL_CACHEMAX": "1024",
        }
        # GDAL reads the cells over the network: a lost connection fails the
        # pipeline, run again once it's back (netsafe).
        netsafe.safely(
            lambda: docker_run(
                args.gdal_image,
                work,
                ["sh", "-c", regional_pipeline(args.maxzoom, cut=not args.world)],
                env,
            ),
            worldcover_url(cells[0]),
            retries=1,
            also_retry=(subprocess.CalledProcessError,),
            rounds_up=0,  # the server answers: GDAL's own failure
        )
        to_pmtiles(work / "regional.mbtiles", work / out.name, args.pmtiles_image)
        (work / out.name).replace(out)
    print(f"-> {out}")


def detailed_outlines(args, source: Source) -> list[list[Ring]]:
    """What to cover: the area asked for, the region the source covers (--clip),
    and the source's own limit."""
    outlines = [load_rings(args.outline)]
    if getattr(args, "clip", None):
        outlines.append(load_rings(args.clip))
    if source.bbox:
        outlines.append(box_ring(source.bbox))
    return outlines


def command_tiers(args) -> None:
    """The imagery there is, as the frontend's VITE_SATELLITE_TIERS (one line)."""
    print(imagery_tiers(Path(args.basemap_dir), args.server))


def command_summary(args) -> None:
    """The imagery there is, in words, with its size."""
    print(imagery_summary(Path(args.basemap_dir)))


def command_sources(args) -> None:
    """The aerial photo sources (JSON): id, name, where, detail, last zoom, credit."""
    print(
        json.dumps(
            [
                {
                    "id": s.id,
                    "name": s.title,
                    "regions": list(s.regions),
                    "resolution": s.resolution,
                    "maxzoom": s.last_zoom,
                    "attribution": s.credit,
                }
                for s in AERIAL.values()
            ]
        )
    )


def command_detailed(args) -> None:
    source = SOURCES[args.source]
    outlines = detailed_outlines(args, source)
    maxzoom = min(args.maxzoom, source.last_zoom)
    out = Path(args.out).resolve()
    # More detail later makes the file again (the one there stays until replaced).
    minzoom = AERIAL_FIRST_ZOOM
    blocks = {z: tile_blocks(outlines, z) for z in range(minzoom, maxzoom + 1)}
    total = sum(block_count(b) for b in blocks.values())
    print(
        f"  {source.title}: {total:,} tiles, zoom {minzoom} to {maxzoom}",
        file=sys.stderr,
    )
    mbtiles = out.with_suffix(".mbtiles")
    # A download stopped half-way goes on from there.
    writer = MBTiles(
        mbtiles,
        source.title,
        source.format,
        minzoom,
        maxzoom,
        source.credit,
        rings_bbox(outlines[0]),
        resume=True,
    )
    done: dict[int, set[tuple[int, int]]] = {}

    def skip(z: int, x: int, y: int) -> bool:
        if z not in done:
            done.clear()
            done[z] = writer.has(z)
        return (x, y) in done[z]

    try:
        found = download_tiles(
            (t for z in range(minzoom, maxzoom + 1) for t in block_tiles(blocks[z], z)),
            lambda z, x, y: tile_url(source, z, x, y),
            writer,
            threads=4,
            per_second=source.per_second,
            progress=print_progress,
            total=total,
            skip=skip,
            drop_repeated=True,
        )
    finally:
        writer.close()  # kept for the next run, even when stopped
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


BASEMAP_DIR = str(Path(__file__).resolve().parents[2] / "data" / "basemap")


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    # The menu, and what it runs without questions.
    p = sub.add_parser("maps", help="the offline maps menu (what's there, add, remove)")
    p.add_argument("--basemap-dir", default=BASEMAP_DIR)
    p.add_argument("--index", help="Geofabrik's index (index-v1.json)")
    p.add_argument("--region", default="", help="the region built")
    p.add_argument("--source", choices=sorted(SOURCES), help="no questions: add this")
    p.add_argument("--area", help="with --source: the area (default: the region)")
    p.add_argument("--units", nargs="+", help="with --source: these units (67 2A...)")
    p.add_argument("--zoom", type=int, help="with --source: aerial photos to this zoom")
    p.add_argument("--resume", action="store_true", help="no questions: resume")
    p.add_argument("--queued", action="store_true", help="no questions: the queue")
    p.add_argument(
        "--queue-only",
        action="store_true",
        help="add to the queue, don't download (build-region.sh: questions first)",
    )
    p.add_argument("--yes", action="store_true", help="start without asking")

    # One download each (the menu's jobs).
    p = sub.add_parser("overview", help="NASA Blue Marble, the whole world to zoom 8")
    p.add_argument("--out", required=True, help="the PMTiles file to write")
    p.add_argument("--pmtiles-image", default=PMTILES_IMAGE)

    p = sub.add_parser("regional", help="Sentinel-2 of an outline, or the world")
    p.add_argument("--outline", help="the area's outline (GeoJSON)")
    p.add_argument("--world", action="store_true", help="the whole world")
    p.add_argument(
        "--maxzoom",
        type=int,
        choices=range(9, SENTINEL2.last_zoom + 1),
        default=SENTINEL2.last_zoom,
    )
    p.add_argument("--out", required=True, help="the PMTiles file to write")
    p.add_argument("--gdal-image", default=GDAL_IMAGE)
    p.add_argument("--pmtiles-image", default=PMTILES_IMAGE)

    p = sub.add_parser("detailed", help="aerial photos from a tile server or a WMS")
    p.add_argument(
        "--source",
        choices=sorted(i for i, s in AERIAL.items() if not s.units),
        required=True,
    )
    p.add_argument("--outline", required=True, help="the area's outline (GeoJSON)")
    p.add_argument("--clip", help="also inside this outline (the source's country)")
    p.add_argument("--maxzoom", type=int, choices=(15, 16, 17), default=17)
    p.add_argument("--out", required=True, help="the PMTiles file to write")
    p.add_argument("--pmtiles-image", default=PMTILES_IMAGE)

    p = sub.add_parser("bdortho", help="IGN's aerial photos of French départements")
    p.add_argument(
        "--dept", nargs="+", required=True, help="département codes (67 2A...)"
    )
    p.add_argument("--maxzoom", type=int, choices=range(15, 20), default=17)
    p.add_argument("--basemap-dir", required=True)
    p.add_argument(
        "--max-rate",
        type=float,
        default=float(os.environ.get("OIM_MAX_RATE") or 0),
        help="download speed cap, MB/s (default: OIM_MAX_RATE, else none)",
    )
    p.add_argument("--gdal-image", default=GDAL_IMAGE, help="for 7-Zip, if not here")
    p.add_argument("--tiler-image", default=TILER_IMAGE)
    p.add_argument("--pmtiles-image", default=PMTILES_IMAGE)

    p = sub.add_parser("basemap", help="cut the background map of an area")
    p.add_argument("--area", required=True)
    p.add_argument("--outline", help="the area's outline (GeoJSON; not for world)")
    p.add_argument("--size", type=int, help="world: the file's size, for the progress")
    p.add_argument("--maxzoom", type=int, help="world: only up to this zoom (cut out)")
    p.add_argument("--build", required=True, help="Protomaps' build (20261014.pmtiles)")
    p.add_argument("--basemap-dir", required=True)

    sub.add_parser(
        "large-buildings", help="find the large buildings again (shown zoomed out)"
    )

    # For the scripts.
    sub.add_parser("sources", help="the aerial photo sources (JSON)")
    p = sub.add_parser("tiers", help="the imagery there is, as VITE_SATELLITE_TIERS")
    p.add_argument("--basemap-dir", default=BASEMAP_DIR)
    p.add_argument(
        "--server", default="http://localhost:8090", help="the imagery server"
    )
    p = sub.add_parser("summary", help="the imagery there is, in words")
    p.add_argument("--basemap-dir", default=BASEMAP_DIR)
    args = parser.parse_args(list(argv) if argv is not None else None)
    netsafe.run_until_connected(lambda: run_command(args))


def run_command(args) -> None:
    {
        "maps": command_maps,
        "overview": command_overview,
        "regional": command_regional,
        "detailed": command_detailed,
        "bdortho": command_bdortho,
        "basemap": command_basemap,
        "large-buildings": command_large_buildings,
        "sources": command_sources,
        "tiers": command_tiers,
        "summary": command_summary,
    }[args.command](args)
