-- Fork: the towers' numbers along their lines, empty: web-backend/src/fork/
-- tower_numbers.py fills them after the build (scripts/lib/db.sh number_towers).
-- Tegola serves tower_number (the tower_number layer, tegola/layers.fork.yml), so
-- it must exist even when that step hasn't run. Keep the columns the same as
-- tower_numbers.py's.
CREATE EXTENSION IF NOT EXISTS unaccent;  -- tower_line.search
CREATE TABLE IF NOT EXISTS tower_line (
    line_id integer PRIMARY KEY, voltage integer, name text, start_name text, end_name text,
    search text);
CREATE TABLE IF NOT EXISTS tower_line_edge (
    line_id integer, edge_id integer, start_m double precision, backwards boolean);
CREATE TABLE IF NOT EXISTS tower_number (
    osm_id bigint, line_id integer, voltage integer, number text, total integer,
    geometry geometry(Point, 3857), label boolean);
