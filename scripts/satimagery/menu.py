"""Fork: satellite imagery. The scripts' questions (choose) and the downloads they lead to (steps)."""

from __future__ import annotations

import json
import shutil
import sys
from collections.abc import Iterable
from pathlib import Path

from .estimate import detailed_estimate, estimate
from .sources import (
    DETAILED_SOURCES,
    REGIONAL_BYTES_PER_KM2,
    WORLD_LAND_KM2,
    WORLD_OVERVIEW_BYTES,
    WORLDCOVER_BYTES_PER_KM2,
    detailed_source,
)
from .tiles import box_ring, load_rings

# --- Choosing what to download (the scripts' questions) -----------------------


class Index:
    """Geofabrik's index of regions: names, parents and outlines."""

    def __init__(self, path: str | None):
        self.features: dict[str, dict] = {}
        if path and Path(path).exists():
            for f in json.loads(Path(path).read_text())["features"]:
                self.features[f["properties"]["id"]] = f

    def name(self, region: str) -> str:
        if region == "world":
            return "the whole world"
        return self.features.get(region, {}).get("properties", {}).get("name", region)

    def within(self, region: str, parent: str) -> bool:
        while region:
            if region == parent:
                return True
            region = self.features.get(region, {}).get("properties", {}).get("parent")
        return False

    def outline(self, region: str, folder: Path) -> Path | None:
        """The region's outline as a file in `folder` (written from the index)."""
        path = folder / f".area-{region}.geojson"
        if not path.exists():
            geometry = self.features.get(region, {}).get("geometry")
            if not geometry:
                return None
            path.write_text(json.dumps(geometry))
        return path

    def search(self, text: str) -> list[tuple[str, str, str]]:
        """(id, name, parent's name) of the regions matching a name, best first."""
        text = text.lower().strip()
        hits = [
            f["properties"]
            for f in self.features.values()
            if f.get("geometry")
            and (
                text in f["properties"]["id"].lower()
                or text in f["properties"]["name"].lower()
            )
        ]
        hits.sort(key=lambda r: (r["name"].lower() != text, r["name"]))
        return [
            (
                r["id"],
                r["name"],
                self.name(r.get("parent", "")) if r.get("parent") else "",
            )
            for r in hits[:15]
        ]


def human(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1000 or unit == "TB":
            return (
                f"{n:.0f} {unit}"
                if unit in ("B", "KB", "MB") or n >= 10
                else f"{n:.1f} {unit}"
            )
        n /= 1000
    return ""


def duration(seconds: float) -> str:
    hours = seconds / 3600
    if hours < 1:
        return f"{max(1, round(seconds / 60))} min"
    if hours < 48:
        return f"{hours:.0f} h"
    return f"{hours / 24:.0f} days"


def sources_for(area: str, index: Index) -> list[str]:
    """The high-resolution sources that cover part of an area."""
    return [
        i
        for i, src in DETAILED_SOURCES.items()
        if area == "world"
        or any(index.within(area, r) or index.within(r, area) for r in src["regions"])
    ]


def detailed_job(source_id: str, area: str, index: Index, folder: Path) -> dict | None:
    """What one source downloads for an area: the area, cut to the source's region."""
    region = DETAILED_SOURCES[source_id]["regions"][0]
    clip = index.outline(region, folder)
    if not clip:
        return None
    if area == "world" or index.within(region, area):
        return {"source": source_id, "outline": str(clip), "clip": None}
    outline = index.outline(area, folder)
    return outline and {"source": source_id, "outline": str(outline), "clip": str(clip)}


# What a zoom level shows, for people to whom "zoom 16" means nothing.
ZOOM_SHOWS = {
    14: "neighbourhoods",
    15: "streets and blocks",
    16: "individual houses",
    17: "cars and small details",
}


def regional_have(folder: Path, area: str) -> int | None:
    """The last zoom of an area's Sentinel-2 imagery already downloaded, None if none."""
    zooms = pmtiles_zooms(folder / f"{area}.sat-regional.pmtiles")
    return zooms[1] if zooms else None


def pmtiles_zooms(path: Path) -> tuple[int, int] | None:
    """A PMTiles file's lowest and highest zoom (from its header), None if unreadable."""
    try:
        header = path.open("rb").read(127)
    except OSError:
        return None
    return (header[100], header[101]) if header[:7] == b"PMTiles" else None


def detailed_have(folder: Path, area: str, source: str) -> int | None:
    """The highest zoom of a source's aerial photos already downloaded for an area
    (the first file, and any added later: ...-z16-17.pmtiles), None if none."""
    tops = [
        zooms[1]
        for f in folder.glob(f"{area}.sat-detailed-{source}*.pmtiles")
        if (zooms := pmtiles_zooms(f))
    ]
    return max(tops) if tops else None


def detailed_file(
    folder: Path, area: str, source: str, minzoom: int, maxzoom: int
) -> Path:
    """Where aerial photos go: the first download from zoom 14; more detail added later
    in a file of its own (the zooms it has in its name), so what's there stays."""
    name = f"{area}.sat-detailed-{source}"
    if minzoom > 14:
        name += f"-z{minzoom}-{maxzoom}"
    return folder / f"{name}.pmtiles"


def job_estimate(job: dict, start: int | None = None) -> dict:
    source = detailed_source(job["source"])
    outlines = [load_rings(job["outline"])]
    if job["clip"]:
        outlines.append(load_rings(job["clip"]))
    if "bbox" in source:
        outlines.append(box_ring(source["bbox"]))
    return detailed_estimate(outlines, source, start)


def ask(prompt: str, choices: Iterable[str], default: str) -> str:
    choices = list(choices)
    while True:
        print(f"    {prompt} ", end="", file=sys.stderr, flush=True)
        line = sys.stdin.readline()
        if not line:
            sys.exit("Aborted.")
        answer = line.strip() or default
        if answer in choices:
            return answer
        shown = [c for c in choices if c != "none"]
        say(
            f"Type one of: {', '.join(shown)}"
            + (" (or Enter)" if default else "")
            + "."
        )


def ask_numbers(prompt: str, count: int) -> list[str]:
    """Some of the numbers 1 to count (Enter: none); asks again, saying why, if an
    answer isn't one of them."""
    while True:
        print(f"    {prompt} ", end="", file=sys.stderr, flush=True)
        line = sys.stdin.readline()
        if not line:
            sys.exit("Aborted.")
        words = line.split()
        if all(w.isdigit() and 1 <= int(w) <= count for w in words):
            return list(dict.fromkeys(words))
        say(f"Type numbers from 1 to {count}: the sources listed above, not zooms.")


def say(text: str = "") -> None:
    print(f"    {text}" if text else "", file=sys.stderr)


def command_choose(args) -> None:
    """Ask what to download (or take the presets) and write the plan (JSON)."""
    folder = Path(args.basemap_dir)
    folder.mkdir(parents=True, exist_ok=True)
    index = Index(args.index)
    region = args.region
    plan: dict = {"world_overview": False, "regional": None, "detailed": []}

    def regional_for(area: str, zoom: int) -> dict | None:
        if area == "world":
            return {"area": "world", "outline": None, "maxzoom": zoom}
        outline = index.outline(area, folder)
        return outline and {"area": area, "outline": str(outline), "maxzoom": zoom}

    def finish() -> None:
        plan["world_overview"] = (
            bool(
                plan["world_overview"]
                or plan["regional"]
                or plan["detailed"]
                or args.mode == "overview"
            )
            and not (folder / "world.sat-overview.pmtiles").exists()
        )
        Path(args.plan).write_text(json.dumps(plan, indent=1))

    # Presets (build-region.sh --satellite / --satellite-detailed, satellite.sh --yes).
    if args.mode:
        if args.mode in ("regional", "regional13"):
            area = args.area or region
            default = 10 if area == "world" else 12
            zoom = args.zoom or (13 if args.mode == "regional13" else default)
            plan["regional"] = regional_for(area, zoom)
        if args.detailed and args.detailed != "none":
            for source_id in (
                args.sources.split()
                if args.sources
                else sources_for(args.area or region, index)
            ):
                job = detailed_job(source_id, args.area or region, index, folder)
                # What's there already stays: only the zooms after it.
                have = detailed_have(folder, args.area or region, source_id)
                top = min(int(args.detailed), detailed_source(source_id)["maxzoom"])
                if job and not (have and have >= top):
                    plan["detailed"].append(
                        {
                            **job,
                            "area": args.area or region,
                            "maxzoom": top,
                            **({"minzoom": have + 1} if have else {}),
                        }
                    )
        finish()
        return

    world_done = (folder / "world.sat-overview.pmtiles").exists()
    say("Satellite imagery: photos of the ground as the map's background (Settings →")
    say("Background → Satellite), kept on this computer so they work offline.")
    say(
        "Zoom 8 shows a whole region on screen, 12 a town, 13 a neighbourhood, 16 a street."
    )
    say("Closer in than its last zoom, imagery is shown stretched (blurry).")
    say()
    if world_done:
        say("The world (NASA Blue Marble, 500 m, to zoom 8): already downloaded.")
    else:
        say(
            f"The world (NASA Blue Marble, 500 m, to zoom 8): {human(WORLD_OVERVIEW_BYTES)}, about an hour,"
        )
        say("downloaded once for every region. It comes with any choice below.")

    # --- Step 1: Sentinel-2 ---
    say()
    say("Step 1 of 2. Sentinel-2 photos, 10 m (2021, cloud-free): towns and fields,")
    say("from zoom 7 to 12 or 13.")
    region_name = args.region_name or index.name(region)
    region_outline = index.outline(region, folder) if region else None
    region_have = regional_have(folder, region) if region else None
    options = []
    if region_have:
        options.append(
            ("keep", f"Keep what you have ({region_name} to zoom {region_have})", "")
        )
    if region_outline:
        e = estimate(load_rings(str(region_outline)), 13)
        options.append(
            (
                "region",
                f"{region_name} (the region you built)"
                + (", again" if region_have else ""),
                f"+{human(e['regional']['bytes'] / 4)} to zoom 12",
            )
        )
    options += [
        ("other", "Another country or region...", ""),
        ("world", "The whole world", "sizes below"),
    ]
    if not region_have:
        options.append(("none", "None", ""))
    for n, (_, label, size) in enumerate(options, 1):
        say(f"  {n}) {label:<42} {size}")
    pick = options[
        int(
            ask(
                f"Choose [1-{len(options)}, default 1]:",
                [str(n) for n in range(1, len(options) + 1)],
                "1",
            )
        )
        - 1
    ][0]
    area = None
    if pick == "region":
        area = region
    elif pick == "other":
        while area is None:
            print(
                "    Country or region name (e.g. spain, bayern, japan): ",
                end="",
                file=sys.stderr,
                flush=True,
            )
            text = sys.stdin.readline().strip()
            if not text:
                break
            hits = index.search(text)
            if not hits:
                say("Nothing by that name; try another.")
                continue
            for n, (_, name, parent) in enumerate(hits, 1):
                say(f"  {n:>2}) {name}" + (f" ({parent})" if parent else ""))
            answer = ask(
                "Which one? [number, Enter: search again]:",
                [str(n) for n in range(len(hits) + 1)],
                "0",
            )
            if answer != "0":
                area = hits[int(answer) - 1][0]
    elif pick == "world":
        area = "world"
    else:
        # Nothing new from Sentinel-2 (keep, or none): on to the aerial photos.
        plan["world_overview"] = True

    if area == "world":
        say()
        say(
            "The whole world (land only), up to which zoom? Made from imagery read from ESA;"
        )
        say("the higher zooms take days to read and process, and need the disk space:")
        for z in range(9, 14):
            kept = WORLD_LAND_KM2 * REGIONAL_BYTES_PER_KM2[z]
            read = WORLD_LAND_KM2 * WORLDCOVER_BYTES_PER_KM2[z]
            say(f"  {z:>2}) zoom {z:<3} {human(kept):>8} kept   (reads ~{human(read)})")
        zoom = int(
            ask(
                "Up to which zoom? [9-13, default 10]:",
                [str(z) for z in range(9, 14)],
                "10",
            )
        )
        plan["regional"] = regional_for("world", zoom)
    elif area:
        e = estimate(load_rings(str(index.outline(area, folder))), 13)
        say()
        say(f"Satellite imagery of {index.name(area)} (Sentinel-2): up to which zoom?")
        say("The size on disk is what's kept; the download is what's read from ESA")
        say(
            "to make it (full-size source images, cut down), so it sets how long it takes."
        )
        say(
            f"  12) a town fills the screen      {human(e['regional']['bytes'] / 4):>8} on disk"
            f"   (downloads ~{human(e['regional']['download'] / 4)})"
        )
        say(
            f"  13) a district fills the screen  {human(e['regional']['bytes']):>8} on disk"
            f"   (downloads ~{human(e['regional']['download'])})"
        )
        plan["regional"] = regional_for(
            area, int(ask("Up to which zoom? [12/13, default 12]:", ["12", "13"], "12"))
        )

    # --- Step 2: aerial photos, by country (whatever step 1 was) ---
    target = area or region
    ids = sources_for(target, index) if target else []
    jobs = [j for j in (detailed_job(i, target, index, folder) for i in ids) if j]
    if target and not jobs and not args.no_detailed:
        say()
        say(
            f"Step 2 of 2. Aerial photos: no agency's photos cover {index.name(target)}."
        )
    if jobs and not args.no_detailed:
        say()
        say(
            f"Step 2 of 2. Aerial photos of {index.name(target)}, from national mapping agencies"
        )
        say()
        say("They replace the satellite imagery when you zoom in close, with")
        say("pixels of 8 to 60 cm instead of 10 m. They're fetched one small tile")
        say("at a time from the agency's servers, so a whole country takes days;")
        say("a city or a département, hours at most.")
        say()
        try:
            free = shutil.disk_usage(folder).free
            say(f"Free space on the disk for them ({folder}): {human(free)}.")
        except OSError:
            free = None
        say("Working out the sizes...")
        rows = []
        for job in jobs:
            src = detailed_source(job["source"])
            have = detailed_have(folder, target, job["source"])
            start = have + 1 if have else None
            if have and have >= src["maxzoom"]:
                say()
                say(
                    f"{src['name']}: you already have it up to zoom {have}, its most detailed."
                )
                continue
            sizes = job_estimate(job, start)
            rows.append((job, src, sizes, start))
            say()
            say(f"{len(rows)}) {src['name']}, {src['resolution']} per pixel")
            if have:
                say(
                    f"   You have it up to zoom {have} ({ZOOM_SHOWS.get(have, '')}). Add:"
                )
            for z, v in sizes.items():
                shows = ZOOM_SHOWS.get(int(z), "")
                warn = (
                    "  (more than the free space)"
                    if free is not None and v["bytes"] * 2 > free
                    else ""
                )
                say(
                    f"   up to zoom {z:<3} {shows:<24} {human(v['bytes']):>8}   "
                    f"about {duration(v['tiles'] / src['per_second'])}{warn}"
                )
        if rows:
            say()
            say("Sizes and times are at most: the areas include some sea, which comes")
            say("back empty and quick. During the last step the files need up to twice")
            say(
                "their size on disk. You can add more detail later: what's there stays,"
            )
            say("and only the new zooms are downloaded.")
            if len(rows) == 1:
                # One source: just how far (Enter: none).
                chosen = ["1"]
                offered = sorted(int(z) for z in rows[0][2])
                answer = ask(
                    f"Download {rows[0][1]['name']} up to which zoom? "
                    f"[{'/'.join(map(str, offered))}, Enter: none]:",
                    [str(z) for z in offered] + ["none"],
                    "none",
                )
                if answer == "none":
                    chosen = []
                else:
                    zoom = int(answer)
            else:
                chosen = ask_numbers(
                    f"Which sources? [their numbers 1-{len(rows)}, separated by spaces; Enter: none]:",
                    len(rows),
                )
                if chosen:
                    offered = sorted(
                        {int(z) for w in chosen for z in rows[int(w) - 1][2]}
                    )
                    default = "16" if 16 in offered else str(offered[0])
                    zoom = int(
                        ask(
                            f"Up to which zoom? [{'/'.join(map(str, offered))}, default {default}]:",
                            [str(z) for z in offered],
                            default,
                        )
                    )
            if chosen:
                for w in dict.fromkeys(chosen):
                    job, src, _, start = rows[int(w) - 1]
                    top = min(zoom, src["maxzoom"])
                    if start and top < start:
                        continue
                    plan["detailed"].append(
                        {
                            **job,
                            "area": target,
                            "maxzoom": top,
                            **({"minzoom": start} if start else {}),
                        }
                    )
    finish()


def command_steps(args) -> None:
    """The plan as commands, one per line: a label, then satellite.py's arguments,
    separated by tabs (for the scripts' timed steps)."""
    plan = json.loads(Path(args.plan).read_text())
    folder = Path(args.basemap_dir)
    index = Index(args.index)
    lines = []
    if plan["world_overview"]:
        lines.append(
            [
                "The world (NASA Blue Marble, to zoom 8; about an hour)",
                "overview",
                "--world",
                "--out",
                str(folder / "world.sat-overview.pmtiles"),
            ]
        )
    r = plan.get("regional")
    if r:
        where = ["--world"] if r["area"] == "world" else ["--outline", r["outline"]]
        lines.append(
            [
                f"Sentinel-2 10 m, {index.name(r['area'])}, to zoom {r['maxzoom']}",
                "regional",
                *where,
                "--maxzoom",
                str(r["maxzoom"]),
                "--out",
                str(folder / f"{r['area']}.sat-regional.pmtiles"),
            ]
        )
    for d in plan["detailed"]:
        src = detailed_source(d["source"])
        clip = ["--clip", d["clip"]] if d["clip"] else []
        lines.append(
            [
                f"{src['name']}, {src['resolution']}, {index.name(d['area'])}, "
                + (
                    f"zoom {d['minzoom']} to {d['maxzoom']}"
                    if d.get("minzoom")
                    else f"to zoom {d['maxzoom']}"
                ),
                "detailed",
                "--source",
                d["source"],
                "--outline",
                d["outline"],
                *clip,
                "--maxzoom",
                str(d["maxzoom"]),
                *(["--minzoom", str(d["minzoom"])] if d.get("minzoom") else []),
                "--out",
                str(
                    detailed_file(
                        folder,
                        d["area"],
                        d["source"],
                        d.get("minzoom") or 14,
                        d["maxzoom"],
                    )
                ),
            ]
        )
    for line in lines:
        print("\t".join(line))
