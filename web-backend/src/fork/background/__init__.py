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
service, not here. Files are read through mmap, each file's index cached, and
picked up again when they change (no restart)."""

from __future__ import annotations

import gzip
import json
import mmap
from functools import lru_cache
from pathlib import Path
from typing import Any

from pmtiles.tile import Compression, deserialize_directory, deserialize_header, find_tile, zxy_to_tileid
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from ..paths import LOCAL_DATA_DIR
from . import mvt

OFFLINE_MAPS_DIR = LOCAL_DATA_DIR / "offline-maps"
WORLD = "world"
MEDIA_TYPE = "application/vnd.mapbox-vector-tile"
CACHE_SECONDS = 3600
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


class Archive:
    """One background map file, open: read through mmap, each directory of its
    index read once (a big file's leaves: gzip, then varints)."""

    def __init__(self, path: Path, data: mmap.mmap, header: Any, stamp: tuple[float, int]):
        self.path = path
        self.data = data
        self.header = header
        self.stamp = stamp  # (mtime, size): changed, opened again
        self.edition = edition_of(path)  # Protomaps' build (20261014), "" if unknown
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


def edition_of(path: Path) -> str:
    """Protomaps' build a file was cut from (its manifest: "20261014.pmtiles")."""
    try:
        build = json.loads(path.with_suffix(".json").read_text()).get("build", "")
    except (OSError, ValueError, AttributeError):
        return ""
    return build.removesuffix(".pmtiles")


class Archives:
    """The background map files in a folder, in the order they're tried, and their
    companions."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.open: dict[Path, Archive] = {}
        self.seen: tuple = ()

    def ordered(self) -> list[Archive]:
        try:
            paths = sorted(
                p for p in self.folder.iterdir() if is_background_map(p) or p.name.endswith(COMPANION)
            )
            listing = tuple((p, p.stat().st_mtime, p.stat().st_size) for p in paths)
        except OSError:
            return []
        if listing != self.seen:
            self.seen = listing
            kept = {}
            for path, mtime, size in listing:
                old = self.open.get(path)
                archive = old if old and old.stamp == (mtime, size) else Archive.open(path)
                if archive:
                    kept[path] = archive
            self.open = kept
        # Newest edition first (unknown last); the whole world last of all.
        archives = sorted((a for a in self.open.values() if is_background_map(a.path)), key=lambda a: a.area)
        archives.sort(key=lambda a: a.edition, reverse=True)
        archives.sort(key=lambda a: a.area == WORLD)
        return archives

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
                companion = self.open.get(companion_of(archive.path))
                data = companion.get(z, x, y) if companion else None
                if companion and data:
                    return data, companion
        return None

    def with_companion(self, data: bytes, archive: Archive, z: int, x: int, y: int) -> bytes:
        """The tile with its area's companion tile appended (both unzipped, then
        zipped again as the area's tiles are), the companion's layers replacing the
        tile's of the same name (its roads)."""
        companion = self.open.get(companion_of(archive.path))
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
    found = await run_in_threadpool(ARCHIVES.tile, z, x, y)
    if not found:
        # Never kept by the browser: the area may be downloaded a minute later.
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    headers = {"Cache-Control": f"max-age={CACHE_SECONDS}"}
    data, archive = found
    if archive.header["tile_compression"] == Compression.GZIP:
        headers["Content-Encoding"] = "gzip"
    return Response(data, media_type=MEDIA_TYPE, headers=headers)


routes = [Route("/background/{z}/{x}/{y}.mvt", background_tile)]
