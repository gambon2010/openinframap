#!/usr/bin/env python3
"""
Fork: the names OpenStreetMap gives buildings ("Cathédrale Notre-Dame"), for the
background map's buildings: their details, My layers' copies of them, the search.
Into osm_building_name (schema/fork/building-names.sql), replaced whole.

    uv run --project scripts scripts/building_names.py [--extract PBF] [--db-url URL]

Run by the region build after the import (build/steps.sh, name_buildings); by hand
after a new extract (the built region's, data/downloads/osm/, by default). France:
742,000 buildings, about 4 minutes.

From the whole extract: the import's filtered one keeps infrastructure only, and
keeping every building there would make it gigabytes. osmium keeps objects with
one tag or another, never two at once: the named ways and relations first (France:
1.1 GB), then the buildings among them (100 MB), then each as GeoJSON; PostGIS picks a
point inside each (Shapely isn't one of the scripts' packages).
"""

import argparse
import csv
import json
import shutil
import sys
from collections.abc import Iterator
from pathlib import Path

import psycopg2

from data_folders import OSM_DIR
from offline_maps.osm_extract import run_osmium

# The background map's building ids (Protomaps' tiles): OpenStreetMap's id, its kind
# in the bits above (web-backend building_numbers/ keys its register by them).
KIND_SHIFT = 44
KIND_BITS = {"way": 2, "relation": 3}

# Where the cut's files go while it runs (removed after): beside the extracts.
WORK = OSM_DIR / "building-names"


def main() -> None:
    args = parse_args()
    connection = psycopg2.connect(args.db_url)
    extract = args.extract or region_extract(connection)
    try:
        buildings = cut_named_buildings(extract, WORK)
        count = load_names(connection, named_buildings(buildings), WORK / "names.csv")
    finally:
        shutil.rmtree(WORK, ignore_errors=True)
    if not args.no_search:
        refresh_search(connection)
    print(f"{count:,} buildings named.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--db-url", default="postgresql://osm:osm@localhost:5432/osm")
    parser.add_argument(
        "--extract", type=Path, help="an OpenStreetMap extract (.osm.pbf)"
    )
    parser.add_argument(
        "--no-search",
        action="store_true",
        help="leave the search's table as it is (the build makes it next)",
    )
    return parser.parse_args()


def region_extract(connection) -> Path:
    """The built region's extract (data/downloads/osm/<region>-latest.osm.pbf)."""
    with connection.cursor() as cur:
        cur.execute("SELECT value FROM oim_build_info WHERE key = 'region_id'")
        row = cur.fetchone()
    path = OSM_DIR / f"{row[0]}-latest.osm.pbf" if row else None
    if not path or not path.exists():
        sys.exit(
            f"No extract of the built region in {OSM_DIR}: give one with --extract."
        )
    return path


def cut_named_buildings(extract: Path, work: Path) -> Path:
    """The extract's named buildings as GeoJSON, one feature a line, each with its
    OpenStreetMap kind and id (@type, @id)."""
    work.mkdir(parents=True, exist_ok=True)
    named, buildings, lines = (
        work / "named.osm.pbf",
        work / "buildings.osm.pbf",
        work / "buildings.geojsonseq",
    )
    run_osmium("tags-filter", extract, "w/name", "r/name", "-o", named, "--overwrite")
    run_osmium("tags-filter", named, "wr/building", "-o", buildings, "--overwrite")
    run_osmium(
        "export", buildings, "-f", "geojsonseq", "--geometry-types=polygon",
        "-a", "type,id", "-x", "print_record_separator=false", "-o", lines, "--overwrite",
    )  # fmt: skip
    return lines


def named_buildings(lines: Path) -> Iterator[tuple[int, str, str]]:
    """Each named building's id on the background map, name and outline (GeoJSON)."""
    with lines.open(encoding="utf-8") as f:
        for line in f:
            feature = json.loads(line)
            tags = feature["properties"]
            # building=no: a name on something that says it isn't one.
            if tags.get("building") == "no" or not tags.get("name"):
                continue
            yield (
                background_id(tags["@type"], tags["@id"]),
                tags["name"],
                json.dumps(feature["geometry"]),
            )


def background_id(kind: str, osm_id: int) -> int:
    """A way or relation's id on the background map: way 4487769 is 2·2^44 + 4487769."""
    return (KIND_BITS[kind] << KIND_SHIFT) + osm_id


def load_names(connection, rows: Iterator[tuple[int, str, str]], file: Path) -> int:
    """osm_building_name replaced by `rows`, a point inside each outline (its centre
    where the outline is broken), in one transaction; how many."""
    with file.open("w", encoding="utf-8", newline="") as f:
        csv.writer(f).writerows(rows)
    with connection, connection.cursor() as cur:
        cur.execute(
            "CREATE TEMP TABLE building_name_in (building_id bigint, name text, outline text)"
        )
        with file.open(encoding="utf-8") as f:
            cur.copy_expert("COPY building_name_in FROM STDIN WITH (FORMAT csv)", f)
        cur.execute("TRUNCATE osm_building_name")
        cur.execute(
            """INSERT INTO osm_building_name
               SELECT DISTINCT ON (building_id) building_id, name, ST_Transform(
                          CASE WHEN ST_IsValid(g) THEN ST_PointOnSurface(g) ELSE ST_Centroid(g) END, 3857)
                 FROM (SELECT building_id, name, ST_SetSRID(ST_GeomFromGeoJSON(outline), 4326) AS g
                         FROM building_name_in) AS b"""
        )
        count = cur.rowcount
        cur.execute("ANALYZE osm_building_name")
    return count


def refresh_search(connection) -> None:
    """The search box searches buildings' names too (schema/fork/search.sql)."""
    with connection, connection.cursor() as cur:
        cur.execute("SELECT to_regclass('search_feature') IS NOT NULL")
        if cur.fetchone()[0]:
            cur.execute("REFRESH MATERIALIZED VIEW search_feature")


if __name__ == "__main__":
    main()
