"""Fork: extra data (scripts/extra_data.py): the command line (list, import, remove)."""

import argparse
import json
import sys
import time

import psycopg2
import psycopg2.extras

from . import SOURCES
from .base import (
    FEATURE_COUNT,
    REPO_ROOT,
    Source,
    region_geojson,
    region_geometry,
    remove_osm_duplicates,
)


def ensure_schema(cur) -> None:
    cur.execute((REPO_ROOT / "schema" / "extra.sql").read_text())


def applicable(cur) -> list[tuple[Source, list[str]]]:
    region, _ = region_geojson(cur)
    # Features are clipped to the region: a source's areas can reach well beyond it.
    cur.execute("CREATE TEMP TABLE IF NOT EXISTS extra_region (geom geometry)")
    cur.execute("TRUNCATE extra_region")
    cur.execute(
        """INSERT INTO extra_region
           SELECT ST_Subdivide(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 3857), 128)""",
        (region,),
    )
    cur.execute(
        "CREATE INDEX IF NOT EXISTS extra_region_geom ON extra_region USING gist (geom)"
    )
    cur.execute("ANALYZE extra_region")
    result = []
    for source in SOURCES.values():
        areas = source.areas(cur, region)
        if areas:
            result.append((source, areas))
    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import infrastructure data from outside OpenStreetMap."
    )
    parser.add_argument("--db-url", default="postgresql://osm:osm@localhost:5432/osm")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser(
        "list", help="sources covering the built region, with estimated sizes"
    )
    imp = sub.add_parser(
        "import", help="import sources (all applicable ones by default)"
    )
    imp.add_argument("sources", nargs="*")
    imp.add_argument(
        "--refresh",
        action="store_true",
        help="download again rather than reuse earlier downloads (data/extra/)",
    )
    imp.add_argument(
        "--choose",
        metavar="KEY[,KEY...]",
        help="only these choices (as `offer` lists them), e.g. --choose gas,icpe",
    )
    imp.add_argument(
        "--only",
        nargs="+",
        metavar="WORD",
        help="only the datasets whose name contains one of these words, e.g. --only gaz",
    )
    sub.add_parser(
        "dedupe",
        help="delete imported features OpenStreetMap already has (import does it as it goes)",
    )
    rem = sub.add_parser("remove", help="remove an imported source")
    rem.add_argument("source")
    off = sub.add_parser(
        "offer",
        help="before a build (no database needed): sources that may cover a Geofabrik region."
        " Exit 0: some, 1: none, 2: unknown region",
    )
    off.add_argument("--region-id", required=True)
    args = parser.parse_args()

    if args.command == "offer":
        region = region_geometry(args.region_id)
        if region is None:
            sys.exit(2)
        # One line per choice: key <tab> label <tab> cost (build-region.sh reads them).
        found = False
        for source in SOURCES.values():
            for key, label, cost in source.offer(region):
                print(f"{key}\t{label}\t{cost}")
                found = True
        sys.exit(0 if found else 1)

    conn = psycopg2.connect(args.db_url)
    cur = conn.cursor()
    ensure_schema(cur)
    conn.commit()

    def refresh_search() -> None:
        """The search box searches the extra data too (schema/search.sql)."""
        cur.execute("SELECT to_regclass('search_feature') IS NOT NULL")
        if cur.fetchone()[0]:
            started = time.monotonic()
            cur.execute("REFRESH MATERIALIZED VIEW search_feature")
            conn.commit()
            print(f"Search updated ({time.monotonic() - started:.0f} s).", flush=True)

    if args.command == "dedupe":
        cur.execute("SELECT source FROM extra.source ORDER BY source")
        for (source_id,) in cur.fetchall():
            total = 0
            cur.execute(
                "SELECT DISTINCT location, voltage_class FROM extra.power_line WHERE source = %s ORDER BY 1, 2",
                (source_id,),
            )
            parts = [("line", location, cls) for location, cls in cur.fetchall()] + [
                ("substation", None, None),
                ("pipeline", None, None),
                ("icpe", None, None),
            ]
            for table, location, cls in parts:
                started = time.monotonic()
                removed = remove_osm_duplicates(cur, source_id, table, location, cls)
                conn.commit()
                total += removed
                what = f"{location} {cls} lines" if table == "line" else table + "s"
                print(
                    f"{source_id}: {what}: removed {removed} already in OpenStreetMap ({time.monotonic() - started:.0f} s)",
                    flush=True,
                )
            cur.execute(
                f"""UPDATE extra.source
                       SET duplicates = coalesce(duplicates, '{{}}') || jsonb_build_object('dedupe ' || to_char(now(), 'YYYY-MM-DD HH24:MI'), %s),
                           features = {FEATURE_COUNT}
                     WHERE source = %s""",
                (total, source_id),
            )
            cur.execute(
                """UPDATE extra.source
                      SET osm_duplicates = (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(duplicates))
                    WHERE source = %s""",
                (source_id,),
            )
            conn.commit()
            print(f"{source_id}: {total} removed in all.")
        refresh_search()
        print("Refresh the tile server: docker compose up -d --force-recreate tegola")
        return

    if args.command == "remove":
        cur.execute("DELETE FROM extra.source WHERE source = %s", (args.source,))
        conn.commit()
        print(f"Removed {args.source} ({cur.rowcount} source).")
        refresh_search()
        return

    _, region_name = region_geojson(cur)
    sources = applicable(cur)
    if args.command == "list":
        if not sources:
            print(f"No extra data sources cover {region_name}.")
        for source, areas in sources:
            print(
                f"{source.id}\t{source.name}\t{len(areas)} area(s): {', '.join(areas)}\t~{source.estimate(areas)} features before clipping to the region"
            )
        return

    wanted = set(args.sources) or {s.id for s, _ in sources}
    if args.choose:
        # Choices name datasets of one or more sources: import those sources, only
        # their chosen datasets.
        chosen = {c.strip() for c in args.choose.split(",") if c.strip()}
        known = {key for s in SOURCES.values() for key in s.CHOICES}
        if chosen - known:
            sys.exit(
                f"Unknown choice(s): {', '.join(sorted(chosen - known))}. Known: {', '.join(sorted(known))}"
            )
        wanted &= {s.id for s in SOURCES.values() if chosen & set(s.CHOICES)}
        args.only = [
            w
            for s in SOURCES.values()
            for key, (_, words) in s.CHOICES.items()
            if key in chosen
            for w in words
        ]
    unknown = wanted - set(SOURCES)
    if unknown:
        sys.exit(
            f"Unknown source(s): {', '.join(sorted(unknown))}. Known: {', '.join(SOURCES)}"
        )
    for source, areas in sources:
        if source.id not in wanted:
            continue
        print(
            f"Importing {source.name} for {region_name} ({len(areas)} area(s): {', '.join(areas)})"
        )
        # The source's description; its data is replaced dataset by dataset (see run()).
        cur.execute(
            """INSERT INTO extra.source (source, name, country, licence, attribution, url, area)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON CONFLICT (source) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country,
                   licence = EXCLUDED.licence, attribution = EXCLUDED.attribution, url = EXCLUDED.url,
                   area = EXCLUDED.area, features = NULL""",
            (
                source.id,
                source.name,
                source.country,
                source.licence,
                source.attribution,
                source.url,
                ", ".join(areas),
            ),
        )
        source.refresh = args.refresh
        source.duplicates, source.duplicates_by = 0, {}
        count = source.run(conn, cur, areas, args.only)
        # All of the source's features, also those of datasets not re-imported (--only).
        cur.execute(
            f"""UPDATE extra.source SET features = {FEATURE_COUNT},
                   duplicates = CASE WHEN %s THEN coalesce(duplicates, '{{}}') ELSE '{{}}' END || %s::jsonb,
                   imported_at = now()
                WHERE source = %s""",
            (bool(args.only), json.dumps(source.duplicates_by), source.id),
        )
        cur.execute(
            """UPDATE extra.source
                  SET osm_duplicates = (SELECT coalesce(sum(value::int), 0) FROM jsonb_each_text(duplicates))
                WHERE source = %s""",
            (source.id,),
        )
        conn.commit()
        print(f"  {count} features imported.")
    for name in wanted - {s.id for s, _ in sources}:
        print(f"{name} doesn't cover {region_name}; nothing imported.")
    refresh_search()
    # Tegola caches tiles up to zoom 13; recreating it drops the cache.
    print(
        "If the tile server is running, refresh it with: docker compose up -d --force-recreate tegola"
    )
