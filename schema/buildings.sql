-- Fork: the large buildings shown zoomed out (Tegola's "buildings" map, zooms 12
-- to 14). Filled by web-backend/src/fork/background/large_buildings.py from the
-- background maps' zoom 15 tiles (scripts/lib/db.sh large_buildings), which
-- replaces the table; empty until then, so Tegola always has it.
CREATE TABLE IF NOT EXISTS basemap_building_large (
    id bigint,
    height real,
    area_m2 float,
    geometry geometry(MultiPolygon, 3857)
);
CREATE INDEX IF NOT EXISTS basemap_building_large_geometry_idx
    ON basemap_building_large USING gist (geometry);
