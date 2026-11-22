-- Building numbers (building_numbers/): each building's number within its commune
-- ("WIS-47"), kept here like the towers' (tower_ref) so it stays the same rebuild
-- after rebuild and for everyone sharing the map. A commune is numbered the first
-- time its numbers are asked for, and again (new buildings only) when the background
-- map changes (map_version).
CREATE TABLE IF NOT EXISTS userdata.building_ref (
    building_id bigint PRIMARY KEY,   -- the background map's building id (OpenStreetMap's)
    commune text NOT NULL,            -- its INSEE code
    number integer NOT NULL,
    geometry geometry(Point, 4326) NOT NULL,   -- a point inside it, for its label
    UNIQUE (commune, number)
);
CREATE INDEX IF NOT EXISTS building_ref_geometry ON userdata.building_ref USING gist (geometry);

CREATE TABLE IF NOT EXISTS userdata.commune_numbered (
    commune text PRIMARY KEY,
    map_version text NOT NULL,
    numbered_at timestamptz NOT NULL DEFAULT now()
);
