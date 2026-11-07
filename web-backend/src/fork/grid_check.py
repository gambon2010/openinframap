"""
Fork: check the power grid network for lines that stop at nothing.

Every line of MIN_VOLTAGE and more is followed (line_trace/) to its ends. A big
line ends at a substation, a power plant, or the edge of the built region (it goes
on outside); anywhere else is a loose end: the line's data in OpenStreetMap is
probably wrong there, or the rules connecting lines are. Prints counts by reason
and writes every loose end to a CSV with a map link.

    uv run python -m src.fork.grid_check [--min-kv 63] [--csv data/grid-check.csv]

Uses DATABASE_URL (postgresql+asyncpg://...), else the local database.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import os
from collections import Counter
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from .line_trace import GridIndex, load_index, trace_line

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_URL = "postgresql+asyncpg://osm:osm@localhost:5432/osm"
# A line end this close to the region's outline leaves the region (metres).
REGION_EDGE = 2000
# An open end this close to a station or another line probably should be joined to it.
NEAR = 100


# Reasons, the likely data errors first.
KINDS = ["not joined", "open end", "other line", "unclear split", "guessed split", "leaves the region"]


def kind(reason: str) -> str:
    return next(k for k in KINDS if reason.startswith(k))


async def region_outline(database: AsyncConnection) -> str | None:
    """The built region's outline (GeoJSON), from Geofabrik's index."""
    row = (await database.execute(text("SELECT value FROM oim_build_info WHERE key = 'region_id'"))).first()
    index = REPO_ROOT / "data" / "osm" / "geofabrik-index-v1.json"
    if not row or not index.exists():
        return None
    for feature in json.loads(index.read_text())["features"]:
        if feature["properties"]["id"] == row[0] and feature.get("geometry"):
            return json.dumps(feature["geometry"])
    return None


def loose_ends(index: GridIndex, min_voltage: int) -> dict[int, tuple[str, int, set[str], int]]:
    """Every loose end: junction -> (reason, voltage, line names, a way there)."""
    found: dict[int, tuple[str, int, set[str], int]] = {}
    done: set[tuple[int, int]] = set()
    for way, edge_ids in index.by_way.items():
        voltages = set().union(*(index.edges[i].voltages for i in edge_ids))
        for voltage in sorted(v for v in voltages if v >= min_voltage):
            if (way, voltage) in done:
                continue
            trace = trace_line(index, way, voltage)
            if trace is None:
                continue
            done |= {(w, voltage) for w in trace.ways(index)}
            for node, reason in trace.loose.items():
                if node not in found or found[node][1] < voltage:
                    found[node] = (reason, voltage, trace.names, way)
    return found


async def main(min_kv: int, csv_path: Path) -> None:
    engine = create_async_engine(os.environ.get("DATABASE_URL", DEFAULT_URL))
    async with engine.connect() as database:
        index = await load_index(database)
        print(f"Network: {len(index.edges):,} stretches, {len(index.nodes):,} nodes.")
        found = loose_ends(index, min_kv * 1000)
        outline = await region_outline(database)
        rows = (
            await database.execute(
                text(
                    """WITH region AS (
                         SELECT ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(:outline), 4326), 3857) AS geom
                          WHERE CAST(:outline AS text) IS NOT NULL)
                       SELECT n.node_id, ST_Y(ST_Transform(n.geom, 4326)), ST_X(ST_Transform(n.geom, 4326)),
                              -- metres from the region's edge, 0 outside it (the way crosses it)
                              (SELECT CASE WHEN ST_Contains(r.geom, n.geom)
                                      THEN oim_metres(ST_Distance(ST_Boundary(r.geom), n.geom), n.geom)
                                      ELSE 0 END
                                 FROM region AS r),
                              -- the nearest station and line it isn't joined to
                              (SELECT oim_metres(ST_Distance(s.geom, n.geom), n.geom) FROM grid_node AS s
                                WHERE s.kind <> 'junction'
                                  AND ST_DWithin(s.geom, n.geom, :near * oim_max_stretch())
                                ORDER BY s.geom <-> n.geom LIMIT 1),
                              (SELECT oim_metres(ST_Distance(e.geom, n.geom), n.geom) FROM grid_edge AS e
                                WHERE ST_DWithin(e.geom, n.geom, :near * oim_max_stretch())
                                  AND n.node_id NOT IN (e.source, e.target)
                                ORDER BY e.geom <-> n.geom LIMIT 1)
                         FROM grid_node AS n WHERE n.node_id = ANY(:ids)"""
                ),
                {"ids": list(found), "outline": outline, "near": NEAR},
            )
        ).all()
    await engine.dispose()

    counts: Counter[str] = Counter()
    out = []
    for node, lat, lon, edge_distance, station, line in rows:
        reason, voltage, names, way = found[node]
        if reason == "tap":
            continue  # ends on another line: connected
        if edge_distance is not None and edge_distance < REGION_EDGE:
            reason = "leaves the region"
        elif reason == "open end" and station is not None and station < NEAR:
            reason = f"not joined to a station {station:.0f} m away"
        elif reason == "open end" and line is not None and line < NEAR:
            reason = f"not joined to a line {line:.0f} m away"
        counts[kind(reason)] += 1
        out.append(
            {
                "reason": reason,
                "kv": voltage // 1000,
                "line": "; ".join(sorted(names)),
                "way": way,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "map": f"https://www.openstreetmap.org/?mlat={lat:.6f}&mlon={lon:.6f}#map=18/{lat:.6f}/{lon:.6f}",
            }
        )
    print(f"Loose ends of lines of {min_kv} kV and more:")
    for reason, n in sorted(counts.items(), key=lambda c: KINDS.index(kind(c[0]))):
        print(f"  {reason:<20} {n:>6,}")
    out.sort(key=lambda r: (KINDS.index(kind(r["reason"])), -r["kv"]))
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    with csv_path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(out[0]) if out else ["reason"])
        writer.writeheader()
        writer.writerows(out)
    print(f"-> {csv_path}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="Check the power grid network for lines that stop at nothing."
    )
    parser.add_argument("--min-kv", type=int, default=63)
    parser.add_argument("--csv", type=Path, default=REPO_ROOT / "data" / "grid-check.csv")
    args = parser.parse_args()
    asyncio.run(main(args.min_kv, args.csv))
