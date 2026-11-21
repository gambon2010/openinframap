-- Fork: the parts of military sites (site_feature: sites.sql). A military site inside
-- a larger one is a part of the smallest around it, its base: a depot's bunkers, a
-- camp's ranges, a fort's casemates. A base keeps its icon and label; what each part
-- shows depends on what it is (site_part.part):
--   building  a building (tagged one, or a bunker, casemate, barracks... mapped as
--             military only), named or not of another kind than its base (a
--             camp's barracks blocks): drawn as a building, no icon, from zoom 15,
--             raised in 3D; its kind in its details;
--   own_kind  a kind other than its base's (a range in a camp, a named radar
--             station on an air base): marked as itself, its icon and area;
--   zone      the rest (a fenced plot, a field of the depot): an outline, no icon,
--             from zoom 15.
-- Zoomed out, a base's building and zone parts aren't drawn nor counted in the
-- numbered groups (site-points.sql): the base stands for them, and its details count
-- them (site_part_count). Buildings of one kind standing together with no military
-- area mapped around them (a forest's ammunition magazines) get a base made for
-- them (site_made_base). Safe to run more than once; run after sites.sql.

-- How close (real metres) buildings of one kind stand, and how many, to make a base
-- for them when none is mapped; a storage area tagged military=ammunition is a
-- magazine (a building) under this size, else a depot's ground (m²).
-- Made-base clustering: PostGIS's DBSCAN, on coordinates scaled to real metres.
CREATE OR REPLACE FUNCTION oim_made_base_gap() RETURNS float LANGUAGE sql IMMUTABLE AS $$ SELECT 150.0 $$;
CREATE OR REPLACE FUNCTION oim_made_base_min_parts() RETURNS integer LANGUAGE sql IMMUTABLE AS $$ SELECT 5 $$;
CREATE OR REPLACE FUNCTION oim_magazine_max_area() RETURNS float LANGUAGE sql IMMUTABLE AS $$ SELECT 5000.0 $$;

-- Military values that are buildings, even without a building tag (Maginot line
-- works, a camp's barracks, a guard post, an ammunition magazine).
CREATE OR REPLACE FUNCTION is_military_building(tags hstore, area float) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT tags ? 'building'
        OR coalesce(tags->'military', '') IN ('bunker', 'casemate', 'cupola', 'embrasure', 'barracks',
                                              'office', 'checkpoint', 'hangar')
        OR (tags->'military' = 'ammunition' AND area < oim_magazine_max_area())
$$;
DROP FUNCTION IF EXISTS is_military_building(hstore);

-- What a part is, as its base's details count it: its military value (bunker,
-- barracks), else its building value (hangar), else its kind.
CREATE OR REPLACE FUNCTION part_what(tags hstore, kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(nullif(nullif(tags->'military', 'yes'), ''), nullif(nullif(tags->'building', 'yes'), ''), kind)
$$;

DROP VIEW IF EXISTS site_tile;
DROP MATERIALIZED VIEW IF EXISTS site_military;
DROP MATERIALIZED VIEW IF EXISTS site_part_count;
DROP MATERIALIZED VIEW IF EXISTS site_part;
DROP MATERIALIZED VIEW IF EXISTS site_made_base;

-- Bases made for buildings of one kind standing together, no military site around
-- them: the hull of each group, a little wider, unnamed (titled by its kind), with
-- ids after site_feature's.
CREATE MATERIALIZED VIEW site_made_base AS
WITH military AS (
    SELECT id, geometry, kind, tags, area FROM site_feature WHERE category IN ('military', 'military_disused')
), alone AS (
    -- Buildings in use with no military site around them (disused ones, the
    -- Atlantic Wall's bunkers, aren't grouped).
    SELECT p.id, p.geometry, p.kind
      FROM military p
     WHERE is_military_building(p.tags, p.area)
       AND p.kind NOT IN ('military_disused', 'military_airfield_disused')
       AND NOT EXISTS (
           SELECT 1 FROM military b
            WHERE b.id <> p.id AND b.area > p.area
              AND b.geometry && p.geometry AND ST_Contains(b.geometry, ST_PointOnSurface(p.geometry)))
), grouped AS (
    SELECT alone.*,
           ST_ClusterDBSCAN(ST_Scale(geometry, 1 / oim_stretch_at(geometry), 1 / oim_stretch_at(geometry)),
                            eps := oim_made_base_gap(), minpoints := oim_made_base_min_parts())
               OVER (PARTITION BY kind) AS cluster
      FROM alone
), hulls AS (
    SELECT kind, ST_Buffer(ST_ConvexHull(ST_Collect(geometry)), oim_units(oim_made_base_gap() / 6, ST_Collect(geometry))) AS geometry
      FROM grouped WHERE cluster IS NOT NULL
     GROUP BY kind, cluster
)
SELECT (SELECT max(id) FROM site_feature) + row_number() OVER (ORDER BY kind, ST_XMin(geometry)) AS id,
       NULL::bigint AS osm_id, geometry, NULL::varchar AS name, kind, site_category(kind) AS category,
       site_importance(kind, ''::hstore, oim_ground_area(geometry)) AS importance, ''::hstore AS tags,
       oim_ground_area(geometry) AS area
  FROM hulls;
CREATE INDEX site_made_base_geometry ON site_made_base USING gist (geometry);

-- Every military site, those mapped and the bases made (with an index: the parts
-- are found through it).
CREATE MATERIALIZED VIEW site_military AS
SELECT id, osm_id, geometry, name, kind, category, importance, tags, area
  FROM site_feature WHERE category IN ('military', 'military_disused')
UNION ALL
SELECT id, osm_id, geometry, name, kind, category, importance, tags, area FROM site_made_base;
CREATE INDEX site_military_geometry ON site_military USING gist (geometry);
ANALYZE site_military;

CREATE MATERIALIZED VIEW site_part AS
WITH base AS (
    -- The smallest military site around each one (found through the geometry indexes).
    SELECT DISTINCT ON (p.id) p.id AS site_id, b.id AS base_id, b.kind AS base_kind, b.name AS base_name
      FROM site_military p
           JOIN site_military b ON b.id <> p.id AND b.area > p.area
                               AND b.geometry && p.geometry AND ST_Contains(b.geometry, ST_PointOnSurface(p.geometry))
     ORDER BY p.id, b.area
)
SELECT base.site_id, base.base_id, base.base_name,
       CASE WHEN is_military_building(p.tags, p.area) AND (p.kind = base.base_kind OR coalesce(p.name, '') = '')
                THEN 'building'
            WHEN p.kind <> base.base_kind THEN 'own_kind'
            ELSE 'zone' END AS part,
       CASE WHEN p.kind <> base.base_kind AND NOT is_military_building(p.tags, p.area) THEN p.kind
            ELSE part_what(p.tags, p.kind) END AS what
  FROM base JOIN site_military p ON p.id = base.site_id;
CREATE UNIQUE INDEX site_part_site ON site_part (site_id);
ANALYZE site_part;

-- Each base's parts, counted by what they are, the most first ("bunker:118,barracks:3").
CREATE MATERIALIZED VIEW site_part_count AS
SELECT base_id, string_agg(what || ':' || n, ',' ORDER BY n DESC, what) AS parts
  FROM (SELECT base_id, what, count(*) AS n FROM site_part GROUP BY base_id, what) counted
 GROUP BY base_id;
CREATE UNIQUE INDEX site_part_count_base ON site_part_count (base_id);

-- The sites as the map's tiles read them (tegola/layers.fork.yml, site-points.sql),
-- the bases made included: with what each is as a part (and what it is: bunker,
-- barracks), its base's name, and a base's parts.
CREATE VIEW site_tile AS
SELECT s.*, p.part, p.what AS part_what, p.base_name, c.parts
  FROM (SELECT id, osm_id, geometry, name, kind, category, importance, tags, area FROM site_feature
        UNION ALL
        SELECT id, osm_id, geometry, name, kind, category, importance, tags, area FROM site_made_base) s
       LEFT JOIN site_part p ON p.site_id = s.id
       LEFT JOIN site_part_count c ON c.base_id = s.id;
