"""Fork: building numbers (building_numbers/__init__.py): an area's numbers, worked out
from the background map's buildings when they're asked for (numbering.py's order) and
kept in memory for that map; nothing is stored (the owner's choice, 2026-11-23: every
computer with the same map file has the same numbers, with no register to grow or to
share). A newer background map can shift an area's numbers."""

from __future__ import annotations

import asyncio
import json
from collections import OrderedDict
from dataclasses import dataclass

from shapely.geometry import shape
from starlette.concurrency import run_in_threadpool

from ..background import ARCHIVES
from .buildings import buildings_in
from .numbering import new_numbers

# Areas kept worked out (a city's neighbourhood: a few thousand buildings, a few
# hundred kilobytes); the least recently asked for is forgotten first.
AREAS_REMEMBERED = 64


@dataclass(frozen=True)
class AreaNumbers:
    """An area's buildings: each one's number and a point inside it (lon, lat), and
    its slivers' points (not numbered, left out of the map's flat buildings)."""

    numbers: dict[int, int]
    points: dict[int, tuple[float, float]]
    slivers: dict[int, tuple[float, float]]

    def building_numbered(self, number: int) -> int | None:
        """The building with that number, if any."""
        return next((building for building, n in self.numbers.items() if n == number), None)


_remembered: OrderedDict[tuple[str, str], AreaNumbers] = OrderedDict()
_working: dict[tuple[str, str], asyncio.Lock] = {}


async def area_numbers(code: str, outline_geojson: str) -> AreaNumbers:
    """An area's numbers for the background map in use: remembered, else worked out
    (a few seconds for a city's neighbourhood; once, when two ask at the same time)."""
    key = (code, ARCHIVES.version())
    lock = _working.setdefault(key, asyncio.Lock())
    async with lock:
        if key not in _remembered:
            found = await run_in_threadpool(buildings_in, shape(json.loads(outline_geojson)))
            remember(key, AreaNumbers(new_numbers({}, found.buildings), found.buildings, found.slivers))
    _working.pop(key, None)
    _remembered.move_to_end(key)
    return _remembered[key]


def remember(key: tuple[str, str], numbers: AreaNumbers) -> None:
    _remembered[key] = numbers
    while len(_remembered) > AREAS_REMEMBERED:
        _remembered.popitem(last=False)
