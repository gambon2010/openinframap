-- Fork: buildings' interiors from OpenStreetMap (docs/plans/indoor-maps.md). Empty
-- here, so Tegola's indoor map always has its tables: scripts/indoor.py fills
-- osm_indoor from the region's whole extract (the import's filtered one keeps
-- infrastructure only), then the backend (python -m src.fork.indoor) finds the
-- background map's building each interior is in and fills indoor_building.

-- An interior's pieces: rooms, areas, corridors, walls, columns, doors, floor
-- outlines (kind = indoor=*), stairs, lifts, escalators, paths, and what stands
-- inside (poi): each on the floors from level_low to level_high (OSM's level and
-- repeat_on, read by indoor.py: "1;2" is 1 to 2, a floor with no level is 0).
CREATE TABLE IF NOT EXISTS osm_indoor (
    id serial PRIMARY KEY,
    osm_id text NOT NULL,            -- "w123", "n45", "r6"
    kind text NOT NULL,
    name text,
    ref text,
    levels text NOT NULL,            -- as written: "0", "-1;0", "0-3"
    level_low real NOT NULL,
    level_high real NOT NULL,
    level_given boolean NOT NULL,    -- false: no level written (put on 0, or its floor outline's)
    -- Something with a floor that isn't itself part of an interior (a shop, a bench):
    -- kept only where it touches one or stands in a building (the backend decides).
    inside_only boolean NOT NULL,
    building_id bigint,              -- its building or underground place (indoor_building)
    tags jsonb NOT NULL,
    geometry geometry(Geometry, 3857) NOT NULL
);
CREATE INDEX IF NOT EXISTS osm_indoor_geometry ON osm_indoor USING gist (geometry);
CREATE INDEX IF NOT EXISTS osm_indoor_building ON osm_indoor (building_id);

-- What has a floor plan (rooms, corridors, walls, floor outlines): the background
-- map's buildings with one, and underground places outside any building (a metro
-- hall, the squares under La Défense: a negative id, their pieces' building_id),
-- with their floors (in order) and outline (tinted on the map while building
-- outlines are shown; covering the map under a floor shown).
CREATE TABLE IF NOT EXISTS indoor_building (
    building_id bigint PRIMARY KEY,
    levels real[] NOT NULL,
    name text,                       -- an underground place's (its largest named space)
    underground boolean NOT NULL,
    geometry geometry(Geometry, 3857) NOT NULL
);
CREATE INDEX IF NOT EXISTS indoor_building_geometry ON indoor_building USING gist (geometry);
