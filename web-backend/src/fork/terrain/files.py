"""Fork: the terrain files downloaded into data/offline-maps/<area>.terrain.pmtiles
(Mapterhorn's elevation tiles cut to an area: scripts/offline_maps/terrain.py), open
and kept open, picked up again when they change (no restart)."""

from __future__ import annotations

import zlib
from pathlib import Path

from ..background import OFFLINE_MAPS_DIR, Archive

SUFFIX = ".terrain.pmtiles"


class TerrainFiles:
    """The terrain files in a folder; a tile from the first that has it (areas side
    by side: a tile on their border is in both, the same)."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.open: dict[Path, Archive] = {}
        self.seen: tuple = ()

    def archives(self) -> list[Archive]:
        try:
            paths = sorted(p for p in self.folder.glob(f"*{SUFFIX}") if not p.name.startswith("."))
            listing = tuple((p, p.stat().st_mtime, p.stat().st_size) for p in paths)
        except OSError:
            return []
        if listing != self.seen:
            self.seen = listing
            opened = {path: self.reopened(path, (mtime, size)) for path, mtime, size in listing}
            self.open = {path: archive for path, archive in opened.items() if archive}
        return list(self.open.values())

    def reopened(self, path: Path, stamp: tuple[float, int]) -> Archive | None:
        """The file open: the one already open if unchanged."""
        old = self.open.get(path)
        return old if old and old.stamp == stamp else Archive.open(path)

    def version(self) -> str:
        """Changes when any file does: the tiles' ETag."""
        self.archives()
        return f"{zlib.crc32(repr(self.seen).encode()):08x}"

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        """A tile's WebP bytes, None where no file has it."""
        for archive in self.archives():
            data = archive.get(z, x, y)
            if data:
                return data
        return None


TERRAIN_FILES = TerrainFiles(OFFLINE_MAPS_DIR)
