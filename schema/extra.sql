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

CREATE INDEX IF NOT EXISTS extra_power_line_geometry ON extra.power_line USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_power_line_source ON extra.power_line (source);
CREATE INDEX IF NOT EXISTS extra_power_substation_geometry ON extra.power_substation USING gist (geometry);
CREATE INDEX IF NOT EXISTS extra_power_substation_source ON extra.power_substation (source);
