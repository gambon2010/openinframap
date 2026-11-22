"""Fork: building numbers (building_numbers/__init__.py): the order a commune's
buildings are numbered in, as a gridded reference graphic numbers them (ArcGIS's
military tools, ATAK's GRG): from the north-west, in bands across the commune, west
to east then east to west, so buildings side by side get numbers close together.
Buildings added later get the next numbers, in the same order among themselves:
nobody's number changes. Pure."""

from __future__ import annotations

# A band's height (metres): about a block, so a band reads as a row of buildings.
BAND_METRES = 100.0
METRES_PER_DEGREE = 111_320.0


def serpentine(points: list[tuple[float, float]]) -> list[int]:
    """The order of points (lon, lat): by band from the north, each band west to east,
    the next east to west. Returns their indexes in that order."""
    if not points:
        return []
    north = max(lat for _, lat in points)

    def band_of(lat: float) -> int:
        return int((north - lat) * METRES_PER_DEGREE // BAND_METRES)

    def key(index: int) -> tuple[int, float]:
        lon, lat = points[index]
        band = band_of(lat)
        # Odd bands run back east to west.
        along = lon if band % 2 == 0 else -lon
        return band, along

    return sorted(range(len(points)), key=key)


def new_numbers(numbered: dict[int, int], found: dict[int, tuple[float, float]]) -> dict[int, int]:
    """Numbers for the buildings found that have none yet (`numbered`: building id to
    number), following on from the highest, in serpentine order among themselves."""
    new_ids = [building for building in found if building not in numbered]
    order = serpentine([found[building] for building in new_ids])
    first = max(numbered.values(), default=0) + 1
    return {new_ids[index]: first + rank for rank, index in enumerate(order)}


def label(abbreviation: str, number: int) -> str:
    """ "WIS-47": the commune's short code and the building's number."""
    return f"{abbreviation}-{number}"
