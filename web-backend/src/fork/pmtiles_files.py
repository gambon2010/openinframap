"""Fork: the PMTiles files the backend serves from data/map/offline-maps/ (the background
maps and their companions, the trams' lanes, the terrain): a file open (Archive),
and the files of one kind in the folder (ArchiveFolder), opened again when they
change, so a download shows without a restart."""

from __future__ import annotations

import mmap
import zlib
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path
from typing import Any

from pmtiles.tile import deserialize_directory, deserialize_header, find_tile, zxy_to_tileid


class Archive:
    """One PMTiles file, open: read through mmap, each directory of its
    index read once (a big file's leaves: gzip, then varints). The pmtiles package's
    own Reader decodes them again for every tile, with no cache: 5 ms a tile against
    0.01 ms here, measured on France's background map (2026-11-20)."""

    def __init__(self, path: Path, data: mmap.mmap, header: Any, stamp: tuple[float, int]):
        self.path = path
        self.data = data
        self.header = header
        self.stamp = stamp  # (mtime, size): changed, opened again
        self.directory = lru_cache(maxsize=2048)(self._directory)

    @classmethod
    def open(cls, path: Path) -> Archive | None:
        try:
            stat = path.stat()
            with path.open("rb") as f:
                data = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
            header = deserialize_header(data[:127])
        except Exception:  # noqa: BLE001 — not a PMTiles file (yet): left out
            return None
        return cls(path, data, header, (stat.st_mtime, stat.st_size))

    def _directory(self, offset: int, length: int) -> list:
        return deserialize_directory(self.data[offset : offset + length])

    @property
    def area(self) -> str:
        return self.path.stem

    def get(self, z: int, x: int, y: int) -> bytes | None:
        """A tile's bytes as stored (gzip for Protomaps' files), None if not here."""
        h = self.header
        if not h["min_zoom"] <= z <= h["max_zoom"]:
            return None
        tile_id = zxy_to_tileid(z, x, y)
        offset, length = h["root_offset"], h["root_length"]
        for _ in range(4):  # the most levels of directories PMTiles has
            entry = find_tile(self.directory(offset, length), tile_id)
            if entry is None:
                return None
            if entry.run_length == 0:  # a leaf directory
                offset, length = h["leaf_directory_offset"] + entry.offset, entry.length
                continue
            start = h["tile_data_offset"] + entry.offset
            return self.data[start : start + entry.length]
        return None

    def tile_ids(self):
        """Every tile id in the file, from its directories (no tile read)."""
        h = self.header

        def walk(offset: int, length: int):
            for entry in self.directory(offset, length):
                if entry.run_length:
                    yield from range(entry.tile_id, entry.tile_id + entry.run_length)
                else:
                    yield from walk(h["leaf_directory_offset"] + entry.offset, entry.length)

        yield from walk(h["root_offset"], h["root_length"])


class ArchiveFolder:
    """The files of one kind in a folder (`wanted`: by their path; a name starting
    with a dot is one being written), each kept open while it doesn't change."""

    def __init__(self, folder: Path, wanted: Callable[[Path], bool]):
        self.folder = folder
        self.wanted = wanted
        self.open: dict[Path, Archive] = {}
        self.seen: tuple = ()

    def archives(self) -> list[Archive]:
        """The files there now, in name order."""
        try:
            paths = sorted(p for p in self.folder.iterdir() if self.wanted(p) and not p.name.startswith("."))
            listing = tuple((p, p.stat().st_mtime, p.stat().st_size) for p in paths)
        except OSError:
            return []
        if listing != self.seen:
            self.seen = listing
            opened = {path: self.reopened(path, (mtime, size)) for path, mtime, size in listing}
            self.open = {path: archive for path, archive in opened.items() if archive}
        return list(self.open.values())

    def reopened(self, path: Path, stamp: tuple[float, int]) -> Archive | None:
        """A file open: the one already open if unchanged."""
        old = self.open.get(path)
        return old if old and old.stamp == stamp else Archive.open(path)

    def get(self, path: Path) -> Archive | None:
        """A file of the folder by its path, if it's open (as of the last archives())."""
        return self.open.get(path)

    def named(self, name: str) -> Archive | None:
        """A file of the folder by its name, as the folder is now (a name that isn't
        one of its files, such as one with a path in it, finds nothing)."""
        return next((a for a in self.archives() if a.path.name == name), None)

    def version(self) -> str:
        """Changes when any of the files does (added, rebuilt, removed): the tiles'
        ETag, so the browser keeps a tile only as long as its files are the same."""
        self.archives()
        return f"{zlib.crc32(repr(self.seen).encode()):08x}"

    def first_tile(self, z: int, x: int, y: int) -> tuple[bytes, Archive] | None:
        """A tile from the first file (in name order) that has it."""
        for archive in self.archives():
            data = archive.get(z, x, y)
            if data:
                return data, archive
        return None
