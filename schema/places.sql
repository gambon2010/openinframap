-- Fork: prepare osm_place (imposm/places.py) for the search box: one named
-- point per place. Run by scripts/build-region.sh after the import.

-- A place mapped both as an area and as a point (same name and type, point
-- inside the area) keeps only the point, which is its label position.
DELETE FROM osm_place AS area
    USING osm_place AS point
    WHERE GeometryType(area.geometry) <> 'POINT'
      AND GeometryType(point.geometry) = 'POINT'
      AND point.type = area.type
      AND point.name = area.name
      AND point.name <> ''
      AND ST_Intersects(area.geometry, point.geometry);

-- The search only needs a point: replace the remaining outlines (most of the
-- table's size) with a point inside each area.
UPDATE osm_place SET geometry = ST_PointOnSurface(geometry)
    WHERE GeometryType(geometry) <> 'POINT';

-- Places without any name can't be found.
DELETE FROM osm_place
    WHERE name = ''
      AND NOT EXISTS (SELECT 1 FROM skeys(tags) AS k WHERE k LIKE 'name:%');

VACUUM FULL osm_place;
ANALYZE osm_place;
