"""Fork: where the terrain is bare ground, so the line of sight adds what stands on
it (obstacles.py): France, where Mapterhorn's terrain is IGN's model (trees and
buildings taken out). Elsewhere it's mostly Copernicus' surface model, which already
holds much of them: adding them again would count them twice. France's outline (its
land and sea, countries.country_eez) is read once from the database and kept."""

from __future__ import annotations

from collections.abc import Callable

import shapely
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

# Simplified for a quick point test (degrees: about 100 m), not for drawing.
SIMPLIFY = 0.001
COUNTRY = "FRA"

_outline: shapely.Geometry | None = None


async def bare_ground_test(database: AsyncConnection) -> Callable[[float, float], bool]:
    """Whether a point (lon, lat) is on bare ground terrain (France)."""
    global _outline
    if _outline is None:
        row = (
            await database.execute(
                text(
                    "SELECT ST_AsBinary(ST_Simplify(ST_Union(geom), :tolerance)) "
                    "FROM countries.country_eez WHERE iso_ter1 = :country"
                ),
                {"tolerance": SIMPLIFY, "country": COUNTRY},
            )
        ).fetchone()
        _outline = shapely.from_wkb(bytes(row[0])) if row and row[0] else shapely.Polygon()
        shapely.prepare(_outline)
    outline = _outline
    return lambda lon, lat: bool(shapely.contains_xy(outline, lon, lat))
