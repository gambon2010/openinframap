-- Building numbers per neighbourhood where a commune has them ("STR-NEU-12"), else per
-- commune: the register's "commune" becomes the numbering "area" (a neighbourhood's
-- or a commune's code). Numbered again from scratch (nothing shared them yet). Also
-- the slivers, not numbered and not drawn outside 3D: buildings no one could stand in
-- (a staircase's steps drawn one by one).
TRUNCATE userdata.building_ref;
ALTER TABLE userdata.building_ref RENAME COLUMN commune TO area;
ALTER TABLE userdata.commune_numbered RENAME TO area_numbered;
ALTER TABLE userdata.area_numbered RENAME COLUMN commune TO area;
TRUNCATE userdata.area_numbered;
CREATE TABLE IF NOT EXISTS userdata.building_sliver (
    building_id bigint PRIMARY KEY,
    area text NOT NULL,
    geometry geometry(Point, 4326) NOT NULL
);
CREATE INDEX IF NOT EXISTS building_sliver_geometry ON userdata.building_sliver USING gist (geometry);
