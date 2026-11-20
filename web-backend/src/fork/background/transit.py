"""Fork: /background/transit/{z}/{x}/{y}.mvt, the trams' and metros' lanes (each
line in its lane, LOOM's: background_build/loom_tiles.py), from
data/offline-maps/<area>.transit.pmtiles, the first file that has the tile. A source
of its own: its tiles go to zoom 18 (the lanes' offsets are written per zoom), the
background map's stop at 15. Answered like the background map's tiles
(tile_answers.py)."""

from __future__ import annotations

from starlette.requests import Request
from starlette.responses import Response
from starlette.routing import Route

from ..pmtiles_files import ArchiveFolder
from ..tile_answers import tile_response
from . import MEDIA_TYPE, OFFLINE_MAPS_DIR

# <area>.transit.pmtiles (background_build/loom_tiles.py).
TRANSIT = ".transit.pmtiles"


TRANSIT_FILES = ArchiveFolder(OFFLINE_MAPS_DIR, lambda p: p.name.endswith(TRANSIT))


def transit_tile_data(z: int, x: int, y: int) -> bytes | None:
    found = TRANSIT_FILES.first_tile(z, x, y)
    return found[0] if found else None


async def transit_tile(request: Request) -> Response:
    return await tile_response(request, TRANSIT_FILES.version, transit_tile_data, MEDIA_TYPE)


routes = [Route("/background/transit/{z}/{x}/{y}.mvt", transit_tile)]
