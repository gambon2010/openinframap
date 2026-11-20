"""Fork: offline maps. What each source offers an area in the menu's Add table
(what's there, what can be added: through coverage.py), and the downloads (jobs)
picking it makes: Blue Marble, Sentinel-2, aerial photos by unit (IGN's
départements) or from a tile server, background maps. A part of the menu (Maps
in maps.py takes it in): it reads the menu's folder, regions, inventory and
settings."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from . import coverage, extract, inventory, terrain, ui
from .aerial import detailed_file, detailed_job, job_estimate
from .bdortho import DOWNLOAD_BYTES_PER_SECOND
from .inventory import Entry
from .jobs import Job
from .regions import Index
from .sources import BLUE_MARBLE, SENTINEL2, SOURCES, Source
from .tiles import area_km2, load_rings

# Free space a département needs while it's converted, over its archive's size
# (the archive, its images, the reprojected image).
CONVERT_ROOM = 2.1


def short(name: str, width: int = 15) -> str:
    return name if len(name) <= width else name[: width - 1] + "…"


# A row of the Add table, and what picking it does (the jobs to run; None: nothing
# to add there).
Offer = tuple[list[str], Callable[[], list[Job]] | None]


class SourceOffers:
    """The menu's offers and jobs, source by source (mixed into maps.Maps, which
    gives the methods below that raise)."""

    folder: Path
    index: Index
    entries: list[Entry]

    def within(self, a: str, b: str) -> bool:
        raise NotImplementedError  # maps.Maps

    def name(self, area: str) -> str:
        raise NotImplementedError  # maps.Maps

    def settings(self) -> dict:
        raise NotImplementedError  # maps.Maps

    def stopped(self) -> list[Entry]:
        raise NotImplementedError  # maps.Maps

    def km2(self, area: str) -> float:
        if area == "world":
            return SENTINEL2.sizes["world_land_km2"]
        outline = self.index.outline(area, self.folder)
        return area_km2(load_rings(str(outline))) if outline else 0

    def offers(self, area: str) -> list[Offer]:
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
        if extract.zoomed_out_missing(self.folder, area):
            rows.append(self.zoomed_out_offer(area))
        if terrain.terrain_missing(self.folder, area):
            rows.append(self.terrain_offer(area))
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

    def complete(self, jobs: list[Job]) -> list[Job]:
        """What comes with any choice: Blue Marble with imagery, the world's
        background map zoomed out."""
        return self.with_world_background(self.with_blue_marble(jobs))

    def with_world_background(self, jobs: list[Job]) -> list[Job]:
        """The whole world's background map to zoom 8 (every country's borders,
        names, coasts; 560 MB) comes with anything, once: like Blue Marble."""
        if not jobs or self.have("protomaps", "world"):
            return jobs
        if any(j.argv[:3] == ["basemap", "--area", "world"] for j in jobs):
            return jobs
        return (self.basemap_jobs("world", extract.WORLD_LOW_ZOOM) or []) + jobs

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
                normalise=conv.unit_code,
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
            "--maps-dir",
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
        newest = extract.edition(latest[0]) if latest else ""
        have = extract.edition_date(own.edition) if own else "—"
        if cover and cover.area != area:
            add = f"— (covered by {self.name(cover.area)})"
        elif not latest:
            add = "can't reach Protomaps"
        elif own and own.zooms[1] < protomaps.last_zoom:
            add = f"all zooms, {extract.edition_date(newest)}"
        elif own and own.edition >= newest:
            add = "— (the latest)"
        elif own:
            add = f"newer: {extract.edition_date(newest)}"
        else:
            add = f"z0–15, {extract.edition_date(newest)}"
        offered = latest and not add.startswith("—")
        return ["Background map", have, add], (
            lambda: self.basemap_jobs(area)
        ) if offered else None

    def zoomed_out_offer(self, area: str):
        """The buildings and roads zoomed out of a background map already there (made with
        each download; offered for one made before, or if making them failed)."""
        size = (self.folder / f"{area}.pmtiles").stat().st_size
        job = Job(
            f"Buildings, roads and railways zoomed out, {self.name(area)}",
            ["zoomed-out", "--area", area, "--maps-dir", str(self.folder)],
            kept=round(size * extract.ZOOMED_OUT_SIZE),
            seconds=size * extract.ZOOMED_OUT_SECONDS_PER_BYTE,
        )
        row = [
            "Buildings, roads and railways zoomed out (z6–15)",
            "—",
            ui.human(job.kept),
        ]
        return row, lambda: [job]

    def terrain_offer(self, area: str):
        """The terrain of a background map already there (it comes with each
        download; offered for one made before, or if downloading it failed)."""
        outline = self.index.outline(area, self.folder)
        job = Job(
            f"Terrain, {self.name(area)}",
            [
                "terrain",
                "--area",
                area,
                "--outline",
                str(outline),
                "--maps-dir",
                str(self.folder),
            ],
            kept=self.terrain_bytes(area),
            download=self.terrain_bytes(area),
        )
        row = [
            f"Terrain (contours, shading, 3D; z0–{terrain.MAX_ZOOM})",
            "—",
            ui.human(job.kept),
        ]
        return row, lambda: [job]

    def terrain_bytes(self, area: str) -> int:
        return round(self.km2(area) * terrain.BYTES_PER_KM2)

    def world_low_offer(self):
        """The whole world's background map zoomed out (to zoom 8): every
        country's borders and names, small (like Blue Marble for imagery)."""
        own = self.have("protomaps", "world")
        latest = self.latest_build()
        top = extract.WORLD_LOW_ZOOM
        if (
            own
            and own.zooms[1] >= top
            and (not latest or own.edition >= extract.edition(latest[0]))
        ):
            add = "—"
        elif not latest:
            add = "can't reach Protomaps"
        else:
            add = f"z0–{top}, {extract.edition_date(extract.edition(latest[0]))}"
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
            "--maps-dir",
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
            # Its terrain comes with it (terrain.py).
            size = (
                extract.size(self.folder, build, outline) or 0
            ) + self.terrain_bytes(area)
            argv += ["--outline", str(outline)]
        with_terrain = " and terrain" if area != "world" else ""
        return [
            Job(
                f"Background map{with_terrain}, {self.name(area)}, z0–{maxzoom or 15}"
                f" ({extract.edition_date(extract.edition(build))})",
                argv,
                kept=size,
                download=size,
            )
        ]
