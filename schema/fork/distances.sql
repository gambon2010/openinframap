-- Fork: distances and areas in real metres. The map's coordinates (EPSG:3857, Web
-- Mercator) stretch away from the equator by 1/cos(latitude) = cosh(y / R): 10 of
-- its "metres" are 10 m at the equator, 6.9 m in France, 5 m in Oslo. Every
-- distance and area in the fork's SQL and backend is written in real metres and
-- turned into map units with these, so it means the same everywhere.
--
-- "Within D metres", using the spatial index:
--   ST_DWithin(a, b, D * oim_max_stretch())   -- a constant radius: the index finds
--   AND ST_DWithin(a, b, oim_units(D, b))     -- candidates; then the exact distance
-- Run after views.sql (scripts/lib/db.sh SCHEMA_FILES); import-db.sh runs it too.
-- Their search_path is set: materialized views (search.sql, sites.sql) are built
-- with a restricted one, where PostGIS (in public) isn't found otherwise.

-- How much the map stretches at a geometry's centre.
CREATE OR REPLACE FUNCTION oim_stretch_at(g geometry) RETURNS float
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
    SELECT cosh(ST_Y(ST_Centroid(g)) / 6378137.0)
$$;

-- Real metres as map units at a geometry.
CREATE OR REPLACE FUNCTION oim_units(metres float, at geometry) RETURNS float
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
    SELECT metres * oim_stretch_at(at)
$$;

-- A map distance (ST_Distance) as real metres at a geometry.
CREATE OR REPLACE FUNCTION oim_metres(units float, at geometry) RETURNS float
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
    SELECT units / oim_stretch_at(at)
$$;

-- A geometry's area in real square metres.
CREATE OR REPLACE FUNCTION oim_ground_area(g geometry) RETURNS float
LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
    SELECT ST_Area(g) / oim_stretch_at(g) ^ 2
$$;

-- The most the map stretches over the region built (its power lines' extent, from
-- the table statistics: no scan): the constant radius an indexed search needs.
-- Without statistics, as at 70° latitude (more candidates, still right).
CREATE OR REPLACE FUNCTION oim_max_stretch() RETURNS float
LANGUAGE sql STABLE PARALLEL SAFE SET search_path = public, pg_temp AS $$
    SELECT coalesce(
        (SELECT cosh(greatest(abs(ST_YMin(e)), abs(ST_YMax(e))) / 6378137.0)
           FROM (SELECT ST_EstimatedExtent('public', 'osm_power_line', 'geometry') AS e) x
          WHERE e IS NOT NULL),
        2.92)
$$;
