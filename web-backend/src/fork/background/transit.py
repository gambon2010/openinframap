"""Fork: /background/transit/{z}/{x}/{y}.mvt, the trams' and metros' lanes (each
line in its lane, LOOM's: loom_tiles.py), from data/offline-maps/<area>.transit.pmtiles,
the first file that has the tile. A source of its own: its tiles go to zoom 18
(the lanes' offsets are written per zoom), the background map's stop at 15.
Revalidated like the background map's tiles (an ETag from the files)."""

from __future__ import annotations

import zlib
from pathlib import Path

from pmtiles.tile import Compression
from starlette.concurrency import run_in_threadpool
from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from . import MEDIA_TYPE, OFFLINE_MAPS_DIR, Archive

# <area>.transit.pmtiles (loom_tiles.py).
TRANSIT = ".transit.pmtiles"


class TransitFiles:
    """The areas' transit files in a folder, opened again when they change."""

    def __init__(self, folder: Path):
        self.folder = folder
        self.open: dict[Path, Archive] = {}

    def current(self) -> list[Archive]:
        found = []
        for path in sorted(self.folder.glob(f"*{TRANSIT}")):
            if path.name.startswith("."):
                continue  # one being written
            stat = path.stat()
            kept = self.open.get(path)
            if kept is None or kept.stamp != (stat.st_mtime, stat.st_size):
                opened = Archive.open(path)
                if opened is None:
                    continue
                self.open[path] = kept = opened
            found.append(kept)
        return found

    def version(self) -> str:
        stamps = [(a.path.name, a.stamp) for a in self.current()]
        return f"{zlib.crc32(repr(stamps).encode()):08x}"

    def tile(self, z: int, x: int, y: int) -> tuple[bytes, Archive] | None:
        for archive in self.current():
            data = archive.get(z, x, y)
            if data:
                return data, archive
        return None


TRANSIT_FILES = TransitFiles(OFFLINE_MAPS_DIR)


async def transit_tile(request: Request) -> Response:
    try:
        z, x, y = (int(request.path_params[k]) for k in ("z", "x", "y"))
    except ValueError:
        return Response(status_code=404)
    etag = f'"{await run_in_threadpool(TRANSIT_FILES.version)}"'
    headers = {"Cache-Control": "no-cache", "ETag": etag}
    if request.headers.get("if-none-match") == etag:
        return Response(status_code=304, headers=headers)
    found = await run_in_threadpool(TRANSIT_FILES.tile, z, x, y)
    if not found:
        return Response(status_code=204, headers={"Cache-Control": "no-store"})
    data, archive = found
    if archive.header["tile_compression"] == Compression.GZIP:
        headers["Content-Encoding"] = "gzip"
    return Response(data, media_type=MEDIA_TYPE, headers=headers)


routes = [Route("/background/transit/{z}/{x}/{y}.mvt", transit_tile)]
