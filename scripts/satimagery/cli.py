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
from .estimate import (
    detailed_estimate,
    estimate,
    overview_tiles,
    world_cells,
    world_overview_tiles,
    worldcover_cells,
)
from .extract import command_basemap
from .gdal import (
    docker_run,
    pmtiles_header,
    pmtiles_zooms,
    regional_pipeline,
    to_pmtiles,
)
from .maps import command_maps
from .menu import command_choose, command_steps
from .sources import (
    DETAILED_SOURCES,
    GDAL_IMAGE,
    GIBS_URL,
    SOURCES,
    TIERS,
    WORLD_BBOX,
    attribution_for,
    detailed_source,
    tile_url,
    worldcover_url,
)
from .tiles import (
    Ring,
    block_count,
    block_tiles,
    box_ring,
    load_rings,
    lowest_zoom,
    rings_bbox,
    tile_blocks,
)

# --- Commands -----------------------------------------------------------------


def print_progress(done: int, total: int) -> None:
    print(f"\r  {done:,}/{total:,} tiles", end="", file=sys.stderr, flush=True)
    if done == total:
        print(file=sys.stderr)


def command_estimate(args) -> None:
    print(
        json.dumps(
            estimate(
                load_rings(args.outline), args.regional_maxzoom, args.detailed_maxzoom
            )
        )
    )


def command_overview(args) -> None:
    if args.world:
        tiles, bbox = world_overview_tiles(), WORLD_BBOX
    elif args.outline:
        rings = load_rings(args.outline)
        tiles, bbox = overview_tiles(rings), rings_bbox(rings)
    else:
        sys.exit("overview needs --outline or --world")
    out = Path(args.out).resolve()
    minzoom, maxzoom, _fmt, attribution = TIERS["overview"]
    mbtiles = out.with_suffix(".mbtiles")
    # The world takes about an hour: a download stopped half-way goes on from there.
    writer = MBTiles(
        mbtiles, "Blue Marble", "jpg", minzoom, maxzoom, attribution, bbox, resume=True
    )
    done = {z: writer.has(z) for z in range(minzoom, maxzoom + 1)}
    try:
        found = download_tiles(
            tiles,
            GIBS_URL,
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


def lower_zooms_target(file: Path) -> tuple[int, list] | None:
    """The zoom a file should start at, and the outlines of what it covers (to read
    its tiles back), None if that can't be told. Sentinel-2: the tier's first zoom,
    or the lowest its area's outline can have (made when it started at zoom 9).
    Aerial photos: the tier's first zoom (made when they started at 14)."""
    header = pmtiles_header(file)
    if not header:
        return None
    if file.name.endswith(".sat-regional.pmtiles"):
        area = file.name.removesuffix(".sat-regional.pmtiles")
        outline = file.parent / f".area-{area}.geojson"
        if area == "world" or not outline.exists():
            return None
        rings = load_rings(str(outline))
        return lowest_zoom(rings, TIERS["regional"][0]), [rings]
    if ".sat-detailed" in file.name:
        return TIERS["detailed"][0], [box_ring(header["bounds"])]
    return None


def lower_zooms_needed(folder: Path) -> list[str]:
    """The imagery files that start above the zoom they should (lower_zooms_target)."""
    needed = []
    for file in sorted(folder.glob("*.sat-*.pmtiles")):
        target = lower_zooms_target(file)
        if target and pmtiles_zooms(file)[0] > target[0]:
            needed.append(file.stem)
    return needed


def command_lower_zooms(args) -> None:
    """An imagery file made when its tier started at a higher zoom (Sentinel-2 at 9,
    aerial photos at 14): its lower zooms added, without downloading anything. Its
    tiles are read back from the local imagery server (the basemap service), the
    lower zooms computed by GDAL the way the downloads do (average), and the file
    replaced once the new one is complete."""
    folder = Path(args.basemap_dir).resolve()
    if args.list_needed:
        for name in lower_zooms_needed(folder):
            print(name)
        return
    if not args.file:
        sys.exit("lower-zooms needs --file (or --list-needed)")
    out = folder / f"{args.file.removesuffix('.pmtiles')}.pmtiles"
    header = pmtiles_header(out)
    if not header:
        sys.exit(f"No imagery file {out}")
    first, last = header["minzoom"], header["maxzoom"]
    target = lower_zooms_target(out)
    if not target or first <= target[0]:
        print(
            f"  {out.name} already starts at zoom {first}: nothing to do.",
            file=sys.stderr,
        )
        return
    minzoom, outlines = target
    blocks = {z: tile_blocks(outlines, z) for z in range(first, last + 1)}
    total = sum(block_count(b) for b in blocks.values())
    url = f"{args.server}/{out.stem}/{{z}}/{{x}}/{{y}}.{header['format']}"
    print(
        f"  Reading {total:,} tiles (zoom {first} to {last}) from {args.server}",
        file=sys.stderr,
    )
    with tempfile.TemporaryDirectory(dir=folder, prefix=".satellite-") as tmp:
        work = Path(tmp)
        mbtiles = work / "tiles.mbtiles"
        writer = MBTiles(
            mbtiles,
            out.stem,
            header["format"],
            first,
            last,
            attribution_for(out.name),
            header["bounds"],
        )
        try:
            download_tiles(
                (t for z in range(first, last + 1) for t in block_tiles(blocks[z], z)),
                url,
                writer,
                threads=8,
                progress=print_progress,
                total=total,
            )
        finally:
            writer.close()
        # GDAL's overviews of an MBTiles file are its lower zooms: from the last one
        # down to minzoom (the zooms there are made again the same way).
        levels = " ".join(str(2**i) for i in range(1, last - minzoom + 1))
        docker_run(
            args.gdal_image,
            work,
            ["sh", "-c", f"gdaladdo -q -r average tiles.mbtiles {levels}"],
        )
        to_pmtiles(mbtiles, work / out.name, args.pmtiles_image)
        (work / out.name).replace(out)
    print(f"-> {out} (zoom {minzoom} to {last})")


def detailed_outlines(args, source: dict) -> list[list[Ring]]:
    """What to cover: the area asked for, the region the source covers (--clip),
    and the source's own limit."""
    outlines = [load_rings(args.outline)]
    if getattr(args, "clip", None):
        outlines.append(load_rings(args.clip))
    if "bbox" in source:
        outlines.append(box_ring(source["bbox"]))
    return outlines


def command_attribution(args) -> None:
    """The credit line of each imagery file named, one per line."""
    for name in args.names:
        print(attribution_for(name))


def command_sources(args) -> None:
    """The high-resolution sources (JSON), for the scripts' menus."""
    print(
        json.dumps(
            [
                {
                    k: detailed_source(i)[k]
                    for k in (
                        "id",
                        "name",
                        "regions",
                        "resolution",
                        "maxzoom",
                        "attribution",
                    )
                }
                for i in DETAILED_SOURCES
            ]
        )
    )


def command_estimate_detailed(args) -> None:
    source = detailed_source(args.source)
    print(json.dumps(detailed_estimate(detailed_outlines(args, source), source)))


def command_detailed(args) -> None:
    source = detailed_source(args.source)
    outlines = detailed_outlines(args, source)
    maxzoom = min(args.maxzoom, source["maxzoom"])
    out = Path(args.out).resolve()
    # More detail later makes the file again (the one there stays until replaced).
    minzoom = TIERS["detailed"][0]
    blocks = {z: tile_blocks(outlines, z) for z in range(minzoom, maxzoom + 1)}
    total = sum(block_count(b) for b in blocks.values())
    print(
        f"  {source['name']}: {total:,} tiles, zoom {minzoom} to {maxzoom}",
        file=sys.stderr,
    )
    mbtiles = out.with_suffix(".mbtiles")
    # A download stopped half-way goes on from there.
    writer = MBTiles(
        mbtiles,
        source["name"],
        source["format"],
        minzoom,
        maxzoom,
        source["attribution"],
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
            per_second=source["per_second"],
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


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sources")
    p = sub.add_parser("lower-zooms")
    p.add_argument(
        "--file",
        help="the imagery file (france.sat-regional, fr-67.sat-detailed-fr_ign)",
    )
    p.add_argument(
        "--list-needed", action="store_true", help="only list the areas that need it"
    )
    p.add_argument(
        "--basemap-dir",
        default=str(Path(__file__).resolve().parents[2] / "data" / "basemap"),
    )
    p.add_argument(
        "--server", default="http://localhost:8090", help="the local imagery server"
    )
    p.add_argument("--gdal-image", default=GDAL_IMAGE)
    p.add_argument("--pmtiles-image", default="protomaps/go-pmtiles:v1.28.0")
    sub.add_parser("attribution").add_argument("names", nargs="*")
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
    p.add_argument("--pmtiles-image", default="protomaps/go-pmtiles:v1.28.0")
    p = sub.add_parser("maps", help="the offline maps menu (what's there, add, remove)")
    p.add_argument(
        "--basemap-dir",
        default=str(Path(__file__).resolve().parents[2] / "data" / "basemap"),
    )
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
    p = sub.add_parser("basemap", help="cut the background map of an area")
    p.add_argument("--area", required=True)
    p.add_argument("--outline", required=True, help="the area's outline (GeoJSON)")
    p.add_argument("--detail", choices=("full", "reduced"), default="full")
    p.add_argument("--build", required=True, help="Protomaps' build (20261014.pmtiles)")
    p.add_argument("--basemap-dir", required=True)
    for name in ("choose", "steps"):
        p = sub.add_parser(name)
        p.add_argument("--plan", required=True, help="the plan file (JSON)")
        p.add_argument("--basemap-dir", required=True)
        p.add_argument("--index", help="Geofabrik's index (index-v1.json)")
        if name == "choose":
            p.add_argument("--region", default="", help="the region built")
            p.add_argument("--region-name", default="")
            p.add_argument(
                "--mode",
                choices=("none", "overview", "regional", "regional13"),
                help="no questions: this choice (build-region.sh --satellite)",
            )
            p.add_argument(
                "--area",
                help="with --mode: the area, else the region (an id, or world)",
            )
            p.add_argument(
                "--detailed", help="with --mode: high resolution to this zoom, or none"
            )
            p.add_argument(
                "--zoom",
                type=int,
                choices=range(9, 14),
                help="with --mode regional: Sentinel-2 to this zoom",
            )
            p.add_argument(
                "--sources", help="with --detailed: these sources (else all that apply)"
            )
            p.add_argument(
                "--no-detailed", action="store_true", help="don't offer high resolution"
            )
    for name in ("estimate", "overview", "regional", "detailed", "estimate-detailed"):
        p = sub.add_parser(name)
        p.add_argument(
            "--outline",
            required=name not in ("overview", "regional"),
            help="the region's outline (GeoJSON)",
        )
        if name in ("overview", "regional"):
            p.add_argument("--world", action="store_true", help="the whole world")
        if name in ("detailed", "estimate-detailed"):
            p.add_argument(
                "--source",
                choices=sorted(
                    i for i, s in DETAILED_SOURCES.items() if "files" not in s
                ),
                required=True,
            )
            p.add_argument(
                "--clip", help="also inside this outline (the source's country)"
            )
        if name not in ("estimate", "estimate-detailed"):
            p.add_argument("--out", required=True, help="the PMTiles file to write")
            p.add_argument("--pmtiles-image", default="protomaps/go-pmtiles:v1.28.0")
        if name == "regional":
            p.add_argument(
                "--maxzoom", type=int, choices=(9, 10, 11, 12, 13), default=12
            )
            p.add_argument("--gdal-image", default=GDAL_IMAGE)
        if name == "detailed":
            p.add_argument("--maxzoom", type=int, choices=(15, 16, 17), default=16)
        if name == "estimate":
            p.add_argument("--regional-maxzoom", type=int, default=12)
            p.add_argument("--detailed-maxzoom", type=int, default=16)
    args = parser.parse_args(list(argv) if argv is not None else None)
    netsafe.run_until_connected(lambda: run_command(args))


def run_command(args) -> None:
    {
        "estimate": command_estimate,
        "overview": command_overview,
        "regional": command_regional,
        "detailed": command_detailed,
        "sources": command_sources,
        "attribution": command_attribution,
        "estimate-detailed": command_estimate_detailed,
        "choose": command_choose,
        "steps": command_steps,
        "lower-zooms": command_lower_zooms,
        "bdortho": command_bdortho,
        "maps": command_maps,
        "basemap": command_basemap,
    }[args.command](args)
