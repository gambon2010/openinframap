"""Fork: offline maps, the one menu (satellite.py maps): satellite imagery, aerial
photos and the background map. Home shows what's there (the inventory), then
Resume, Add, Remove, Settings; every question goes through ui.py, every offer
through coverage.py, so nothing pointless or already there is offered.

Downloads run one after the other as satellite.py's own commands (bdortho,
regional, overview, detailed, basemap), holding the offline maps' lock; what's
left of them is kept in data/basemap/queue.json, so Resume goes on after a stop.
docs/plans/offline-maps.md."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from . import coverage, inventory, ui
from .inventory import Entry
from .jobs import Job, large_buildings_job, read_queue, save_queue, work_zoom
from .offers import SourceOffers
from .regions import Index
from .sources import SOURCES, Source

SATELLITE_PY = Path(__file__).resolve().parents[1] / "satellite.py"
# The lock's holder, for the commands it runs (they'd wait for it otherwise).
LOCK_ENV = "OIM_MAPS_LOCK"
LAYER_ORDER = {"overview": 0, "regional": 1, "detailed": 2, "basemap": 3}


class Maps(SourceOffers):
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
        return read_queue(self.folder)

    def save_queue(self, jobs: list[Job]) -> None:
        save_queue(self.folder, jobs)

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
                    normalise=conv.unit_code,
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


def command_maps(args) -> None:
    maps = Maps(args)
    if args.source or args.resume or args.queued:
        sys.exit(maps.unattended())
    maps.home()
