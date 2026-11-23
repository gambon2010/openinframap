-- Fork: the names OpenStreetMap gives buildings ("Cathédrale Notre-Dame"), for the
-- background map's buildings: their details, My layers' copies, the search
-- (search.sql). Empty here: scripts/building_names.py fills it after the import (the
-- build's import_building_names), from the region's whole extract (the import's
-- filtered one keeps infrastructure only). Keyed like the background map's buildings
-- (a way 2·2^44 + its id, a relation 3·2^44 + its id), one point inside each.
CREATE TABLE IF NOT EXISTS osm_building_name (
    building_id bigint PRIMARY KEY,
    name text NOT NULL,
    geometry geometry(Point, 3857) NOT NULL
);
