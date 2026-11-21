-- Fork: the parts of military sites (site_feature: sites.sql). A military site inside
-- a larger one is a part of the smallest around it, its base: a depot's bunkers, a
-- camp's ranges, a fort's casemates. A base keeps its icon and label; what each part
-- shows depends on what it is (site_part.part):
--   own_kind  a kind other than its base's (a range in a camp, a radar on an air
--             base): marked as itself, its icon and area, as any site;
--   building  a building (tagged one, or a bunker, casemate, barracks... mapped as
--             military only): drawn as a building, no icon, from zoom 15;
--   zone      the rest (a fenced plot, a field of the depot): an outline, no icon,
--             from zoom 15.
-- Zoomed out, a base's building and zone parts aren't drawn nor counted in the
-- numbered groups (site-points.sql): the base stands for them, and its details count
-- them (site_part_count). Safe to run more than once; run after sites.sql.

-- Military values that are buildings, even without a building tag (Maginot line
-- works, a camp's barracks, a guard post).
CREATE OR REPLACE FUNCTION is_military_building(tags hstore) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT tags ? 'building'
        OR coalesce(tags->'military', '') IN ('bunker', 'casemate', 'cupola', 'embrasure', 'barracks',
                                              'office', 'checkpoint', 'hangar')
$$;

-- What a part is, as its base's details count it: its military value (bunker,
-- barracks), else its building value (hangar), else its kind.
CREATE OR REPLACE FUNCTION part_what(tags hstore, kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(nullif(nullif(tags->'military', 'yes'), ''), nullif(nullif(tags->'building', 'yes'), ''), kind)
$$;

DROP VIEW IF EXISTS site_tile;
DROP MATERIALIZED VIEW IF EXISTS site_part_count;
DROP MATERIALIZED VIEW IF EXISTS site_part;
CREATE MATERIALIZED VIEW site_part AS
WITH military AS (
    SELECT id, geometry, kind, name, tags, area FROM site_feature WHERE category IN ('military', 'military_disused')
), base AS (
    -- The smallest military site around each one (found through site_feature's index).
    SELECT DISTINCT ON (p.id) p.id AS site_id, b.id AS base_id, b.kind AS base_kind, b.name AS base_name
      FROM military p
           JOIN military b ON b.id <> p.id AND b.area > p.area
                          AND b.geometry && p.geometry AND ST_Contains(b.geometry, ST_PointOnSurface(p.geometry))
     ORDER BY p.id, b.area
)
SELECT base.site_id, base.base_id, base.base_name,
       CASE WHEN p.kind <> base.base_kind THEN 'own_kind'
            WHEN is_military_building(p.tags) THEN 'building'
            ELSE 'zone' END AS part,
       CASE WHEN p.kind <> base.base_kind THEN p.kind ELSE part_what(p.tags, p.kind) END AS what
  FROM base JOIN military p ON p.id = base.site_id;
CREATE UNIQUE INDEX site_part_site ON site_part (site_id);
ANALYZE site_part;

-- Each base's parts, counted by what they are, the most first ("bunker:118,barracks:3").
CREATE MATERIALIZED VIEW site_part_count AS
SELECT base_id, string_agg(what || ':' || n, ',' ORDER BY n DESC, what) AS parts
  FROM (SELECT base_id, what, count(*) AS n FROM site_part GROUP BY base_id, what) counted
 GROUP BY base_id;
CREATE UNIQUE INDEX site_part_count_base ON site_part_count (base_id);

-- The sites as the map's tiles read them (tegola/layers.fork.yml, site-points.sql):
-- with what each is as a part (and what it is: bunker, barracks), its base's name,
-- and a base's parts.
CREATE VIEW site_tile AS
SELECT f.*, p.part, p.what AS part_what, p.base_name, c.parts
  FROM site_feature f
       LEFT JOIN site_part p ON p.site_id = f.id
       LEFT JOIN site_part_count c ON c.base_id = f.id;
