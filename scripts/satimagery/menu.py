"""Fork: satellite imagery. The scripts' questions (choose) and the downloads they lead to (steps)."""

from __future__ import annotations

import json
import shutil
import sys
from collections.abc import Iterable
from pathlib import Path

from . import bdortho
from .departements import DEPARTEMENTS
from .estimate import detailed_estimate, estimate
from .gdal import pmtiles_zooms
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
    18: "road markings",
    19: "the photos' full detail",
}
# How fast IGN's download service sends its files (several at once), for the times.
BDORTHO_BYTES_PER_SECOND = 3_000_000


def regional_have(folder: Path, area: str) -> int | None:
    """The last zoom of an area's Sentinel-2 imagery already downloaded, None if none."""
    zooms = pmtiles_zooms(folder / f"{area}.sat-regional.pmtiles")
    return zooms[1] if zooms else None


def detailed_file(folder: Path, area: str, source: str) -> Path:
    """Where a source's aerial photos of an area go. More detail later makes the
    file again up to the new zoom (replaced once it's finished), as IGN's
    départements are: one file, one rule."""
    return folder / f"{area}.sat-detailed-{source}.pmtiles"


def detailed_have(folder: Path, area: str, source: str) -> int | None:
    """The last zoom of a source's aerial photos of an area, None if none."""
    zooms = pmtiles_zooms(detailed_file(folder, area, source))
    return zooms[1] if zooms else None


def job_estimate(job: dict) -> dict:
    source = detailed_source(job["source"])
    outlines = [load_rings(job["outline"])]
    if job["clip"]:
        outlines.append(load_rings(job["clip"]))
    if "bbox" in source:
        outlines.append(box_ring(source["bbox"]))
    return detailed_estimate(outlines, source)


# --- Asking -----------------------------------------------------------------------


def say(text: str = "") -> None:
    print(f"    {text}" if text else "", file=sys.stderr)


def read_answer(prompt: str) -> str:
    print(f"    {prompt} ", end="", file=sys.stderr, flush=True)
    line = sys.stdin.readline()
    if not line:
        sys.exit("Aborted.")
    return line.strip()


def ask(prompt: str, choices: Iterable[str], default: str) -> str:
    """One of the choices (Enter: the default); asks again, saying why, if not."""
    choices = list(choices)
    while True:
        answer = read_answer(prompt) or default
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
        words = read_answer(prompt).split()
        if all(w.isdigit() and 1 <= int(w) <= count for w in words):
            return list(dict.fromkeys(words))
        say(f"Type numbers from 1 to {count}: the sources listed above, not zooms.")


def free_space(folder: Path) -> int | None:
    try:
        return shutil.disk_usage(folder).free
    except OSError:
        return None


# --- The plan -------------------------------------------------------------------------


class Planner:
    """What to download, asked (or taken from the presets), written as the plan."""

    def __init__(self, args):
        self.args = args
        self.folder = Path(args.basemap_dir)
        self.folder.mkdir(parents=True, exist_ok=True)
        self.index = Index(args.index)
        self.plan: dict = {
            "world_overview": False,
            "regional": None,
            "detailed": [],
            "bdortho": None,
        }

    def regional_for(self, area: str, zoom: int) -> dict | None:
        if area == "world":
            return {"area": "world", "outline": None, "maxzoom": zoom}
        outline = self.index.outline(area, self.folder)
        return outline and {"area": area, "outline": str(outline), "maxzoom": zoom}

    def detailed_for(self, job: dict, area: str, zoom: int) -> dict | None:
        """A tile source to a zoom (as far as it goes), unless that's there already."""
        top = min(zoom, detailed_source(job["source"])["maxzoom"])
        have = detailed_have(self.folder, area, job["source"])
        return None if have and have >= top else {**job, "area": area, "maxzoom": top}

    def aerial_sources(self, area: str) -> tuple[list[dict], list[str]]:
        """What covers an area: the tile sources' jobs, and IGN's départements."""
        ids = sources_for(area, self.index)
        jobs = [
            j
            for i in ids
            if "files" not in DETAILED_SOURCES[i]
            and (j := detailed_job(i, area, self.index, self.folder))
        ]
        files = any("files" in DETAILED_SOURCES[i] for i in ids)
        codes = bdortho.departements_in(area, self.index.within) if files else []
        return jobs, codes

    def write(self) -> None:
        plan = self.plan
        plan["world_overview"] = (
            bool(
                plan["world_overview"]
                or plan["regional"]
                or plan["detailed"]
                or plan["bdortho"]
                or self.args.mode == "overview"
            )
            and not (self.folder / "world.sat-overview.pmtiles").exists()
        )
        Path(self.args.plan).write_text(json.dumps(plan, indent=1))

    # --- Presets (build-region.sh --satellite / --satellite-detailed, satellite.sh --yes)

    def presets(self) -> None:
        args = self.args
        area = args.area or args.region
        if args.mode in ("regional", "regional13"):
            default = 10 if area == "world" else 12
            zoom = args.zoom or (13 if args.mode == "regional13" else default)
            self.plan["regional"] = self.regional_for(area, zoom)
        if not args.detailed or args.detailed == "none":
            return
        jobs, codes = self.aerial_sources(area)
        if args.sources:
            wanted = args.sources.split()
            jobs = [j for j in jobs if j["source"] in wanted]
            codes = codes if any("files" in DETAILED_SOURCES[i] for i in wanted) else []
        self.plan["detailed"] = [
            d for j in jobs if (d := self.detailed_for(j, area, int(args.detailed)))
        ]
        if codes:
            self.plan["bdortho"] = {"codes": codes, "maxzoom": int(args.detailed)}

    # --- The questions ---------------------------------------------------------------

    def ask_all(self) -> None:
        self.introduction()
        area = self.step_sentinel()
        if not self.args.no_detailed:
            self.step_aerial(area or self.args.region)

    def introduction(self) -> None:
        say(
            "Satellite imagery: photos of the ground as the map's background (Settings →"
        )
        say("Background → Satellite), kept on this computer so they work offline.")
        say(
            "Zoom 8 shows a whole region on screen, 12 a town, 13 a neighbourhood, 16 a street."
        )
        say("Closer in than its last zoom, imagery is shown stretched (blurry).")
        say()
        if (self.folder / "world.sat-overview.pmtiles").exists():
            say("The world (NASA Blue Marble, 500 m, to zoom 8): already downloaded.")
        else:
            say(
                f"The world (NASA Blue Marble, 500 m, to zoom 8): {human(WORLD_OVERVIEW_BYTES)}, about an hour,"
            )
            say("downloaded once for every region. It comes with any choice below.")

    def step_sentinel(self) -> str | None:
        """Step 1: Sentinel-2, of which area (None: nothing new) and to which zoom."""
        region, index = self.args.region, self.index
        say()
        say(
            "Step 1 of 2. Sentinel-2 photos, 10 m (2021, cloud-free): towns and fields,"
        )
        say("from zoom 7 to 12 or 13.")
        region_name = self.args.region_name or index.name(region)
        region_outline = index.outline(region, self.folder) if region else None
        region_have = regional_have(self.folder, region) if region else None
        options = []
        if region_have:
            options.append(
                (
                    "keep",
                    f"Keep what you have ({region_name} to zoom {region_have})",
                    "",
                )
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
        numbers = [str(n) for n in range(1, len(options) + 1)]
        pick = options[
            int(ask(f"Choose [1-{len(options)}, default 1]:", numbers, "1")) - 1
        ][0]
        area = {"region": region, "other": None, "world": "world"}.get(pick)
        if pick == "other":
            area = self.search_area()
        if pick in ("keep", "none"):
            # Nothing new from Sentinel-2: on to the aerial photos.
            self.plan["world_overview"] = True
        if area == "world":
            self.plan["regional"] = self.regional_for("world", self.world_zoom())
        elif area:
            self.plan["regional"] = self.regional_for(area, self.area_zoom(area))
        return area

    def search_area(self) -> str | None:
        """A country or region found by name (Enter: none)."""
        while True:
            text = read_answer("Country or region name (e.g. spain, bayern, japan):")
            if not text:
                return None
            hits = self.index.search(text)
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
                return hits[int(answer) - 1][0]

    def world_zoom(self) -> int:
        say()
        say(
            "The whole world (land only), up to which zoom? Made from imagery read from ESA;"
        )
        say("the higher zooms take days to read and process, and need the disk space:")
        for z in range(9, 14):
            kept = WORLD_LAND_KM2 * REGIONAL_BYTES_PER_KM2[z]
            read = WORLD_LAND_KM2 * WORLDCOVER_BYTES_PER_KM2[z]
            say(f"  {z:>2}) zoom {z:<3} {human(kept):>8} kept   (reads ~{human(read)})")
        return int(
            ask(
                "Up to which zoom? [9-13, default 10]:",
                [str(z) for z in range(9, 14)],
                "10",
            )
        )

    def area_zoom(self, area: str) -> int:
        e = estimate(load_rings(str(self.index.outline(area, self.folder))), 13)
        say()
        say(
            f"Satellite imagery of {self.index.name(area)} (Sentinel-2): up to which zoom?"
        )
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
        return int(ask("Up to which zoom? [12/13, default 12]:", ["12", "13"], "12"))

    def step_aerial(self, area: str | None) -> None:
        """Step 2: aerial photos, by country (whatever step 1 was)."""
        if not area:
            return
        jobs, codes = self.aerial_sources(area)
        say()
        if not jobs and not codes:
            say(
                f"Step 2 of 2. Aerial photos: no agency's photos cover {self.index.name(area)}."
            )
            return
        say(
            f"Step 2 of 2. Aerial photos of {self.index.name(area)}, from national mapping agencies"
        )
        say()
        say("They replace the satellite imagery when you zoom in close, with")
        say("pixels of 8 to 60 cm instead of 10 m.")
        free = free_space(self.folder)
        if free is not None:
            say(f"Free space on the disk for them ({self.folder}): {human(free)}.")
        if codes:
            self.plan["bdortho"] = choose_bdortho(codes, self.folder, free)
        if jobs:
            self.plan["detailed"] = self.choose_tile_sources(jobs, area, free)

    def choose_tile_sources(
        self, jobs: list[dict], area: str, free: int | None
    ) -> list[dict]:
        """The sources fetched tile by tile: which, up to which zoom."""
        say()
        say("These are fetched one small tile at a time from the agency's servers,")
        say("so a whole country takes days; a city, hours at most.")
        say("Working out the sizes...")
        rows = []
        for job in jobs:
            src = detailed_source(job["source"])
            have = detailed_have(self.folder, area, job["source"])
            if have and have >= src["maxzoom"]:
                say()
                say(
                    f"{src['name']}: you already have it up to zoom {have}, its most detailed."
                )
                continue
            # Only more than what's there (the file is made again to the new zoom).
            sizes = {
                z: v for z, v in job_estimate(job).items() if not have or int(z) > have
            }
            rows.append((job, src, sizes))
            say()
            say(f"{len(rows)}) {src['name']}, {src['resolution']} per pixel")
            if have:
                say(
                    f"   You have it up to zoom {have} ({ZOOM_SHOWS.get(have, '')}); more makes it again:"
                )
            for z, v in sizes.items():
                warn = (
                    "  (more than the free space)"
                    if free is not None and v["bytes"] * 2 > free
                    else ""
                )
                say(
                    f"   up to zoom {z:<3} {ZOOM_SHOWS.get(int(z), ''):<24} {human(v['bytes']):>8}   "
                    f"about {duration(v['tiles'] / src['per_second'])}{warn}"
                )
        if not rows:
            return []
        say()
        say("Sizes and times are at most: the areas include some sea, which comes")
        say("back empty and quick. During the last step the files need up to twice")
        say("their size on disk. More detail later makes a file again to the new zoom")
        say("(what's there stays until then; the zooms below are a third more work).")
        if len(rows) == 1:
            # One source: just how far (Enter: none).
            offered = list(rows[0][2])
            answer = ask(
                f"Download {rows[0][1]['name']} up to which zoom? [{'/'.join(offered)}, Enter: none]:",
                [*offered, "none"],
                "none",
            )
            if answer == "none":
                return []
            chosen, zoom = [rows[0]], int(answer)
        else:
            picked = ask_numbers(
                f"Which sources? [their numbers 1-{len(rows)}, separated by spaces; Enter: none]:",
                len(rows),
            )
            if not picked:
                return []
            chosen = [rows[int(w) - 1] for w in picked]
            offered = sorted({z for row in chosen for z in row[2]}, key=int)
            default = "16" if "16" in offered else offered[0]
            zoom = int(
                ask(
                    f"Up to which zoom? [{'/'.join(offered)}, default {default}]:",
                    offered,
                    default,
                )
            )
        return [d for job, _, _ in chosen if (d := self.detailed_for(job, area, zoom))]


def choose_bdortho(codes: list[str], folder: Path, free: int | None) -> dict | None:
    """IGN's photos (BD ORTHO): up to which zoom, which départements (Enter: all)."""
    have = {c: bdortho.have_zoom(bdortho.file_of(folder, c)) for c in codes}
    read = bdortho.estimate(codes, 19)["download"]
    say()
    say("France: IGN's aerial photos (BD ORTHO, 20 cm per pixel), downloaded as")
    say("IGN's files, one département at a time: each is read whole (about 5 GB")
    say("per 1,000 km²) whatever the zoom, made into tiles here, then deleted, so")
    say("the disk only holds the tiles and one département at a time.")
    say()
    say(
        f"{len(codes)} département{'s' if len(codes) > 1 else ''}: downloads ~{human(read)}"
        f" from IGN in all (about {duration(read / BDORTHO_BYTES_PER_SECOND)}),"
    )
    say("then kept on disk:")
    for z in range(15, 20):
        kept = bdortho.estimate(codes, z)["bytes"]
        warn = (
            "  (more than the free space)" if free is not None and kept > free else ""
        )
        say(f"   up to zoom {z:<3} {ZOOM_SHOWS[z]:<24} {human(kept):>8}{warn}")
    done = [c for c in codes if have[c]]
    if done:
        say(
            "Already here (made again only to a higher zoom): "
            + ", ".join(f"{c} to {have[c]}" for c in done)
            + "."
        )
    answer = ask(
        "Download IGN's photos up to which zoom? [15-19, Enter: none]:",
        [str(z) for z in range(15, 20)] + ["none"],
        "none",
    )
    if answer == "none":
        return None
    if len(codes) > 1:
        say()
        width = max(len(DEPARTEMENTS[c][0]) for c in codes) + 5
        per_line = max(1, 76 // width)
        for i in range(0, len(codes), per_line):
            say(
                "  "
                + "".join(
                    f"{c:>3} {DEPARTEMENTS[c][0]:<{width - 4}}"
                    for c in codes[i : i + per_line]
                )
            )
        while True:
            line = read_answer(
                f"Which départements? [their codes, e.g. {codes[0]} {codes[-1]}; "
                f"Enter: all {len(codes)}]:"
            )
            words = [
                w.upper() if w[-1:].isalpha() else w.zfill(2) for w in line.split()
            ]
            if all(w in codes for w in words):
                break
            say("Type codes from the list above (or Enter for all of them).")
        codes = list(dict.fromkeys(words)) or codes
    return {"codes": codes, "maxzoom": int(answer)}


def command_choose(args) -> None:
    """Ask what to download (or take the presets) and write the plan (JSON)."""
    planner = Planner(args)
    if args.mode:
        planner.presets()
    else:
        planner.ask_all()
    planner.write()


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
                f"{src['name']}, {src['resolution']}, {index.name(d['area'])}, to zoom {d['maxzoom']}",
                "detailed",
                "--source",
                d["source"],
                "--outline",
                d["outline"],
                *clip,
                "--maxzoom",
                str(d["maxzoom"]),
                "--out",
                str(detailed_file(folder, d["area"], d["source"])),
            ]
        )
    b = plan.get("bdortho")
    if b:
        codes = b["codes"]
        lines.append(
            [
                "IGN aerial photos (BD ORTHO), "
                + (
                    DEPARTEMENTS[codes[0]][0]
                    if len(codes) == 1
                    else f"{len(codes)} départements"
                )
                + f", to zoom {b['maxzoom']}",
                "bdortho",
                "--dept",
                *codes,
                "--maxzoom",
                str(b["maxzoom"]),
                "--basemap-dir",
                str(folder),
            ]
        )
    for line in lines:
        print("\t".join(line))
