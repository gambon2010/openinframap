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
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path

from .gdal import pmtiles_zooms
from .sources import SOURCES, Source

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
    if tier == "detailed":  # before there were several sources: IGN's
        return "fr_ign", area, ""
    source = SOURCES.get(tier.removeprefix("detailed-"))
    if not tier.startswith("detailed-") or not source:
        return None
    if source.units:
        unit = converter(source).unit_of(area)
        if unit:
            return source.id, source.regions[0], unit
    return source.id, area, ""


def scan(folder: Path) -> list[Entry]:
    """What the files in data/basemap/ are, and the jobs stopped half-way."""
    entries = []
    for path in sorted(folder.glob("*.pmtiles")):
        what = identify(path.name)
        zooms = pmtiles_zooms(path)
        if not what or not zooms:
            continue
        stat = path.stat()
        entries.append(
            Entry(
                source=what[0],
                area=what[1],
                unit=what[2],
                file=path.name,
                zooms=list(zooms),
                bytes=stat.st_size,
                done=date.fromtimestamp(stat.st_mtime).isoformat(),
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
                    status="running" if busy else "stopped",
                    reason=job["reason"],
                    have=job["have"],
                    of=job["of"],
                )
            )
    return entries


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
    """Held while a download runs; another one meanwhile raises Busy."""
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
