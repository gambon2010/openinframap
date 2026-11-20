"""Fork: the terrain files downloaded into data/offline-maps/<area>.terrain.pmtiles
(Mapterhorn's elevation tiles cut to an area: scripts/offline_maps/terrain.py), open
and kept open, picked up again when they change (no restart)."""

from __future__ import annotations

from pathlib import Path

from ..background import OFFLINE_MAPS_DIR
from ..pmtiles_files import ArchiveFolder

SUFFIX = ".terrain.pmtiles"


class TerrainFiles(ArchiveFolder):
    """The terrain files in a folder; a tile from the first that has it (areas side
    by side: a tile on their border is in both, the same)."""

    def __init__(self, folder: Path):
        super().__init__(folder, lambda p: p.name.endswith(SUFFIX))

    def tile(self, z: int, x: int, y: int) -> bytes | None:
        """A tile's WebP bytes, None where no file has it."""
        found = self.first_tile(z, x, y)
        return found[0] if found else None


TERRAIN_FILES = TerrainFiles(OFFLINE_MAPS_DIR)
