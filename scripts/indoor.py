#!/usr/bin/env python3
"""
Fork: buildings' interiors from OpenStreetMap (docs/plans/indoor-maps.md), into
osm_indoor (schema/fork/indoor.sql), replaced whole.

    uv run --project scripts scripts/indoor.py [--extract PBF] [--db-url URL]

Run by scripts/import-indoor.sh (and the region build), which then has the backend
find each interior's building (python -m src.fork.indoor). France: about 3 minutes.

From the whole extract (the import's filtered one keeps infrastructure only):
everything with an indoor, level or repeat_on tag (France: 366,000), as GeoJSON.
Kept: the interiors themselves (rooms, areas, corridors, walls, columns, doors, floor
outlines: indoor=*); stairs, lifts, escalators, paths and anything else with a floor
are marked to be kept only where they touch an interior or stand in a building, which
the backend tells next (a shop in a centre mapped without rooms stays, a bench on
level 0 in a street goes). A piece with no level takes its floor outline's, else 0.
"""

import argparse
import csv
import json
import re
import shutil
import sys
from collections.abc import Iterator
from pathlib import Path

import psycopg2

# The build runs scripts isolated (python -I, lib/python.sh): Python doesn't look next
# to them for data_folders and offline_maps.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from data_folders import OSM_DIR
from offline_maps.osm_extract import built_region_extract, run_osmium

# Where the cut's files go while it runs (removed after): beside the extracts.
WORK = OSM_DIR / "indoor"

# indoor=* values that are an interior's own pieces, as their kind.
STRUCTURE = {"room", "area", "corridor", "wall", "column", "door", "level"}
# An interior's floor space: what's touching it is part of the interior.
FLOOR_SPACE = ("room", "area", "corridor", "level")

# "0", "-1", "0.5", or a range "0-3", "-2--1".
LEVEL_PART = re.compile(r"^(-?\d+(?:\.\d+)?)(?:-(-?\d+(?:\.\d+)?))?$")


def main() -> None:
    args = parse_args()
    connection = psycopg2.connect(args.db_url)
    extract = args.extract or built_region_extract(connection)
    try:
        lines = cut_indoor(extract, WORK)
        count = load_indoor(connection, indoor_rows(lines), WORK / "indoor.csv")
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
    print(f"{count:,} pieces of interiors.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db-url", default="postgresql://osm:osm@localhost:5432/osm")
    parser.add_argument(
        "--extract", type=Path, help="an OpenStreetMap extract (.osm.pbf)"
    )
    return parser.parse_args()


def cut_indoor(extract: Path, work: Path) -> Path:
    """Everything with a floor or an indoor tag, as GeoJSON, one feature a line, each
    with its OpenStreetMap kind and id (@type, @id)."""
    work.mkdir(parents=True, exist_ok=True)
    tagged, lines = work / "indoor.osm.pbf", work / "indoor.geojsonseq"
    run_osmium(
        "tags-filter",
        extract,
        "nwr/indoor",
        "nwr/level",
        "nwr/repeat_on",
        "-o",
        tagged,
        "--overwrite",
    )
    run_osmium(
        "export", tagged, "-f", "geojsonseq", "-a", "type,id",
        "-x", "print_record_separator=false", "-o", lines, "--overwrite",
    )  # fmt: skip
    return lines


def indoor_rows(lines: Path) -> Iterator[list[str]]:
    """Each feature that may be part of an interior, as a row for load_indoor: its
    id, kind, name, ref, levels, lowest and highest floor, whether a level was
    written, whether it's kept only inside an interior or a building, its tags and
    outline (GeoJSON)."""
    with lines.open(encoding="utf-8") as f:
        for line in f:
            feature = json.loads(line)
            tags = feature["properties"]
            kind = indoor_kind(tags)
            if kind is None:
                continue
            given = ";".join(filter(None, (tags.get("level"), tags.get("repeat_on"))))
            written = given or "0"
            floors = levels_of(written) or [0.0]
            osm_id = tags.pop("@type")[0] + str(tags.pop("@id"))
            yield [
                osm_id,
                kind,
                tags.get("name", ""),
                tags.get("ref", ""),
                written,
                str(min(floors)),
                str(max(floors)),
                str(bool(given)),
                str(kind not in STRUCTURE),
                json.dumps(tags, ensure_ascii=False),
                json.dumps(feature["geometry"]),
            ]


def indoor_kind(tags: dict[str, str]) -> str | None:
    """What a feature is in an interior; None if it isn't part of one."""
    indoor = tags.get("indoor", "")
    if indoor == "no":
        # Said to be outside.
        return None
    if indoor in STRUCTURE:
        return indoor
    if (
        indoor in ("stairs", "steps")
        or tags.get("highway") == "steps"
        or tags.get("room") == "stairs"
    ):
        return "stairs"
    if tags.get("highway") == "elevator" or tags.get("room") == "elevator":
        return "elevator"
    if "conveying" in tags:
        return "escalator"
    if "door" in tags or "entrance" in tags:
        return "door"
    if indoor not in ("", "yes"):
        # Other values (shop, glass_cabinet...): a space of its own.
        return "room"
    if tags.get("highway") in ("footway", "corridor", "pedestrian", "path"):
        return "path"
    return "poi"


def levels_of(written: str) -> list[float]:
    """The floors a level or repeat_on value names, in order: "1;3" is 1 and 3,
    "0-2" is 0, 1 and 2; [] if it can't be read."""
    floors: set[float] = set()
    for part in written.replace(" ", "").split(";"):
        match = LEVEL_PART.match(part)
        if not match:
            continue
        low = float(match.group(1))
        high = float(match.group(2)) if match.group(2) else low
        low, high = min(low, high), max(low, high)
        floors.add(low)
        floors.add(high)
        floors.update(float(n) for n in range(int(low) + 1, int(high)) if n > low)
    return sorted(floors)


def load_indoor(connection, rows: Iterator[list[str]], file: Path) -> int:
    """osm_indoor replaced by `rows`, in one transaction: what touches an interior's
    floor space kept, a piece with no level put on its floor outline's; how many."""
    with file.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    with connection, connection.cursor() as cur:
        cur.execute(
            """CREATE TEMP TABLE indoor_in (osm_id text, kind text, name text, ref text, levels text,
               level_low real, level_high real, level_given boolean, inside_only boolean, tags jsonb,
               outline text)"""
        )
        with file.open(encoding="utf-8") as f:
            cur.copy_expert("COPY indoor_in FROM STDIN WITH (FORMAT csv)", f)
        cur.execute("TRUNCATE osm_indoor")
        cur.execute(
            """INSERT INTO osm_indoor (osm_id, kind, name, ref, levels, level_low, level_high, level_given,
                                      inside_only, tags, geometry)
               SELECT osm_id, kind, NULLIF(name, ''), NULLIF(ref, ''), levels, level_low, level_high,
                      level_given, inside_only, tags,
                      ST_Transform(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(outline), 4326)), 3857)
                 FROM indoor_in"""
        )
        cur.execute("ANALYZE osm_indoor")
        keep_what_touches_floor_space(cur)
        floor_from_outline(cur)
        cur.execute("SELECT count(*) FROM osm_indoor")
        count = cur.fetchone()[0]
    return count


def keep_what_touches_floor_space(cur) -> None:
    """Something with a floor touching a room, area, corridor or floor outline is part
    of that interior: kept whatever building it's in."""
    cur.execute(
        """UPDATE osm_indoor m SET inside_only = false
             FROM osm_indoor s
            WHERE m.inside_only AND s.kind = ANY(%s) AND ST_Intersects(s.geometry, m.geometry)""",
        (list(FLOOR_SPACE),),
    )


def floor_from_outline(cur) -> None:
    """A piece with no level written takes the floor of the floor outline
    (indoor=level) it's in, when that has one."""
    cur.execute(
        """UPDATE osm_indoor m SET levels = s.levels, level_low = s.level_low, level_high = s.level_high
             FROM osm_indoor s
            WHERE NOT m.level_given AND s.kind = 'level' AND s.level_given
              AND ST_Within(ST_PointOnSurface(m.geometry), s.geometry)"""
    )


if __name__ == "__main__":
    main()
