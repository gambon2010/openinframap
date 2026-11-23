"""Fork: tower numbers (tower_numbers/__init__.py): writing them: tower_line,
tower_line_edge and tower_number (what Tegola and the search read)."""

from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .numbering import Line
from .register import number_from_register


async def write(database: AsyncConnection, lines: list[Line]) -> None:
    """The lines, each tower's place along them, their numbers (from the register)."""
    await write_lines(database, lines)
    towers = await towers_along(database)
    numbered = await number_from_register(database, lines, towers)
    await write_numbers(database, numbered)


async def copy_rows(database: AsyncConnection, table: str, rows: list) -> None:
    raw = (await database.get_raw_connection()).driver_connection
    assert raw is not None
    await raw.copy_records_to_table(table, records=rows)


async def write_lines(database: AsyncConnection, lines: list[Line]) -> None:
    """tower_line (each line, with what the search matches) and tower_line_edge
    (where each stretch of the network is along its line)."""
    await database.execute(text("DROP TABLE IF EXISTS tower_number, tower_line_edge, tower_line"))
    await database.execute(
        text(
            """CREATE TABLE tower_line (line_id integer PRIMARY KEY, voltage integer,
                                        name text, start_name text, end_name text)"""
        )
    )
    await database.execute(
        text(
            """CREATE TABLE tower_line_edge (line_id integer, edge_id integer,
                                             start_m double precision, backwards boolean)"""
        )
    )
    await copy_rows(database, "tower_line", [(x.line_id, x.voltage, x.name, x.start, x.end) for x in lines])
    await copy_rows(
        database,
        "tower_line_edge",
        [(x.line_id, e, m, back) for x in lines for e, (m, back) in x.edges.items()],
    )
    # What the search matches ("23 marlenheim"): the line's name and stations, plain.
    await database.execute(text("ALTER TABLE tower_line ADD COLUMN search text"))
    await database.execute(
        text("UPDATE tower_line SET search = lower(unaccent(concat_ws(' ', name, start_name, end_name)))")
    )
    await database.execute(text("CREATE INDEX ON tower_line_edge (edge_id)"))
    await database.execute(text("ANALYZE tower_line_edge"))


async def towers_along(database: AsyncConnection) -> dict[int, list[int]]:
    """Each line's towers, in order along it."""
    # Each tower on a stretch of a line: how far along the line it is. The towers
    # are points of the lines' ways (within a few cm).
    await database.execute(
        text(
            """CREATE TEMP TABLE tower_along AS
               SELECT DISTINCT ON (t.osm_id, le.line_id)
                      t.osm_id, le.line_id,
                      le.start_m + e.length_m * CASE WHEN le.backwards THEN 1 - f.f ELSE f.f END AS at_m
                 FROM osm_power_tower AS t
                 JOIN grid_edge AS e ON ST_DWithin(e.geom, t.geometry, 0.05)
                 JOIN tower_line_edge AS le ON le.edge_id = e.edge_id
                CROSS JOIN LATERAL (SELECT ST_LineLocatePoint(e.geom, t.geometry) AS f) AS f
                WHERE GeometryType(t.geometry) = 'POINT'
                ORDER BY t.osm_id, le.line_id, at_m"""
        )
    )
    towers: dict[int, list[int]] = {}
    for line_id, osm_id in await database.execute(
        text("SELECT line_id, osm_id FROM tower_along ORDER BY line_id, at_m, osm_id")
    ):
        towers.setdefault(line_id, []).append(osm_id)
    return towers


async def write_numbers(database: AsyncConnection, numbered: list[tuple[int, int, str, int]]) -> None:
    """tower_number: each tower's number on each of its lines (one per voltage), and
    which row labels it on the map."""
    await database.execute(
        text("CREATE TEMP TABLE tower_label (line_id integer, osm_id bigint, number text, total integer)")
    )
    await copy_rows(database, "tower_label", numbered)
    await database.execute(
        text(
            """CREATE TABLE tower_number AS
               -- A line can be followed twice, from two ways side by side near a
               -- substation: a tower keeps one number per voltage, on the longest.
               WITH kept AS (
                   SELECT DISTINCT ON (n.osm_id, l.voltage)
                          n.osm_id, n.line_id, l.voltage, n.number, n.total
                     FROM tower_label AS n JOIN tower_line AS l USING (line_id)
                    ORDER BY n.osm_id, l.voltage, n.total DESC, n.line_id)
               -- On the map (from zoom 16) a tower's label is on its row of its
               -- highest voltage line: its ref, short (tower_short_ref), else its number.
               SELECT k.osm_id, k.line_id, k.voltage, k.number, k.total,
                      t.geometry::geometry(Point, 3857) AS geometry,
                      row_number() OVER (PARTITION BY k.osm_id ORDER BY k.voltage DESC, k.total DESC) = 1
                          AS label,
                      coalesce(tower_short_ref(t.tags -> 'ref'), k.number) AS text
                 FROM kept AS k JOIN osm_power_tower AS t USING (osm_id)
                WHERE GeometryType(t.geometry) = 'POINT'
               -- Towers with a ref on no line of the network: labelled too.
               UNION ALL
               SELECT t.osm_id, NULL, NULL, NULL, NULL, t.geometry::geometry(Point, 3857), true,
                      tower_short_ref(t.tags -> 'ref')
                 FROM osm_power_tower AS t
                 LEFT JOIN tower_label AS n USING (osm_id)
                WHERE n.osm_id IS NULL AND GeometryType(t.geometry) = 'POINT'
                  AND tower_short_ref(t.tags -> 'ref') IS NOT NULL"""
        )
    )
    await database.execute(text("CREATE INDEX ON tower_number (osm_id)"))
    await database.execute(text("CREATE INDEX ON tower_number (number)"))
    await database.execute(text("CREATE INDEX ON tower_number USING gist (geometry) WHERE label"))
    await database.execute(text("ANALYZE tower_number"))
