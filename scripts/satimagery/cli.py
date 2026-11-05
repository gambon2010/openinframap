"""Fork: satellite imagery. The command line (python3 scripts/satellite.py <command>)."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from collections.abc import Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .download import MBTiles, cell_exists, download_tiles
from .estimate import (
    detailed_estimate,
    estimate,
    overview_tiles,
    world_cells,
    world_overview_tiles,
    worldcover_cells,
)
from .gdal import docker_run, regional_pipeline, to_pmtiles
from .menu import command_choose, command_steps
from .sources import (
    DETAILED_SOURCES,
    GDAL_IMAGE,
    GIBS_URL,
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
    found = download_tiles(
        tiles,
        GIBS_URL,
        writer,
        threads=8,
        progress=print_progress,
        skip=lambda z, x, y: (x, y) in done[z],
    )
    writer.close()
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
        docker_run(
            args.gdal_image,
            work,
            ["sh", "-c", regional_pipeline(args.maxzoom, cut=not args.world)],
            env,
        )
        to_pmtiles(work / "regional.mbtiles", work / out.name, args.pmtiles_image)
        (work / out.name).replace(out)
    print(f"-> {out}")


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
    # More detail added later: only the zooms after what's there, in a file of its own.
    minzoom = args.minzoom or TIERS["detailed"][0]
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
    writer.close()
    to_pmtiles(mbtiles, out, args.pmtiles_image)
    mbtiles.unlink()
    print(f"{found:,} tiles -> {out}")


def main(argv: Iterable[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("sources")
    sub.add_parser("attribution").add_argument("names", nargs="*")
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
                "--source", choices=sorted(DETAILED_SOURCES), default="fr_ign"
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
            p.add_argument(
                "--minzoom",
                type=int,
                choices=(14, 15, 16, 17),
                help="from this zoom (more detail added to a download already done)",
            )
        if name == "estimate":
            p.add_argument("--regional-maxzoom", type=int, default=12)
            p.add_argument("--detailed-maxzoom", type=int, default=16)
    args = parser.parse_args(list(argv) if argv is not None else None)
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
    }[args.command](args)
