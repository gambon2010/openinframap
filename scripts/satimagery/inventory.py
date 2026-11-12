"""Fork: offline maps. What's in data/basemap/: the inventory (inventory.json), the
settings (settings.json) and the lock a running download holds.

Files are the truth, the inventory is notes: it's made again from the files on
every start (a file without an entry gets one, read from its name and header;
an entry whose file is gone is dropped), keeping what only the notes know (a
file's edition, when it was made). Work folders of jobs stopped half-way become
entries too ("stopped"), so the menu can offer to resume them."""

from __future__ import annotations

import contextlib
import fcntl
import importlib
import json
import os
import time
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from .extract import manifest_edition
from .pmtiles import read_header
from .sources import SOURCES, Source
from .ui import human

INVENTORY = "inventory.json"
SETTINGS = "settings.json"
LOCK = ".offline-maps.lock"
# Settings asked once: a speed cap (MB/s, None: none), the aerial photos' zoom.
DEFAULT_SETTINGS = {"max_rate": None, "zoom": 17}


@dataclass
class Entry:
    source: str  # its id (sources/<id>.py)
    area: str  # a Geofabrik region, or "world"
    file: str  # in data/basemap/ (a job: its work folder)
    unit: str = ""  # a source fetched by unit: which (a département's code)
    zooms: list[int] = field(default_factory=list)  # [first, last]
    bytes: int = 0
    edition: str = ""  # the source's date for it (IGN: 2024-01-01), if known
    done: str = ""  # when it was made (YYYY-MM-DD)
    status: str = "done"  # done, stopped or running (a job)
    reason: str = ""  # why a job stopped, if it said
    have: int = 0  # a job: bytes downloaded so far
    of: int = 0  # a job: about how many to download


def converter(source: Source):
    """The module that fetches a source by units (bdortho for IGN)."""
    return importlib.import_module(f"{__package__}.{source.address}")


def identify(name: str) -> tuple[str, str, str] | None:
    """(source, area, unit) of a file in data/basemap/, from its name, None if it
    isn't an offline map: <area>.pmtiles (the background map),
    <area>.sat-overview / -regional / -detailed-<source>.pmtiles."""
    if not name.endswith(".pmtiles") or name.startswith("."):
        return None
    stem = name.removesuffix(".pmtiles")
    if ".sat-" not in stem:
        return None if "." in stem else ("protomaps", stem, "")
    area, tier = stem.rsplit(".sat-", 1)
    if tier == "overview":
        return "blue_marble", area, ""
    if tier == "regional":
        return "sentinel2", area, ""
    source = SOURCES.get(tier.removeprefix("detailed-"))
    if not tier.startswith("detailed-") or not source:
        return None
    if source.units:
        unit = converter(source).unit_of(area)
        if unit:
            return source.id, source.regions[0], unit
    return source.id, area, ""


def attribution_for(name: str) -> str:
    """The credit line of an imagery file, from its name ("" if it isn't one). The
    scripts pass it to the frontend with the file (VITE_SATELLITE_TIERS): the
    sources' credits are the only list."""
    what = identify(Path(name).name)
    return SOURCES[what[0]].credit if what else ""


# --- What the map is told (VITE_SATELLITE_TIERS) ----------------------------------

# In the order the map stacks them: Blue Marble, Sentinel-2, aerial photos.
IMAGERY_LAYERS = ("overview", "regional", "detailed")


def imagery_files(folder: Path) -> list[tuple[Path, Source]]:
    """The imagery files shown on the map, coarsest first: the world's Blue Marble
    (a region's own, made before the world's, isn't), Sentinel-2 (the world's
    first), then the aerial photos."""
    found = []
    for path in sorted(folder.glob("*.sat-*.pmtiles")):
        what = identify(path.name)
        if not what or SOURCES[what[0]].layer not in IMAGERY_LAYERS:
            continue
        source = SOURCES[what[0]]
        world = path.name.startswith("world.")
        if source.layer == "overview" and not world:
            continue
        found.append(
            (IMAGERY_LAYERS.index(source.layer), not world, path.name, path, source)
        )
    return [(path, source) for *_, path, source in sorted(found)]


def imagery_tiers(folder: Path, server: str) -> str:
    """The imagery as the frontend reads it (fork/modules/satellite):
    "URL MINZOOM MAXZOOM [W,S,E,N]|CREDIT;..." ("" if there's none). Each file over
    the zooms its header says (Sentinel-2 never before its source's first zoom:
    further out, Blue Marble shows), with its bounds, so the map only asks the
    files that cover what's on screen (one per French département)."""
    tiers = []
    for path, source in imagery_files(folder):
        header = read_header(path)
        if not header:
            continue
        first = (
            max(header.minzoom, source.first_zoom)
            if source.layer == "regional"
            else header.minzoom
        )
        bounds = (
            " " + ",".join(f"{v:.5f}" for v in header.bounds) if header.bounds else ""
        )
        ext = header.format or source.format
        tiers.append(
            f"{server}/{path.stem}/{{z}}/{{x}}/{{y}}.{ext} {first} {header.maxzoom}{bounds}|{source.credit}"
        )
    return ";".join(tiers)


def imagery_summary(folder: Path) -> str:
    """ "world overview, france regional, IGN photos of 2 départements (3.4 GB)":
    the imagery there is and its size ("none" if there's none)."""
    files = imagery_files(folder)
    if not files:
        return "none"
    names, units = [], {}
    for path, source in files:
        if source.units and identify(path.name)[2]:  # type: ignore[index]
            units[source.id] = units.get(source.id, 0) + 1
        else:
            names.append(path.stem.replace(".sat-", " "))
    for source_id, count in units.items():
        source = SOURCES[source_id]
        names.append(
            f"{source.name} photos of {count} {source.units if count > 1 else source.units.rstrip('s')}"
        )
    total = sum(path.stat().st_size for path, _ in files)
    return f"{', '.join(names)} ({human(total)})"


def scan(folder: Path) -> list[Entry]:
    """What the files in data/basemap/ are, and the jobs stopped half-way."""
    entries = []
    for path in sorted(folder.glob("*.pmtiles")):
        what = identify(path.name)
        header = read_header(path)
        if not what or not header:
            continue
        stat = path.stat()
        entries.append(
            Entry(
                source=what[0],
                area=what[1],
                unit=what[2],
                file=path.name,
                zooms=list(header.zooms),
                bytes=stat.st_size,
                done=date.fromtimestamp(stat.st_mtime).isoformat(),
                edition=manifest_edition(path) if what[0] == "protomaps" else "",
            )
        )
    busy = running(folder)
    for source in SOURCES.values():
        if not source.units:
            continue
        for job in converter(source).jobs(folder):
            entries.append(
                Entry(
                    source=source.id,
                    area=source.regions[0],
                    unit=job["unit"],
                    file=job["work"],
                    edition=job["edition"],
                    status="running"
                    if busy or written_lately(folder / job["work"])
                    else "stopped",
                    reason=job["reason"],
                    have=job["have"],
                    of=job["of"],
                )
            )
    return entries


# A work folder written to this recently is a download running (even one started
# without the lock: a second one there would spoil both).
LATELY_SECONDS = 120


def written_lately(work: Path) -> bool:
    now = time.time()
    return any(
        now - f.stat().st_mtime < LATELY_SECONDS for f in work.rglob("*") if f.is_file()
    )


def load(folder: Path) -> list[Entry]:
    """The inventory, made again from the files (and written), keeping the notes
    of files that are still there."""
    notes = {e.file: e for e in read(folder)}
    entries = scan(folder)
    for e in entries:
        old = notes.get(e.file)
        if old and e.status == "done":
            e.edition = e.edition or old.edition
            e.done = old.done or e.done
    write(folder, entries)
    return entries


def read(folder: Path) -> list[Entry]:
    try:
        rows = json.loads((folder / INVENTORY).read_text())
        return [Entry(**row) for row in rows]
    except (OSError, ValueError, TypeError):
        return []


def write(folder: Path, entries: list[Entry]) -> None:
    path = folder / INVENTORY
    partial = path.with_suffix(".partial")
    partial.write_text(json.dumps([asdict(e) for e in entries], indent=1) + "\n")
    partial.replace(path)


def record(folder: Path, file: str, **notes) -> None:
    """Note what only the downloader knows about a file just made (its edition)."""
    entries = load(folder)
    for e in entries:
        if e.file == file:
            for key, value in notes.items():
                setattr(e, key, value)
    write(folder, entries)


# --- Settings ----------------------------------------------------------------------


def settings(folder: Path) -> dict:
    try:
        saved = json.loads((folder / SETTINGS).read_text())
    except (OSError, ValueError):
        saved = {}
    return {**DEFAULT_SETTINGS, **saved}


def save_settings(folder: Path, values: dict) -> None:
    (folder / SETTINGS).write_text(json.dumps({**settings(folder), **values}) + "\n")


# --- The lock: one download at a time ---------------------------------------------


class Busy(Exception):
    """Another download holds the lock (its description is the message)."""


@contextlib.contextmanager
def lock(folder: Path, what: str):
    """Held while a download runs; another one meanwhile raises Busy. A command
    the menu runs, holding it, goes ahead (OIM_MAPS_LOCK: the folder)."""
    if os.environ.get("OIM_MAPS_LOCK") == str(folder.resolve()):
        yield
        return
    path = folder / LOCK
    handle = path.open("a+")
    try:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        handle.close()
        raise Busy(running(folder) or "another download") from None
    handle.seek(0)
    handle.truncate()
    handle.write(f"{what} (process {os.getpid()})")
    handle.flush()
    try:
        yield
    finally:
        handle.seek(0)
        handle.truncate()
        handle.close()


def running(folder: Path) -> str | None:
    """What the running download is, None if none holds the lock."""
    path = folder / LOCK
    if not path.exists():
        return None
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_SH | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.seek(0)
            return handle.read().strip() or "a download"
        fcntl.flock(handle, fcntl.LOCK_UN)
    return None
