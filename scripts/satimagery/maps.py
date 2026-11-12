"""Fork: offline maps, the one menu (satellite.py maps): satellite imagery, aerial
photos and the background map. Home shows what's there (the inventory), then
Resume, Add, Remove, Settings; every question goes through ui.py, every offer
through coverage.py, so nothing pointless or already there is offered.

Downloads run one after the other as satellite.py's own commands (bdortho,
regional, overview, detailed, basemap), holding the offline maps' lock; what's
left of them is kept in data/basemap/queue.json, so Resume goes on after a stop.
docs/plans/offline-maps.md."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from pathlib import Path

from . import coverage, extract, inventory, ui
from .aerial import detailed_file, detailed_job, job_estimate
from .bdortho import DOWNLOAD_BYTES_PER_SECOND
from .inventory import Entry
from .regions import Index
from .sources import BLUE_MARBLE, SENTINEL2, SOURCES, Source
from .tiles import area_km2, load_rings

SATELLITE_PY = Path(__file__).resolve().parents[1] / "satellite.py"
QUEUE = "queue.json"
# The lock's holder, for the commands it runs (they'd wait for it otherwise).
LOCK_ENV = "OIM_MAPS_LOCK"
LAYER_ORDER = {"overview": 0, "regional": 1, "detailed": 2, "basemap": 3}
# Free space a département needs while it's converted, over its archive's size
# (the archive, its images, the reprojected image).
CONVERT_ROOM = 2.1


@dataclass
class Job:
    label: str  # "IGN 20 cm, 94 départements, z17"
    argv: list[str]  # satellite.py's arguments
    kept: int = 0
    download: int = 0
    seconds: float = 0
    peak: int = 0  # free space needed while it runs, besides what it keeps


class Maps:
    def __init__(self, args):
        self.args = args
        self.folder = Path(args.basemap_dir).resolve()
        self.folder.mkdir(parents=True, exist_ok=True)
        self.index = Index(args.index)
        self.region = args.region or ""
        self.entries: list[Entry] = []
        self.refresh()

    def refresh(self) -> None:
        self.entries = inventory.load(self.folder)

    def within(self, a: str, b: str) -> bool:
        return self.index.within(a, b)

    def name(self, area: str) -> str:
        return "World" if area == "world" else self.index.name(area)

    def settings(self) -> dict:
        return inventory.settings(self.folder)

    # --- Home ----------------------------------------------------------------------

    def groups(self) -> list[tuple[str, Source, list[Entry]]]:
        """Done files by area and source, World first."""
        found: dict[tuple[str, str], list[Entry]] = {}
        for e in self.entries:
            if e.status == "done" and e.source in SOURCES:
                found.setdefault((e.area, e.source), []).append(e)
        keys = sorted(
            found,
            key=lambda k: (
                k[0] != "world",
                self.name(k[0]),
                LAYER_ORDER[SOURCES[k[1]].layer],
            ),
        )
        return [(area, SOURCES[source], found[(area, source)]) for area, source in keys]

    def group_row(self, area: str, source: Source, entries: list[Entry]) -> list[str]:
        first = min(e.zooms[0] for e in entries)
        last = max(e.zooms[1] for e in entries)
        note = ""
        if source.units:
            units = inventory.converter(source).units_in(area, self.within)
            note = f"{len(entries)}/{len(units) or '?'} {source.units}"
        size = ui.human(sum(e.bytes for e in entries))
        return [self.name(area), source.label, ui.zooms(first, last), size, note]

    def stopped(self) -> list[Entry]:
        return [e for e in self.entries if e.status in ("stopped", "running")]

    def queue(self) -> list[Job]:
        try:
            return [Job(**j) for j in json.loads((self.folder / QUEUE).read_text())]
        except (OSError, ValueError, TypeError):
            return []

    def save_queue(self, jobs: list[Job]) -> None:
        path = self.folder / QUEUE
        if jobs:
            path.write_text(json.dumps([asdict(j) for j in jobs], indent=1) + "\n")
        else:
            path.unlink(missing_ok=True)

    def show_home(self) -> None:
        free = shutil.disk_usage(self.folder).free
        ui.say("")
        ui.say(f"Offline maps{'':<40}{ui.human(free)} free")
        ui.say("")
        rows = [self.group_row(*g) for g in self.groups()]
        for e in self.stopped():
            source = SOURCES[e.source]
            what = inventory.converter(source).unit_name(e.unit) if e.unit else ""
            state = "downloading" if e.status == "running" else "stopped"
            if e.reason:
                state += f" ({e.reason})"
            rows.append(
                [
                    self.name(e.area),
                    source.label,
                    "…",
                    "",
                    f"{e.unit} {what}: {ui.part(e.have, e.of)}, {state}",
                ]
            )
        if rows:
            ui.table(rows, ["Area", "Source", "zoom", "size", ""], right={3})
        else:
            ui.say(" Nothing yet.")
        busy = inventory.running(self.folder)
        if busy:
            ui.say("")
            ui.say(f" Downloading now: {busy}")

    def home(self) -> None:
        while True:
            self.refresh()
            self.show_home()
            actions = (["Resume"] if self.resume_jobs() else []) + [
                "Add",
                "Remove",
                "Settings",
            ]
            picked = ui.choose(actions, back="quit")
            if picked is None:
                return
            {
                "Resume": lambda: self.start(self.resume_jobs()),
                "Add": self.add,
                "Remove": self.remove,
                "Settings": self.edit_settings,
            }[actions[picked]]()

    # --- Resume ---------------------------------------------------------------------

    def resume_jobs(self) -> list[Job]:
        """What's left of the last downloads, and jobs stopped outside them."""
        jobs = self.queue()
        queued = {a for j in jobs if j.argv[0] == "bdortho" for a in j.argv}
        for e in self.stopped():
            if e.status == "stopped" and e.unit and e.unit not in queued:
                zoom = work_zoom(self.folder / e.file) or self.settings()["zoom"]
                jobs.append(self.units_job(SOURCES[e.source], [e.unit], zoom))
        return jobs

    # --- Add ------------------------------------------------------------------------

    def pick_area(self) -> str | None:
        areas = [self.region] if self.region else []
        areas += sorted(
            {e.area for e in self.entries if e.area not in ("world", self.region)},
            key=self.name,
        )
        labels = [
            self.name(a) + (" (the region built)" if a == self.region else "")
            for a in areas
        ]
        labels += ["World", "Search…"]
        ui.say("")
        ui.say("Which area?")
        ui.table([[str(n), label] for n, label in enumerate(labels, 1)])
        picked = ui.pick_row(len(labels))
        if picked is None:
            return None
        if picked < len(areas):
            return areas[picked]
        if picked == len(areas):
            return "world"
        return self.search_area()

    def search_area(self) -> str | None:
        while True:
            text = ui.answer(
                "Country or region (e.g. spain, bayern, japan; Enter: back):"
            )
            if not text:
                return None
            hits = self.index.search(text)
            if not hits:
                ui.say("Nothing by that name.")
                continue
            ui.table(
                [[str(n), name, parent] for n, (_, name, parent) in enumerate(hits, 1)]
            )
            picked = ui.pick_row(len(hits))
            if picked is not None:
                return hits[picked][0]

    def km2(self, area: str) -> float:
        if area == "world":
            return SENTINEL2.sizes["world_land_km2"]
        outline = self.index.outline(area, self.folder)
        return area_km2(load_rings(str(outline))) if outline else 0

    def offers(self, area: str) -> list[tuple[list[str], object]]:
        """The table of what an area can have: (row, what picking it does)."""
        rows = []
        world_bm = self.have("blue_marble", "world")
        rows.append(
            (
                [
                    "Blue Marble 500 m (world)",
                    "z0–8" if world_bm else "—",
                    "—" if world_bm else ui.human(BLUE_MARBLE.sizes["world"]),
                ],
                None if world_bm else self.blue_marble_job,
            )
        )
        top = coverage.top_zoom(SENTINEL2, area, self.within)
        own = self.have(SENTINEL2.id, area)
        cover = coverage.covered_by(
            SENTINEL2, area, top.zoom, self.entries, self.within
        )
        add = f"to {top.zoom}" + (f" ({top.why})" if top.why else "")
        if cover:
            add = (
                "—" if cover.area == area else f"— (covered by {self.name(cover.area)})"
            )
        else:
            add += f"   {ui.human(self.km2(area) * SENTINEL2.sizes['kept_per_km2'][top.zoom])}"
        rows.append(
            (
                [SENTINEL2.label, f"z{ui.zooms(*own.zooms)}" if own else "—", add],
                None if cover else (lambda: [self.sentinel_job(area, top.zoom)]),
            )
        )
        for source in coverage.aerial_touching(area, self.within):
            if source.units:
                rows.append(self.units_offer(source, area))
            else:
                rows.append(self.tiles_offer(source, area))
        if area == "world":
            rows.append(self.world_low_offer())
        rows.append(self.basemap_offer(area))
        return rows

    def have(self, source: str, area: str) -> Entry | None:
        return next(
            (
                e
                for e in self.entries
                if e.source == source
                and e.area == area
                and e.status == "done"
                and not e.unit
            ),
            None,
        )

    def add(self) -> None:
        area = self.pick_area()
        if not area:
            return
        while True:
            offers = self.offers(area)
            ui.say("")
            ui.table(
                [[str(n), *row] for n, (row, _) in enumerate(offers, 1)],
                ["", self.name(area), "have", "add"],
            )
            picked = ui.pick_row(len(offers))
            if picked is None:
                return
            action = offers[picked][1]
            if not action:
                ui.say("Nothing to add there.")
                continue
            jobs = action()
            if jobs:
                self.start(self.complete(jobs))
                return

    def complete(self, jobs: list[Job]) -> list[Job]:
        """What comes with any choice: Blue Marble with imagery, the world's
        background map zoomed out, the large buildings after a background map."""
        return self.with_large_buildings(
            self.with_world_background(self.with_blue_marble(jobs))
        )

    def with_world_background(self, jobs: list[Job]) -> list[Job]:
        """The whole world's background map to zoom 8 (every country's borders,
        names, coasts; 560 MB) comes with anything, once: like Blue Marble."""
        if not jobs or self.have("protomaps", "world"):
            return jobs
        if any(j.argv[:3] == ["basemap", "--area", "world"] for j in jobs):
            return jobs
        return (self.basemap_jobs("world", extract.WORLD_LOW_ZOOM) or []) + jobs

    def with_large_buildings(self, jobs: list[Job]) -> list[Job]:
        """A background map with every building (to zoom 15): its large ones are
        found for showing zoomed out, after it (once, at the end)."""
        full = any(j.argv[0] == "basemap" and "--maxzoom" not in j.argv for j in jobs)
        if full and not any(j.argv[0] == "large-buildings" for j in jobs):
            return jobs + [large_buildings_job()]
        return jobs

    def with_blue_marble(self, jobs: list[Job]) -> list[Job]:
        """Blue Marble comes with any imagery: it's what shows further out."""
        imagery = any(j.argv[0] in ("regional", "detailed", "bdortho") for j in jobs)
        if (
            imagery
            and not self.have("blue_marble", "world")
            and jobs[0].argv[0] != "overview"
        ):
            return self.blue_marble_job() + jobs
        return jobs

    # --- The jobs each source makes ------------------------------------------------

    def blue_marble_job(self) -> list[Job]:
        out = self.folder / "world.sat-overview.pmtiles"
        return [
            Job(
                f"{BLUE_MARBLE.label}, the world, z0–8",
                ["overview", "--out", str(out)],
                kept=BLUE_MARBLE.sizes["world"],
                download=BLUE_MARBLE.sizes["world"],
                seconds=3600,
            )
        ]

    def sentinel_job(self, area: str, zoom: int) -> Job:
        km2 = self.km2(area)
        if area == "world":
            where = ["--world"]
        else:
            where = ["--outline", str(self.index.outline(area, self.folder))]
        out = self.folder / f"{area}.sat-regional.pmtiles"
        return Job(
            f"{SENTINEL2.label}, {self.name(area)}, z{SENTINEL2.first_zoom}–{zoom}",
            ["regional", *where, "--maxzoom", str(zoom), "--out", str(out)],
            kept=int(km2 * SENTINEL2.sizes["kept_per_km2"][zoom]),
            download=int(km2 * SENTINEL2.sizes["read_per_km2"][zoom]),
        )

    def zoom_offered(self, source: Source) -> int:
        return min(self.settings()["zoom"], source.last_zoom)

    def ask_zoom(
        self, source: Source, sizes: dict[int, int], extra: str = ""
    ) -> int | None:
        """The zoom (Enter: the default), the size kept at each shown under it."""
        default = self.zoom_offered(source)
        shown = [z for z in sorted(sizes) if z >= default]
        ui.say("")
        ui.table(
            [
                [
                    f"{source.name} zoom",
                    *(f"[{z}]" if z == default else str(z) for z in shown),
                ],
                ["kept", *(ui.human(sizes[z]) for z in shown), extra],
            ],
            right=set(range(1, len(shown) + 1)),
        )

        def check(text: str):
            if text.isdigit() and int(text) in sizes:
                return int(text)
            ui.say(f"Type one of: {' '.join(map(str, shown))} (Enter: {default}).")
            return None

        return ui.ask(">", check, str(default))  # type: ignore[return-value]

    def units_offer(self, source: Source, area: str):
        units = inventory.converter(source).units_in(area, self.within)
        done = coverage.units_done(source, self.entries, self.zoom_offered(source))
        left = [u for u in units if u not in done]
        row = [
            f"{source.label} (by {source.units.rstrip('s')})",
            f"{len(done & set(units))}/{len(units)}",
            f"{len(left)} left" if left else "—",
        ]
        return row, (lambda: self.units_jobs(source, area)) if left else None

    def units_jobs(self, source: Source, area: str) -> list[Job] | None:
        conv = inventory.converter(source)
        units = conv.units_in(area, self.within)
        offered = coverage.units_done(source, self.entries, self.zoom_offered(source))
        left = [u for u in units if u not in offered] or units
        sizes = {
            z: conv.unit_estimate(units, z)["bytes"]
            for z in range(15, source.last_zoom + 1)
        }
        download = conv.unit_estimate(left, source.last_zoom)["download"]
        zoom = self.ask_zoom(source, sizes, f"   download {ui.human(download)}")
        if zoom is None:
            return None
        done = coverage.units_done(source, self.entries, zoom)
        left = [u for u in units if u not in done]
        if not left:
            ui.say("All there already.")
            return None
        stopped = {e.unit for e in self.stopped()}

        def listing() -> None:
            ui.columns(
                [
                    f"{'✓' if u in done else '◐' if u in stopped else ' '} {u} {short(conv.unit_name(u))}"
                    for u in units
                ]
            )

        if len(left) > 1:
            ui.say("")
            picked = ui.codes(
                f"{source.units.capitalize()} ({len(left)} left)   [Enter: all]   or codes"
                f" ({left[0]} {left[-1]}...)   ? : list\n>",
                left,
                normalise=lambda w: w.upper() if w[-1:].isalpha() else w.zfill(2),
                listing=listing,
            )
        else:
            picked = left
        return [self.units_job(source, picked, zoom)]

    def units_job(self, source: Source, units: list[str], zoom: int) -> Job:
        conv = inventory.converter(source)
        # Big units first: the most space is needed early, while it's known.
        units = sorted(units, key=lambda u: -conv.unit_estimate([u], zoom)["download"])
        e = conv.unit_estimate(units, zoom)
        had = sum(x.have for x in self.stopped() if x.unit in units)
        rate_setting = self.settings()["max_rate"]
        rate = (rate_setting or 0) * 1e6 or DOWNLOAD_BYTES_PER_SECOND
        argv = [
            "bdortho",
            "--dept",
            *units,
            "--maxzoom",
            str(zoom),
            "--basemap-dir",
            str(self.folder),
        ]
        if rate_setting:
            argv += ["--max-rate", str(rate_setting)]
        what = (
            conv.unit_name(units[0])
            if len(units) == 1
            else f"{len(units)} {source.units}"
        )
        return Job(
            f"{source.label}, {what}, z{zoom}",
            argv,
            kept=e["bytes"],
            download=max(0, e["download"] - had),
            seconds=max(0, e["download"] - had) / rate,
            peak=int(
                max(conv.unit_estimate([u], zoom)["download"] for u in units)
                * CONVERT_ROOM
            ),
        )

    def tiles_offer(self, source: Source, area: str):
        own = self.have(source.id, area)
        full = own and own.zooms[1] >= source.last_zoom
        row = [
            source.label,
            f"z{ui.zooms(*own.zooms)}" if own else "—",
            "—" if full else f"to {self.zoom_offered(source)}",
        ]
        return row, None if full else (lambda: self.tiles_jobs(source, area))

    def tiles_jobs(
        self, source: Source, area: str, zoom: int | None = None
    ) -> list[Job] | None:
        job = detailed_job(source.id, area, self.index, self.folder)
        if not job:
            ui.say(f"No outline for {self.name(area)} in Geofabrik's index.")
            return None
        ui.say("Working out the sizes...")
        estimate = {int(z): v for z, v in job_estimate(job).items()}
        if zoom is None:
            zoom = self.ask_zoom(source, {z: v["bytes"] for z, v in estimate.items()})
            if zoom is None:
                return None
        # Without questions: the zoom asked, as far as the source goes.
        zoom = max(min(zoom, max(estimate)), min(estimate))
        clip = ["--clip", job["clip"]] if job["clip"] else []
        out = detailed_file(self.folder, area, source.id)
        return [
            Job(
                f"{source.label}, {self.name(area)}, z{source.first_zoom}–{zoom}",
                [
                    "detailed",
                    "--source",
                    source.id,
                    "--outline",
                    job["outline"],
                    *clip,
                    "--maxzoom",
                    str(zoom),
                    "--out",
                    str(out),
                ],
                kept=estimate[zoom]["bytes"],
                download=estimate[zoom]["bytes"],
                seconds=estimate[zoom]["tiles"] / source.per_second,
            )
        ]

    def latest_build(self) -> tuple[str, int] | None:
        """Protomaps' latest world map (asked once a menu; None offline)."""
        if not hasattr(self, "_latest"):
            self._latest = extract.latest_build()
        return self._latest

    def basemap_offer(self, area: str):
        """The background map: what's there (its edition), and whether there's
        a newer one or it's covered by an area around it."""
        protomaps = SOURCES["protomaps"]
        own = self.have(protomaps.id, area)
        cover = coverage.covered_by(
            protomaps, area, protomaps.last_zoom, self.entries, self.within
        )
        latest = self.latest_build()
        newest = edition(latest[0]) if latest else ""
        have = edition_date(own.edition) if own else "—"
        if cover and cover.area != area:
            add = f"— (covered by {self.name(cover.area)})"
        elif not latest:
            add = "can't reach Protomaps"
        elif own and own.zooms[1] < protomaps.last_zoom:
            add = f"all zooms, {edition_date(newest)}"
        elif own and own.edition >= newest:
            add = "— (the latest)"
        elif own:
            add = f"newer: {edition_date(newest)}"
        else:
            add = f"z0–15, {edition_date(newest)}"
        offered = latest and not add.startswith("—")
        return ["Background map", have, add], (
            lambda: self.basemap_jobs(area)
        ) if offered else None

    def world_low_offer(self):
        """The whole world's background map zoomed out (to zoom 8): every
        country's borders and names, small (like Blue Marble for imagery)."""
        own = self.have("protomaps", "world")
        latest = self.latest_build()
        top = extract.WORLD_LOW_ZOOM
        if (
            own
            and own.zooms[1] >= top
            and (not latest or own.edition >= edition(latest[0]))
        ):
            add = "—"
        elif not latest:
            add = "can't reach Protomaps"
        else:
            add = f"z0–{top}, {edition_date(edition(latest[0]))}"
        have = f"z0–{own.zooms[1]}" if own else "—"
        row = [f"Background map, zoomed out (to {top})", have, add]
        return row, (
            lambda: self.basemap_jobs("world", top)
        ) if latest and add != "—" else None

    def basemap_jobs(self, area: str, maxzoom: int | None = None) -> list[Job] | None:
        """The background map of an area, full detail (the world: Protomaps' file)."""
        latest = self.latest_build()
        if not latest:
            ui.say("Can't reach Protomaps (no network?).")
            return None
        build, world_size = latest
        argv = [
            "basemap",
            "--area",
            area,
            "--build",
            build,
            "--basemap-dir",
            str(self.folder),
        ]
        if area == "world" and maxzoom:
            ui.say("Working out its size...")
            size = extract.size(self.folder, build, None, maxzoom) or 0
            argv += ["--maxzoom", str(maxzoom)]
        elif area == "world":
            size = world_size
            argv += ["--size", str(size)]
        else:
            outline = self.index.outline(area, self.folder)
            if not outline:
                ui.say(f"No outline for {self.name(area)} in Geofabrik's index.")
                return None
            ui.say("Working out its size...")
            size = extract.size(self.folder, build, outline) or 0
            argv += ["--outline", str(outline)]
        return [
            Job(
                f"Background map, {self.name(area)}, z0–{maxzoom or 15}"
                f" ({edition_date(edition(build))})",
                argv,
                kept=size,
                download=size,
            )
        ]

    # --- The plan, then the downloads ----------------------------------------------

    def show_plan(self, jobs: list[Job]) -> bool:
        """The plan; whether there's room for it."""
        free = shutil.disk_usage(self.folder).free
        kept = sum(j.kept for j in jobs)
        download = sum(j.download for j in jobs)
        seconds = sum(j.seconds for j in jobs)
        peak = max((j.peak for j in jobs), default=0)
        ui.say("")
        ui.say("Plan")
        for j in jobs:
            ui.say(f" {j.label}")
        line = f" kept ~{ui.human(kept)} · download {ui.human(download)}"
        if seconds:
            rate = self.settings()["max_rate"]
            line += f" · ~{ui.duration(seconds)}" + (
                f" at {rate:g} MB/s" if rate else ""
            )
        ui.say(line)
        if peak:
            ui.say(
                f" needs up to {ui.human(peak)} free while converting ({ui.human(free)} free)"
            )
        missing = kept + peak - free
        if missing > 0:
            ui.say(f" Not enough space: {ui.human(missing)} more is needed.")
        return missing <= 0

    def start(self, jobs: list[Job]) -> int:
        if not jobs:
            return 0
        room = self.show_plan(jobs)
        if self.args.queue_only:
            # build-region.sh: every question first, the downloads after the build.
            if ui.confirm("Download it after the build?", default=room):
                queued = self.queue()
                seen = {tuple(j.argv) for j in queued}
                self.save_queue(queued + [j for j in jobs if tuple(j.argv) not in seen])
                ui.say("Added to the downloads after the build.")
            return 0
        if not (self.args.yes or ui.confirm("Start?", default=room)):
            return 0
        return self.run(jobs)

    def run(self, jobs: list[Job]) -> int:
        """The jobs one after the other, holding the lock; what's left is kept
        for Resume."""
        try:
            with inventory.lock(
                self.folder,
                jobs[0].label if len(jobs) == 1 else f"{len(jobs)} downloads",
            ):
                left = list(jobs)
                self.save_queue(left)
                env = {**os.environ, LOCK_ENV: str(self.folder)}
                for n, job in enumerate(jobs, 1):
                    ui.say("")
                    ui.say(f"[{n}/{len(jobs)}] {job.label}")
                    status = subprocess.run(
                        [sys.executable, "-I", str(SATELLITE_PY), *job.argv],
                        check=False,
                        env=env,
                    ).returncode
                    if status:
                        ui.say(
                            f"Stopped ({status}). What's done is kept: Resume from the menu."
                        )
                        return status
                    left.pop(0)
                    self.save_queue(left)
        except inventory.Busy as busy:
            ui.say(f"Another download is running: {busy}.")
            return 1
        finally:
            self.refresh()
        ui.say("")
        ui.say("Done.")
        return 0

    # --- Remove ---------------------------------------------------------------------

    def remove(self) -> None:
        groups = self.groups()
        if not groups:
            ui.say("Nothing to remove.")
            return
        freeable = {
            id(f.entry): f for f in coverage.could_free(self.entries, self.within)
        }
        rows = []
        for n, (area, source, entries) in enumerate(groups, 1):
            row = [str(n), *self.group_row(area, source, entries)]
            free = [freeable[id(e)] for e in entries if id(e) in freeable]
            if free:
                row[-1] = (row[-1] + "   " if row[-1] else "") + (
                    f"could free {ui.human(sum(f.bytes for f in free))}: {free[0].why}"
                )
            rows.append(row)
        ui.say("")
        ui.say("Remove")
        ui.table(rows, right={4})
        picked = ui.pick_row(len(groups))
        if picked is None:
            return
        area, source, entries = groups[picked]
        if source.units and len(entries) > 1:
            conv = inventory.converter(source)
            units = sorted(e.unit for e in entries)
            chosen = set(
                ui.codes(
                    f"Which {source.units}? [Enter: all {len(units)}]   ? : list\n>",
                    units,
                    normalise=lambda w: w.upper() if w[-1:].isalpha() else w.zfill(2),
                    listing=lambda: ui.columns(
                        [f"{u} {conv.unit_name(u)}" for u in units]
                    ),
                )
            )
            entries = [e for e in entries if e.unit in chosen]
        size = sum(e.bytes for e in entries)
        what = f"{source.label}, {self.name(area)}" + (
            f", {len(entries)} {source.units}" if source.units else ""
        )
        if not ui.confirm(f"Delete {what} ({ui.human(size)})?", default=False):
            return
        for e in entries:
            (self.folder / e.file).unlink(missing_ok=True)
            if source.id == "protomaps":
                (self.folder / f"{e.area}.json").unlink(missing_ok=True)
        ui.say(
            f"Deleted {ui.human(size)}. The map shows it once the scripts update it (start.sh)."
        )
        if source.id == "protomaps":
            # Its large buildings go too.
            self.run([large_buildings_job()])
        self.refresh()

    # --- Settings -------------------------------------------------------------------

    def edit_settings(self) -> None:
        while True:
            values = self.settings()
            rate = values["max_rate"]
            ui.say("")
            ui.say("Settings")
            picked = ui.choose(
                [
                    f"Speed cap: {f'{rate:g} MB/s' if rate else 'none'}",
                    f"Aerial photos' zoom: {values['zoom']}",
                ]
            )
            if picked is None:
                return
            if picked == 0:
                cap = ui.ask("Speed cap in MB/s (0: none):", number(0, 10_000), "0")
                inventory.save_settings(self.folder, {"max_rate": cap or None})
            else:
                zoom = ui.ask(
                    "Zoom for aerial photos (15 to 19):", number(15, 19), "17"
                )
                inventory.save_settings(self.folder, {"zoom": int(zoom)})  # type: ignore[arg-type]

    # --- No questions (the scripts' --yes) -----------------------------------------

    def unattended(self) -> int:
        args = self.args
        if args.queued:
            return self.start(self.queue())
        if args.resume:
            return self.start(self.resume_jobs())
        source = SOURCES[args.source]
        area = args.area or self.region or (source.regions[0] if source.regions else "")
        if source.layer == "overview":
            jobs = self.blue_marble_job()
        elif source.layer == "regional":
            jobs = [
                self.sentinel_job(
                    area, coverage.top_zoom(source, area, self.within).zoom
                )
            ]
        elif source.layer == "basemap":
            zoom = args.zoom if area == "world" else None
            jobs = self.basemap_jobs(area, zoom) or []
        elif source.units:
            conv = inventory.converter(source)
            zoom = args.zoom or self.zoom_offered(source)
            done = coverage.units_done(source, self.entries, zoom)
            units = args.units or [
                u for u in conv.units_in(area, self.within) if u not in done
            ]
            jobs = [self.units_job(source, units, zoom)] if units else []
        else:
            zoom = args.zoom or self.zoom_offered(source)
            jobs = self.tiles_jobs(source, area, zoom) or []
        return self.start(self.complete(jobs))


def large_buildings_job() -> Job:
    return Job(
        "Large buildings, found again from the background maps (shown zoomed out)",
        ["large-buildings"],
        seconds=600,
    )


def edition(build: str) -> str:
    """Protomaps' build file (20261110.pmtiles) as its edition (20261110)."""
    return build.removesuffix(".pmtiles")


def edition_date(value: str) -> str:
    """20261110 as 2026-11-10 (anything else as it is)."""
    return (
        f"{value[:4]}-{value[4:6]}-{value[6:8]}"
        if len(value) == 8 and value.isdigit()
        else value
    )


def short(name: str, width: int = 15) -> str:
    return name if len(name) <= width else name[: width - 1] + "…"


def number(low: float, high: float):
    def check(text: str):
        try:
            value = float(text)
        except ValueError:
            value = None
        if value is None or not low <= value <= high:
            ui.say(f"Type a number from {low:g} to {high:g}.")
            return None
        return value

    return check


def work_zoom(work: Path) -> int | None:
    """The zoom a stopped job was making (its tiles-z17 or warped-z17)."""
    for path in work.glob("*-z*"):
        tail = path.name.split("-z")[-1].split(".")[0]
        if tail.isdigit():
            return int(tail)
    return None


def command_maps(args) -> None:
    maps = Maps(args)
    if args.source or args.resume or args.queued:
        sys.exit(maps.unattended())
    maps.home()
