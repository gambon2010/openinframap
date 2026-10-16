-- Fork: infrastructure data from outside OpenStreetMap ("extra data"), e.g.
-- French distribution networks published by the network operators.
--
-- Filled by scripts/extra_data.py, one source at a time: importing a source
-- replaces everything it imported before, so re-running never duplicates rows.
-- Overlaps with OpenStreetMap are kept for now (filtering them is the next step).
-- Safe to run more than once.

CREATE SCHEMA IF NOT EXISTS extra;

-- One row per imported source: what it is, its licence and when it was imported.
CREATE TABLE IF NOT EXISTS extra.source (
    source text PRIMARY KEY,         -- e.g. fr-agence-ore
    name text NOT NULL,
    country text,
    licence text NOT NULL,
    attribution text NOT NULL,      -- shown on the map
    url text,
    area text,                      -- what was imported, e.g. "departments 67, 68"
    features integer,
    imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS extra.power_line (
    id bigserial PRIMARY KEY,
    source text NOT NULL REFERENCES extra.source ON DELETE CASCADE,
    operator text,                  -- the network operator, e.g. Enedis
    voltage_class text,             -- as published, e.g. BT (low), HTA (medium)
    location text,                  -- overhead or underground
    updated date,                   -- the source's own update date
    geometry geometry(LineString, 3857) NOT NULL
);

CREATE TABLE IF NOT EXISTS extra.power_substation (
    id bigserial PRIMARY KEY,
    source text NOT NULL REFERENCES extra.source ON DELETE CASCADE,
    operator text,
    name text,
    kind text,                      -- e.g. "HTA/BT" for a street-level substation
    updated date,
    geometry geometry(Point, 3857) NOT NULL
);

-- Pipelines (so far French gas distribution networks).
CREATE TABLE IF NOT EXISTS extra.pipeline (
    id bigserial PRIMARY KEY,
    source text NOT NULL REFERENCES extra.source ON DELETE CASCADE,
    operator text,
    substance text NOT NULL,        -- as in OSM: gas, ...
    pressure text,                  -- as published, e.g. "Moyenne pression"; NULL if unknown
    updated date,
    geometry geometry(LineString, 3857) NOT NULL
);
CREATE INDEX IF NOT EXISTS extra_pipeline_geometry ON extra.pipeline USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_pipeline_source ON extra.pipeline (source);

-- Sites (so far French biomethane injection points; ICPE sites next).
CREATE TABLE IF NOT EXISTS extra.facility (
    id bigserial PRIMARY KEY,
    source text NOT NULL REFERENCES extra.source ON DELETE CASCADE,
    kind text NOT NULL,             -- e.g. biomethane_injection
    name text,
    operator text,
    capacity numeric,
    capacity_unit text,             -- e.g. GWh/year
    opened date,
    details jsonb,                  -- other published fields, shown in the popup
    updated date,
    geometry geometry(Point, 3857) NOT NULL
);
CREATE INDEX IF NOT EXISTS extra_facility_geometry ON extra.facility USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_facility_source ON extra.facility (source, kind);

CREATE INDEX IF NOT EXISTS extra_power_line_geometry ON extra.power_line USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_power_line_source ON extra.power_line (source);
CREATE INDEX IF NOT EXISTS extra_power_substation_geometry ON extra.power_substation USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_power_substation_source ON extra.power_substation (source);

-- How many of a source's features were removed because OpenStreetMap already has them.
ALTER TABLE extra.source ADD COLUMN IF NOT EXISTS osm_duplicates integer;

-- Duplicates of OpenStreetMap: the OSM data is kept as it is, and extra features it
-- already has are deleted. Distances are in EPSG:3857 metres (15 ≈ 10 m on the
-- ground in France). Measured on a sample around Pontivy: matches are clear-cut
-- (overhead HTA lines are mostly 0% or 100% covered, substations are within a few
-- metres or more than 50 m away).

-- Lines: deleted when at least 80% of their length is within 15 m of OSM lines of
-- the same voltage class (or no voltage) and the same placement: an underground
-- cable next to an OSM overhead line is usually a different line (the overhead
-- one was buried, or both run along the same road).
CREATE OR REPLACE FUNCTION extra.remove_osm_duplicate_lines(src text, loc text, cls text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE removed bigint;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS extra_osm_line (geometry geometry(LineString, 3857));
    TRUNCATE extra_osm_line;
    INSERT INTO extra_osm_line
        SELECT o.geometry FROM osm_power_line o
         WHERE (o.voltage IS NULL OR o.voltage = '' OR CASE cls
                    WHEN 'BT' THEN convert_voltage(o.voltage) <= 1000
                    WHEN 'HTA' THEN convert_voltage(o.voltage) > 1000 AND convert_voltage(o.voltage) <= 50000
                    ELSE false END)
           AND (coalesce(o.location, '') IN ('underground', 'underwater')
                OR (o.type IN ('cable', 'minor_cable') AND coalesce(o.location, '') = ''))
               = (loc = 'underground');
    CREATE INDEX IF NOT EXISTS extra_osm_line_geometry ON extra_osm_line USING gist (geometry);
    ANALYZE extra_osm_line;

    DELETE FROM extra.power_line e
     WHERE e.source = src AND e.location = loc AND e.voltage_class = cls
       AND ST_Length(e.geometry) > 0
       AND EXISTS (SELECT 1 FROM extra_osm_line o WHERE ST_DWithin(o.geometry, e.geometry, 15))
       AND (SELECT ST_Length(ST_Intersection(e.geometry, ST_Union(ST_Buffer(o.geometry, 15))))
              FROM extra_osm_line o WHERE ST_DWithin(o.geometry, e.geometry, 15))
           >= 0.8 * ST_Length(e.geometry);
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;

-- Substations (street-level HTA/BT): deleted when within 25 m of an OSM small
-- substation (not a big one, which can contain a street transformer without
-- being it), a transformer, or a pole carrying a transformer.
CREATE OR REPLACE FUNCTION extra.remove_osm_duplicate_substations(src text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE removed bigint;
BEGIN
    DELETE FROM extra.power_substation e
     WHERE e.source = src
       AND (EXISTS (SELECT 1 FROM osm_power_substation s
                     WHERE ST_DWithin(s.geometry, e.geometry, 25)
                       AND coalesce(s.substation, '') IN ('minor_distribution', '', 'yes', 'transformer')
                       AND ST_Area(s.geometry) < 2000)
            OR EXISTS (SELECT 1 FROM osm_power_switchgear t
                        WHERE t.type = 'transformer' AND ST_DWithin(t.geometry, e.geometry, 25))
            OR EXISTS (SELECT 1 FROM osm_power_tower p
                        WHERE ST_DWithin(p.geometry, e.geometry, 25)
                          AND p.tags ? 'transformer' AND p.tags -> 'transformer' <> 'no'));
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;

-- Pipelines: deleted when at least 80% of their length is within 15 m of OSM
-- pipelines of the same substance (or none).
CREATE OR REPLACE FUNCTION extra.remove_osm_duplicate_pipelines(src text, subst text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE removed bigint;
BEGIN
    CREATE TEMP TABLE IF NOT EXISTS extra_osm_pipeline (geometry geometry(LineString, 3857));
    TRUNCATE extra_osm_pipeline;
    INSERT INTO extra_osm_pipeline
        SELECT o.geometry FROM osm_pipeline o
         WHERE coalesce(o.substance, '') IN ('', subst)
            OR (subst = 'gas' AND o.substance IN ('natural_gas', 'cng', 'lpg', 'lng'));
    CREATE INDEX IF NOT EXISTS extra_osm_pipeline_geometry ON extra_osm_pipeline USING gist (geometry);
    ANALYZE extra_osm_pipeline;

    DELETE FROM extra.pipeline e
     WHERE e.source = src AND e.substance = subst
       AND ST_Length(e.geometry) > 0
       AND EXISTS (SELECT 1 FROM extra_osm_pipeline o WHERE ST_DWithin(o.geometry, e.geometry, 15))
       AND (SELECT ST_Length(ST_Intersection(e.geometry, ST_Union(ST_Buffer(o.geometry, 15))))
              FROM extra_osm_pipeline o WHERE ST_DWithin(o.geometry, e.geometry, 15))
           >= 0.8 * ST_Length(e.geometry);
    GET DIAGNOSTICS removed = ROW_COUNT;
    RETURN removed;
END $$;
