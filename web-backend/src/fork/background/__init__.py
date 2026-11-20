"""Fork: the background map's tiles (roads, buildings, water, place names), from
the background maps downloaded into data/offline-maps/<area>.pmtiles (Protomaps'
world map cut to an area: scripts/offline_maps/extract.py).

/background/{z}/{x}/{y}.mvt answers each tile from the first file that has it,
so several areas show together. A tile along a border is in both areas' files
(a tile is a whole square), the same tile when they come from the same
Protomaps edition: it's sent once, nothing is drawn twice. Files are tried
newest edition first (the build in <area>.json), the whole world's last (the
fallback). No file has it: 204, an empty tile, as pmtiles serve answers.

At zooms 6 to 15, the tile of the area's companion, <area>.zoomed-out.pmtiles
(what the background map leaves out zoomed out, zoomed_out.py), is appended to
it: a tile is a list of layers, so the two laid end to end are one tile with the
layers of both. The companion's roads replace the background map's (its roads
layer is dropped, mvt.py): the same roads, with what Protomaps leaves out there.

The satellite imagery files (*.sat-*.pmtiles) are served by the "satellite"
service, not here. Files are read through mmap, each file's index cached (pmtiles_files.py), and
picked up again when they change (no restart)."""

from __future__ import annotations

import gzip
import json
from functools import lru_cache
from pathlib import Path

from pmtiles.tile import Compression
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from ..paths import LOCAL_DATA_DIR
from ..pmtiles_files import Archive, ArchiveFolder
from . import mvt

OFFLINE_MAPS_DIR = LOCAL_DATA_DIR / "offline-maps"
WORLD = "world"
MEDIA_TYPE = "application/vnd.mapbox-vector-tile"
# What the background map leaves out zoomed out: <area>.zoomed-out.pmtiles, these
# zooms (zoomed_out.py).
COMPANION = ".zoomed-out.pmtiles"
COMPANION_ZOOMS = range(6, 16)


def is_background_map(path: Path) -> bool:
    """<area>.pmtiles: not satellite imagery (<area>.sat-*), a companion
    (<area>.zoomed-out.pmtiles), nor a partial download."""
    return path.suffix == ".pmtiles" and "." not in path.stem and not path.name.startswith(".")


def companion_of(background_map: Path) -> Path:
    return background_map.with_name(background_map.stem + COMPANION)


def edition_of(path: Path) -> str:
    """Protomaps' build a file was cut from (its manifest: "20261014.pmtiles")."""
    try:
        build = json.loads(path.with_suffix(".json").read_text()).get("build", "")
    except (OSError, ValueError, AttributeError):
        return ""
    return build.removesuffix(".pmtiles")


@lru_cache(maxsize=256)
def edition(path: Path, stamp: tuple[float, int]) -> str:
    """A background map's edition, read once per version of the file (`stamp`)."""
    return edition_of(path)


class Archives:
    """The background map files in a folder, in the order they're tried, and their
    companions."""

    def __init__(self, folder: Path):
        self.files = ArchiveFolder(folder, lambda p: is_background_map(p) or p.name.endswith(COMPANION))

    def ordered(self) -> list[Archive]:
        """The background maps (not their companions): newest edition first (unknown
        last), the whole world last of all."""
        archives = sorted(
            (a for a in self.files.archives() if is_background_map(a.path)), key=lambda a: a.area
        )
        archives.sort(key=lambda a: edition(a.path, a.stamp), reverse=True)
        archives.sort(key=lambda a: a.area == WORLD)
        return archives

    def version(self) -> str:
        """The tiles' ETag (ArchiveFolder.version)."""
        return self.files.version()

    def tile(self, z: int, x: int, y: int) -> tuple[bytes, Archive] | None:
        archives = self.ordered()
        for archive in archives:
            data = archive.get(z, x, y)
            if data:
                if z in COMPANION_ZOOMS:
                    data = self.with_companion(data, archive, z, x, y)
                return data, archive
        if z in COMPANION_ZOOMS:
            # No background tile there (Protomaps leaves a few out), the companion's
            # still: its tile alone.
            for archive in archives:
                companion = self.files.get(companion_of(archive.path))
                data = companion.get(z, x, y) if companion else None
                if companion and data:
                    return data, companion
        return None

    def with_companion(self, data: bytes, archive: Archive, z: int, x: int, y: int) -> bytes:
        """The tile with its area's companion tile appended (both unzipped, then
        zipped again as the area's tiles are), the companion's layers replacing the
        tile's of the same name (its roads)."""
        companion = self.files.get(companion_of(archive.path))
        extra = companion.get(z, x, y) if companion else None
        if not extra:
            return data
        gzipped = archive.header["tile_compression"] == Compression.GZIP
        extra = unzipped(extra)
        replaced = {name for name, _ in mvt.layers(extra)}
        joined = mvt.drop(unzipped(data), replaced) + extra
        return gzip.compress(joined, compresslevel=1, mtime=0) if gzipped else joined


def unzipped(data: bytes) -> bytes:
    return gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data


ARCHIVES = Archives(OFFLINE_MAPS_DIR)


async def background_tile(request: Request) -> Response:
    try:
        z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
    except ValueError:
        return Response(status_code=404)
    if not (0 <= z <= 22 and 0 <= x < 2**z and 0 <= y < 2**z):
        return Response(status_code=404)
    # Kept by the browser, but asked again each time: the same files, "not modified"
    # (no tile read); a file rebuilt, the new tile (an hour's cache showed old
    # tiles beside new ones after a rebuild).
    etag = f'"{await run_in_threadpool(ARCHIVES.version)}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    found = await run_in_threadpool(ARCHIVES.tile, z, x, y)
    if not found:
        # Never kept by the browser: the area may be downloaded a minute later.
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    data, archive = found
    if archive.header["tile_compression"] == Compression.GZIP:
        headers["Content-Encoding"] = "gzip"
    return Response(data, media_type=MEDIA_TYPE, headers=headers)


routes = [Route("/background/{z}/{x}/{y}.mvt", background_tile)]
