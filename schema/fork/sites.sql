-- Fork: critical sites (imposm/sites.py imports them all into osm_site). Sorts
-- each into a category and a kind, and how important it is, which decides from
-- which zoom it shows (0: zoom 8, 1: zoom 12, 2: zoom 14; see tegola/layers.yml).
-- Rows that fit no kind (e.g. a water tank, a WWII bomb crater) are left out.
-- Military sites are also sorted by their names (site-rules.sql) and by the sites
-- around and inside them (site_feature); some are set by hand (site-overrides.sql).
-- Safe to run more than once. The functions set their search_path: Postgres builds
-- materialized views with a restricted one, where hstore's -> isn't visible.

-- A site of the gendarmerie, by its operator or its name (OpenStreetMap's police=*
-- is hardly used in France). "Brigade" and "Escadron" name gendarmerie units only
-- at a police station: the army and air force have their own (site_kind).
CREATE OR REPLACE FUNCTION is_gendarmerie(tags hstore) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(tags->'operator' ILIKE 'gendarmerie%', false)
        OR coalesce(tags->'name' ~* '\mgendarmerie', false)
$$;

-- A military area or site no longer in use: a fortification (a bunker, a fort...),
-- tagged disused or abandoned, named "Ancien..." (former) or gone ("disparu"...), or
-- historic, but not when it shows use (an in-use military type, a barracks' name).
-- Some historic forts are still the army's: site-overrides.sql says so for those
-- known; site_feature also takes those with sites in use inside, or around them, as
-- in use.
CREATE OR REPLACE FUNCTION is_disused_military(tags hstore) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(tags->'military' IN ('bunker', 'trench', 'embrasure', 'casemate', 'cupola', 'abandoned', 'battery',
                                         'blockhouse', 'pillbox', 'fort', 'gun_emplacement', 'shelter', 'disused'), false)
        OR coalesce(tags->'building' = 'bunker', false)
        OR tags ?| ARRAY['disused', 'abandoned', 'disused:military', 'abandoned:military', 'was:military']
        OR coalesce(tags->'name' ~* '^(l'')?anciens?n?e?s?\M|\m(disparue?s?|d[ée]truite?s?|d[ée]molie?s?|en ruines?)\M', false)
        OR (tags ? 'historic'
            AND NOT coalesce(tags->'military' IN ('barracks', 'base', 'naval_base', 'airfield', 'office', 'checkpoint',
                                                  'ammunition', 'depot', 'range', 'training_area', 'danger_area'), false)
            AND NOT coalesce(tags->'name' ~* 'caserne|quartier', false))
$$;

-- A military site's kind by its tags alone: military_area when they say no more than
-- military (landuse=military, military=yes); NULL for a military=* value that isn't
-- a site (an obstacle course...).
CREATE OR REPLACE FUNCTION military_kind_by_tags(key text, type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN key = 'landuse' OR type = 'yes' THEN 'military_area'
        WHEN type IN ('barracks', 'base', 'naval_base', 'airfield') THEN 'military_base'
        WHEN type IN ('office', 'checkpoint') THEN 'military_office'
        WHEN type IN ('ammunition', 'depot') THEN 'military_depot'
        WHEN type IN ('range', 'training_area', 'danger_area') THEN 'military_range'
    END
$$;

-- A military site's kind: the gendarmerie's, disused, else what its name says
-- (site-rules.sql) where its tags say no more than military or the rule outweighs
-- them, else what its tags say. NULL: not military (a club's), or not a site.
CREATE OR REPLACE FUNCTION military_kind(key text, type text, tags hstore) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN is_gendarmerie(tags) THEN 'gendarmerie'
        WHEN is_disused_military(tags) THEN 'military_disused'
        WHEN by_name.replaces_tags OR by_tags.kind = 'military_area'
            THEN nullif(coalesce(by_name.kind, by_tags.kind), 'not_military')
        ELSE by_tags.kind
    END
      FROM (SELECT military_kind_by_tags(key, type) AS kind) by_tags
           LEFT JOIN LATERAL (
               SELECT rule.kind, rule.replaces_tags FROM military_name_rule rule
                WHERE tags->'name' ~* rule.pattern
                ORDER BY rule.priority LIMIT 1) by_name ON true
$$;

CREATE OR REPLACE FUNCTION site_kind(key text, type text, tags hstore) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        -- health and emergency
        WHEN type = 'hospital' THEN 'hospital'
        WHEN type IN ('clinic', 'centre') THEN 'clinic'
        WHEN type = 'pharmacy' THEN 'pharmacy'
        WHEN type = 'fire_station' THEN 'fire_station'
        WHEN type = 'ambulance_station' THEN 'ambulance'
        WHEN type = 'siren' THEN 'siren'
        -- government and public services
        WHEN type = 'townhall' THEN 'townhall'
        WHEN key = 'office' AND type = 'government' THEN CASE
            WHEN tags->'government' = 'tax' THEN 'tax'
            WHEN tags->'government' = 'prefecture' THEN 'prefecture'
            WHEN tags->'government' IN ('social_security', 'social_services', 'social_welfare') THEN 'social'
            WHEN tags->'government' = 'employment_agency' THEN 'employment'
            WHEN tags->'government' = 'customs' THEN 'customs'
            WHEN tags->'government' IN ('parliament', 'legislative', 'ministry', 'presidency', 'cabinet') THEN 'national'
            ELSE 'government' END
        WHEN type = 'courthouse' THEN 'courthouse'
        WHEN type = 'prison' THEN 'prison'
        WHEN type IN ('embassy', 'diplomatic') THEN 'embassy'
        WHEN type = 'university' THEN 'university'
        -- religion
        WHEN type = 'place_of_worship' THEN CASE
            WHEN tags->'religion' IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh') THEN tags->'religion'
            ELSE 'worship' END
        -- fuel (a storage tank only if it holds fuel or gas; depots are Oil & Natural
        -- Gas's: upstream's petroleum sites)
        WHEN type = 'fuel' THEN 'fuel'
        WHEN type = 'storage_tank' THEN CASE
            WHEN tags->'content' IN ('fuel', 'oil', 'diesel', 'petrol', 'gasoline', 'kerosene', 'gas',
                                     'natural_gas', 'lpg', 'lng', 'biogas', 'hydrocarbons') THEN 'storage_tank' END
        -- transport
        WHEN type = 'aerodrome' THEN 'airport'
        WHEN type = 'port' OR key = 'harbour' THEN 'port'
        WHEN type = 'border_control' THEN 'border'
        WHEN type = 'yard' THEN 'rail_yard'
        -- police and gendarmerie: by police:FR (France's tag), else the operator, else
        -- the name; a camera tagged police isn't a station
        WHEN type = 'police' AND tags->'name' ~* 'cam[ée]ra' THEN NULL
        -- customs offices mapped as police stations (but the gendarmerie's own)
        WHEN type = 'police' AND tags->'name' ~* '\mdouanes?\M' AND NOT is_gendarmerie(tags) THEN 'customs'
        WHEN type = 'police' THEN CASE
            WHEN tags->'police:FR' = 'gendarmerie' THEN 'gendarmerie'
            WHEN tags->'police:FR' ~* 'municipale|rurale' THEN 'police_municipal'
            WHEN tags->'police:FR' ~* '^(police|police_nationale|CRS)$' THEN 'police_national'
            WHEN is_gendarmerie(tags) OR tags->'name' ~* '^brigade|\mescadron' THEN 'gendarmerie'
            WHEN tags->'operator' ~* '^(police nationale|ministère de l''intérieur|préfecture de police)'
              OR tags->'name' ~* 'commissariat|police nationale|h[ôo]tel de police|pr[ée]fecture de police|police aux fronti|\mC\.?R\.?S\M|police autoroute'
              THEN 'police_national'
            WHEN tags->'operator' ~* 'municipal|^ville |^mairie|^commune '
              OR tags->'name' ~* 'munici|minicipal|police rurale' THEN 'police_municipal'
            ELSE 'police' END
        -- military: in use (but the gendarmerie's), and disused fortifications
        WHEN (key = 'landuse' AND type = 'military') OR key = 'military' THEN military_kind(key, type, tags)
        -- food supply
        WHEN type = 'silo' THEN 'silo'
        WHEN type = 'slaughterhouse' THEN 'slaughterhouse'
        WHEN type = 'distributor' THEN 'distribution'
        WHEN type = 'wholesale' THEN 'wholesale'
        WHEN type = 'supermarket' THEN 'supermarket'
        WHEN type = 'convenience' THEN 'convenience'
        -- water and waste, monitoring
        WHEN type = 'dam' THEN 'dam'
        WHEN type = 'landfill' THEN 'landfill'
        WHEN type = 'monitoring_station' THEN CASE
            WHEN tags->'monitoring:weather' = 'yes' OR tags ? 'radar' OR tags->'monitoring:radar' = 'yes' THEN 'weather' END
    END
$$;

CREATE OR REPLACE FUNCTION site_category(kind text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN kind IN ('hospital', 'clinic', 'pharmacy', 'fire_station', 'ambulance', 'siren') THEN 'health'
        WHEN kind IN ('gendarmerie', 'police_national', 'police_municipal', 'police', 'customs', 'border') THEN 'police'
        WHEN kind IN ('townhall', 'tax', 'prefecture', 'social', 'employment', 'national', 'government',
                      'courthouse', 'prison', 'embassy', 'university') THEN 'government'
        WHEN kind IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'worship') THEN 'religion'
        WHEN kind IN ('fuel', 'storage_tank') THEN 'fuel'
        WHEN kind IN ('airport', 'port', 'rail_yard') THEN 'transport'
        WHEN kind IN ('military_area', 'military_base', 'military_office', 'military_depot', 'military_range',
                      'military_fort', 'military_radio', 'military_school', 'military_disused',
                      'shooting_stand') THEN 'military'
        WHEN kind IN ('silo', 'slaughterhouse', 'distribution', 'wholesale', 'supermarket', 'convenience') THEN 'food'
        WHEN kind IN ('dam', 'landfill', 'weather') THEN 'water_waste'
    END
$$;

-- 0: from zoom 8 (national institutions, hospitals, airports with a code,
-- cathedrals, large military areas...), 1: from zoom 12, 2: from zoom 14 (the many
-- small ones: pharmacies, churches, town halls, silos, bunkers...).
CREATE OR REPLACE FUNCTION site_importance(kind text, tags hstore, area float) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN kind IN ('national', 'prefecture', 'hospital', 'prison', 'border', 'dam')
          OR (kind LIKE 'military\_%' AND kind <> 'military_disused' AND area > 220000)
          OR (kind = 'airport' AND (tags ? 'iata' OR tags ? 'icao'))
          OR (kind IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'worship')
              AND tags->'building' IN ('cathedral', 'basilica'))
          OR (kind IN ('port', 'landfill') AND area > 90000) THEN 0
        -- Churches and town halls: most French ones have a Wikidata entry, so that
        -- doesn't make them stand out (58,000 and 37,000).
        WHEN kind IN ('christian', 'townhall') THEN 2
        -- Supermarkets: hypermarkets (a building over 5,000 m²) from zoom 12, the
        -- rest from zoom 14.
        WHEN kind = 'supermarket' THEN CASE WHEN area > 5000 THEN 1 ELSE 2 END
        -- Convenience stores: many small ones, from zoom 14.
        WHEN kind = 'convenience' THEN 2
        WHEN kind IN ('pharmacy', 'worship', 'silo', 'military_disused', 'fuel')
          AND NOT tags ? 'wikidata' THEN 2
        ELSE 1
    END
$$;

-- What Tegola serves (sites_point, sites_area): materialized, as the data only
-- changes with a rebuild. A kind set by hand (site-overrides.sql) comes before what
-- the tags and name say. A storage tank already drawn by the Oil & Natural Gas layer
-- (upstream's osm_petroleum_site: the same object, or inside its oil or gas site)
-- is left to it: drawn once.
--
-- A gendarmerie's compound is often mapped as a military area with its station
-- inside: one item, the area as a gendarmerie (the station's name and tags), the
-- station not drawn apart. An area is a compound when it has no name of its own, a
-- gendarmerie station inside, no army site inside, and is small (under 5 ha):
-- army bases (named, larger, or with their own sites) stay military, a station
-- inside them apart. (A military area named for the gendarmerie is one already:
-- site_kind.)
--
-- Military sites take what the sites around and inside them say (a site's own kind
-- comes first when it says more than "military area"):
-- - up: a military area, or a disused one, with sites in use inside takes the
--   commonest kind among them that says more (a historic fort with a radar station
--   inside is one), else is a military area in use;
-- - down: a military area, a disused site or a shooting stand inside a site in use
--   takes the kind of the smallest around it that says more (the areas and bunkers
--   inside a depot are the depot), else is a military area in use (a stand: a range);
-- - a shooting stand with nothing around it is a range when large (1 ha or more),
--   else a club's: left out.
DROP MATERIALIZED VIEW IF EXISTS site_feature;
CREATE MATERIALIZED VIEW site_feature AS
WITH s AS (
    SELECT o.id AS site_id, o.osm_id, o.geometry, o.name, o.tags,
           coalesce(fixed.kind, site_kind(o.key, o.type, o.tags)) AS kind,
           CASE WHEN ST_GeometryType(o.geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                THEN oim_ground_area(o.geometry) ELSE 0 END AS area
      FROM osm_site o LEFT JOIN site_override fixed ON fixed.osm_id = o.osm_id AND fixed.name = o.name
), kept AS (
    SELECT * FROM s
     WHERE kind IS NOT NULL
       AND NOT (kind = 'storage_tank' AND EXISTS (
           SELECT 1 FROM osm_petroleum_site p
            WHERE p.osm_id = s.osm_id
               OR (p.geometry && s.geometry AND ST_Intersects(p.geometry, ST_PointOnSurface(s.geometry)))))
), military AS (
    -- The military sites: whether their own kind says more than "military area", and
    -- whether they're in use.
    SELECT site_id, kind, area,
           kind NOT IN ('military_area', 'military_disused', 'shooting_stand') AS says_more,
           kind NOT IN ('military_disused', 'shooting_stand') AS in_use
      FROM kept WHERE site_category(kind) = 'military'
), within AS (
    -- Each military site inside a larger one (found through osm_site's index).
    SELECT inner_site.site_id AS inner_id, outer_site.site_id AS outer_id, outer_site.area AS outer_area
      FROM kept k
           JOIN military inner_site ON inner_site.site_id = k.site_id
           JOIN osm_site o ON o.geometry && k.geometry AND o.id <> k.site_id
                          AND ST_Contains(o.geometry, ST_PointOnSurface(k.geometry))
           JOIN military outer_site ON outer_site.site_id = o.id AND outer_site.area > inner_site.area
), up AS (
    -- An area, or a disused one, with sites in use inside: their commonest kind that
    -- says more, else military_area.
    SELECT DISTINCT ON (w.outer_id) w.outer_id AS site_id,
           CASE WHEN i.says_more THEN i.kind ELSE 'military_area' END AS kind
      FROM within w
           JOIN military i ON i.site_id = w.inner_id AND i.in_use
           JOIN military o ON o.site_id = w.outer_id AND NOT o.says_more AND o.kind <> 'shooting_stand'
     GROUP BY w.outer_id, i.says_more, i.kind
     ORDER BY w.outer_id, i.says_more DESC, count(*) DESC
), after_up AS (
    SELECT m.site_id, coalesce(u.kind, m.kind) AS kind, m.area FROM military m LEFT JOIN up u USING (site_id)
), down AS (
    -- A site that says no more, inside sites in use: the smallest of them that says
    -- more, else one that doesn't (military_area).
    SELECT DISTINCT ON (w.inner_id) w.inner_id AS site_id, o.kind
      FROM within w
           JOIN after_up i ON i.site_id = w.inner_id
                          AND i.kind IN ('military_area', 'military_disused', 'shooting_stand')
           JOIN after_up o ON o.site_id = w.outer_id AND o.kind NOT IN ('military_disused', 'shooting_stand')
     ORDER BY w.inner_id, o.kind = 'military_area', w.outer_area
), military_final AS (
    SELECT a.site_id, CASE
               WHEN a.kind = 'shooting_stand' AND d.kind IS NULL AND a.area < 10000 THEN NULL
               WHEN a.kind = 'shooting_stand' AND coalesce(d.kind, 'military_area') = 'military_area'
                   THEN 'military_range'
               ELSE coalesce(d.kind, a.kind) END AS kind
      FROM after_up a LEFT JOIN down d USING (site_id)
), station_in AS (
    -- Each gendarmerie station inside an unnamed, small military area.
    SELECT a.site_id AS area_id, st.site_id AS station_id
      FROM kept a JOIN kept st ON st.kind = 'gendarmerie' AND st.site_id <> a.site_id
       AND st.geometry && a.geometry AND ST_Intersects(a.geometry, ST_PointOnSurface(st.geometry))
     WHERE a.kind = 'military_area' AND coalesce(a.name, '') = '' AND a.area < 50000
), compound AS (
    -- Those areas without an army site inside, with one of their stations.
    SELECT i.area_id, min(i.station_id) AS station_id
      FROM station_in i
     WHERE NOT EXISTS (
           SELECT 1 FROM within w JOIN military m ON m.site_id = w.inner_id AND m.says_more
            WHERE w.outer_id = i.area_id)
     GROUP BY i.area_id
), merged AS (
    SELECT k.osm_id, k.geometry,
           CASE WHEN c.area_id IS NULL THEN k.name ELSE st.name END AS name,
           CASE WHEN c.area_id IS NOT NULL THEN 'gendarmerie'
                WHEN m.site_id IS NOT NULL THEN m.kind
                ELSE k.kind END AS kind,
           CASE WHEN c.area_id IS NULL THEN k.tags ELSE k.tags || st.tags END AS tags,
           k.area
      FROM kept k
           LEFT JOIN military_final m ON m.site_id = k.site_id
           LEFT JOIN compound c ON c.area_id = k.site_id
           LEFT JOIN kept st ON st.site_id = c.station_id
     WHERE NOT EXISTS (
           SELECT 1 FROM station_in i JOIN compound c2 ON c2.area_id = i.area_id WHERE i.station_id = k.site_id)
)
SELECT row_number() OVER () AS id, osm_id, geometry, name, kind, site_category(kind) AS category,
       site_importance(kind, tags, area) AS importance, tags, area
  FROM merged
 WHERE kind IS NOT NULL;
CREATE INDEX site_feature_geometry ON site_feature USING gist (geometry);
CREATE INDEX site_feature_importance ON site_feature (importance);

-- What a site is grouped with below zoom 14: its category's, but disused military
-- sites apart (grey groups: modules/sites/style.ts KIND_COLOURS).
CREATE OR REPLACE FUNCTION site_group(kind text, category text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN kind = 'military_disused' THEN kind ELSE category END
$$;

-- One point per site for a tile (Tegola's sites_point), grouped below zoom 14: in
-- a grid of 12 x 12 cells per tile (~40 px), the sites of a group (site_group) sharing a cell
-- become one point with their count (count > 1, kind NULL) at their average
-- position, counting only kinds with two or more there: a kind's lone site in a
-- cell stays a site, so the map, hiding kinds, never shows a group of one. The grid
-- is aligned with the tiles, so a group never straddles two. Important sites
-- (importance 0) stay as they are from zoom 8; from zoom 14 nothing is grouped. A
-- group also says how many of each kind it holds (kinds: ",fuel:12,storage_tank:3,"),
-- so the map can count only the kinds shown (ui/key/counted-groups.ts).
DROP FUNCTION IF EXISTS site_points(geometry, integer);
CREATE FUNCTION site_points(bbox geometry, zoom integer)
RETURNS TABLE (id bigint, osm_id bigint, geometry geometry, name text, kind text, category text,
               importance integer, tags hstore, count integer, count_label text, kinds text)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    WITH p AS (
        SELECT f.id, f.osm_id, c.pt AS geometry, f.name, f.kind, f.category, site_group(f.kind, f.category) AS grp,
               f.importance, f.tags,
               CASE WHEN zoom < 14 AND (f.importance > 0 OR zoom < 8)
                    THEN floor((ST_X(c.pt) + 20037508.342789244) / g.cell)::bigint END AS cx,
               floor((ST_Y(c.pt) + 20037508.342789244) / g.cell)::bigint AS cy
          FROM site_feature f
               CROSS JOIN LATERAL (SELECT ST_Centroid(f.geometry) AS pt) c
               CROSS JOIN (SELECT 40075016.68557849 / power(2, zoom) / 12 AS cell) g
         WHERE f.geometry && bbox
    ), counted AS (
        -- How many of its kind share its cell.
        SELECT p.*, count(*) OVER (PARTITION BY p.grp, p.kind, p.cx, p.cy)::integer AS of_kind FROM p
    ), grouped AS (
        SELECT counted.category, counted.grp, counted.cx, counted.cy, counted.kind, count(*)::integer AS n,
               min(counted.id) AS first_id, sum(ST_X(counted.geometry)) AS sum_x, sum(ST_Y(counted.geometry)) AS sum_y
          FROM counted WHERE counted.cx IS NOT NULL AND counted.of_kind > 1
         GROUP BY counted.category, counted.grp, counted.cx, counted.cy, counted.kind
    ), groups AS (
        SELECT grouped.category, grouped.grp, grouped.cx, grouped.cy, sum(grouped.n)::integer AS n, min(grouped.first_id) AS first_id,
               sum(grouped.sum_x) / sum(grouped.n) AS x, sum(grouped.sum_y) / sum(grouped.n) AS y,
               ',' || string_agg(grouped.kind || ':' || grouped.n, ',' ORDER BY grouped.kind) || ',' AS kinds
          FROM grouped
         GROUP BY grouped.category, grouped.grp, grouped.cx, grouped.cy
    )
    SELECT counted.id, counted.osm_id, counted.geometry, counted.name, counted.kind, counted.category,
           counted.importance, counted.tags, 1, NULL, NULL
      FROM counted
     WHERE cx IS NULL OR of_kind = 1
    UNION ALL
    SELECT -groups.first_id, NULL,
           ST_SetSRID(ST_MakePoint(groups.x + 10 * px * sin(angle), groups.y + 10 * px * cos(angle)), 3857),
           NULL, NULL, groups.category, NULL, NULL, groups.n,
           CASE WHEN groups.n < 1000 THEN groups.n::text
                WHEN groups.n < 10000 THEN trim_scale(round(groups.n / 1000.0, 1)) || 'k'
                ELSE round(groups.n / 1000.0) || 'k' END,
           groups.kinds
      FROM groups
           -- Groups of different kinds in one place would sit on top of each other:
           -- each group's is moved ~10 px (on a 512 px tile) its own way.
           CROSS JOIN LATERAL (SELECT ARRAY['health', 'government', 'religion', 'fuel', 'transport', 'military',
                                            'food', 'water_waste', 'police', 'military_disused'] AS all_groups) g
           CROSS JOIN LATERAL (SELECT 2 * pi() * (array_position(g.all_groups, groups.grp) - 1)
                                      / cardinality(g.all_groups) AS angle) a
           CROSS JOIN (SELECT 40075016.68557849 / power(2, zoom) / 512 AS px) s
$$;
