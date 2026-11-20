-- Fork: critical sites (imposm/sites.py imports them all into osm_site). Sorts
-- each into a category and a kind, and how important it is, which decides from
-- which zoom it shows (0: zoom 8, 1: zoom 12, 2: zoom 14; see tegola/layers.yml).
-- Rows that fit no kind (e.g. a water tank, a WWII bomb crater) are left out.
-- Military sites are also sorted by their names (site-rules.sql) and by the sites
-- around and inside them (site_feature); some are set by hand (site-overrides.sql).
-- Safe to run more than once. The functions set their search_path: Postgres builds
-- materialized views with a restricted one, where hstore's -> isn't visible.

-- A site of the gendarmerie, by its operator ("Groupement blindé de gendarmerie
-- mobile" too), its name, other name or description ("Quartier Savary", alt_name
-- "Escadron 33/7 de Gendarmerie mobile"), or military_service (OpenStreetMap's
-- police=* is hardly used in France).
-- "Brigade" and "Escadron" name gendarmerie units only at a police station: the army
-- and air force have their own (site_kind).
CREATE OR REPLACE FUNCTION is_gendarmerie(tags hstore) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT concat_ws(' ', tags->'operator', tags->'name', tags->'alt_name', tags->'description') ~* '\mgendarmerie'
        OR coalesce(tags->'military_service' = 'gendarmerie', false)
$$;

-- A military area or site no longer in use: a fortification (a bunker, a fort...),
-- tagged disused or abandoned, named "Ancien..." or "ex-..." (former), gone ("disparu"...) or a
-- bunker ("Bunker", "Unterstand", "Abri de combat"), or historic or a disused
-- aerodrome (Grostenquin's air base), but not when it shows use (an in-use military
-- type, a barracks' name: a regiment on a former air base).
-- Some historic forts are still the army's: site-overrides.sql says so for those
-- known; site_feature also takes those with sites in use inside, or around them, as
-- in use.
CREATE OR REPLACE FUNCTION is_disused_military(tags hstore) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(tags->'military' IN ('bunker', 'trench', 'embrasure', 'casemate', 'cupola', 'abandoned', 'battery',
                                         'blockhouse', 'pillbox', 'fort', 'gun_emplacement', 'shelter', 'disused'), false)
        OR coalesce(tags->'building' = 'bunker', false)
        OR tags ?| ARRAY['disused', 'abandoned', 'disused:military', 'abandoned:military', 'was:military']
        OR coalesce(tags->'name' ~* '^(l'')?anciens?n?e?s?\M|^ex[- ]|\m(disparue?s?|d[ée]truite?s?|d[ée]molie?s?|en ruines?)\M|\mbunker|unterstand|abri de combat', false)
        OR (tags ?| ARRAY['historic', 'disused:aeroway', 'abandoned:aeroway']
            AND NOT coalesce(tags->'military' IN ('barracks', 'base', 'naval_base', 'airfield', 'office', 'checkpoint',
                                                  'ammunition', 'depot', 'range', 'training_area', 'danger_area'), false)
            AND NOT coalesce(tags->'name' ~* 'caserne|quartier', false))
$$;

-- A military site that was an airfield: an aerodrome, tagged as a disused or
-- historic one, or named as one (site-rules.sql's airfield rule: "Ancienne base
-- aérienne"). sites.sql's site_feature shows a disused one as a former airfield.
CREATE OR REPLACE FUNCTION was_military_airfield(tags hstore) RETURNS boolean
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT coalesce(tags->'aeroway' = 'aerodrome', false)
        OR 'aerodrome' IN (tags->'disused:aeroway', tags->'abandoned:aeroway', tags->'historic:aeroway', tags->'was:aeroway')
        OR 'airfield' IN (tags->'disused:military', tags->'abandoned:military', tags->'was:military')
        OR EXISTS (SELECT 1 FROM military_name_rule rule
                    WHERE rule.kind = 'military_airfield' AND tags->'name' ~* rule.pattern)
$$;

-- A military site's kind by its military=* value alone: military_area when it says
-- no more than military (yes); NULL for one that isn't a site (an obstacle course...).
CREATE OR REPLACE FUNCTION military_kind_by_tags(type text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN type = 'yes' THEN 'military_area'
        WHEN type = 'airfield' THEN 'military_airfield'
        WHEN type = 'naval_base' THEN 'military_naval_base'
        WHEN type IN ('barracks', 'base') THEN 'military_base'
        WHEN type IN ('office', 'checkpoint') THEN 'military_office'
        WHEN type IN ('ammunition', 'depot') THEN 'military_depot'
        WHEN type IN ('range', 'training_area', 'danger_area') THEN 'military_range'
    END
$$;

-- A military site's kind: the gendarmerie's, disused, else what its name says
-- (site-rules.sql) where its tags say no more than military, it's a military
-- landuse (whose military=* is a hint: "DGA Essais de missiles" is tagged a range) or
-- the rule outweighs them, else what its tags say. NULL: not military (a club's), or
-- not a site.
CREATE OR REPLACE FUNCTION military_kind(key text, type text, tags hstore) RETURNS text
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN is_gendarmerie(tags) THEN 'gendarmerie'
        WHEN is_disused_military(tags) THEN 'military_disused'
        WHEN by_name.replaces_tags OR by_tags.kind = 'military_area' OR key = 'landuse'
            THEN nullif(coalesce(by_name.kind, by_tags.kind), 'not_military')
        ELSE by_tags.kind
    END
      FROM (SELECT military_kind_by_tags(type) AS kind WHERE key = 'military'
            UNION ALL
            -- landuse=military: the importer keeps one key per object, so its
            -- military=* (range, barracks...) is read from the tags.
            SELECT coalesce(military_kind_by_tags(tags->'military'), 'military_area') WHERE key = 'landuse') by_tags
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
        -- an aerodrome that is the army's alone (a civilian one with a military part
        -- stays an airport; the part is a military site of its own)
        WHEN type = 'aerodrome' AND (tags->'military' = 'airfield' OR tags->'landuse' = 'military'
                                     OR tags->'aerodrome:type' = 'military') THEN
            CASE WHEN is_disused_military(tags) THEN 'military_disused' ELSE 'military_airfield' END
        -- a closed civil airfield (shown with the airports, its icon grey)
        WHEN type = 'aerodrome' AND (tags ?| ARRAY['disused', 'abandoned'] OR tags->'name' ~* '^anciens?n?e?s?\M')
            THEN 'airport_disused'
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
              OR tags->'name' ~* 'commissariat|police nationale|[ée]cole nationale de police|h[ôo]tel de police|pr[ée]fecture de police|police aux fronti|\mC\.?R\.?S\M|police autoroute'
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
        WHEN kind IN ('airport', 'airport_disused', 'port', 'rail_yard') THEN 'transport'
        WHEN kind IN ('military_area', 'military_base', 'military_airfield', 'military_naval_base', 'military_office', 'military_depot', 'military_range',
                      'military_fort', 'military_radio', 'military_school', 'military_research', 'military_disused',
                      'military_airfield_disused', 'shooting_stand', 'military_camp') THEN 'military'
        WHEN kind IN ('silo', 'slaughterhouse', 'distribution', 'wholesale', 'supermarket', 'convenience') THEN 'food'
        WHEN kind IN ('dam', 'landfill', 'weather') THEN 'water_waste'
    END
$$;

-- Kinds that say little within their category (the catch-alls): a twin's kind that
-- says more is taken instead (site_feature).
CREATE OR REPLACE FUNCTION site_kind_says_little(kind text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT kind IN ('government', 'worship', 'police', 'military_area')
$$;

-- 0: from zoom 8 (national institutions, hospitals, airports with a code,
-- cathedrals, large military areas...), 1: from zoom 12, 2: from zoom 14 (the many
-- small ones: pharmacies, churches, town halls, silos, bunkers...).
CREATE OR REPLACE FUNCTION site_importance(kind text, tags hstore, area float) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE
        WHEN kind IN ('national', 'prefecture', 'hospital', 'prison', 'border', 'dam')
          OR (kind LIKE 'military\_%' AND kind NOT IN ('military_disused', 'military_airfield_disused') AND area > 220000)
          OR (kind IN ('airport', 'military_airfield') AND (tags ? 'iata' OR tags ? 'icao'))
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
-- A gendarmerie's compound is often mapped as a military area (or barracks) with its station
-- inside: one item, the area as a gendarmerie (its name, else the station's; the
-- station's tags), the station not drawn apart. An area is a compound when it has a
-- gendarmerie station inside, no army site inside, and is small: unnamed and under
-- 5 ha, or a "Caserne ..." under 10 ha (the gendarmerie's barracks are casernes
-- named for a gendarme, "Caserne Capitaine Guillo"; the army's are mostly
-- "Quartier ..."). Army bases (larger, or with their own sites) stay military, a
-- station inside them apart. The unnamed military pieces inside a gendarmerie's site
-- (the buildings of its schools) aren't drawn: the site stands for them. (A
-- military area named for the gendarmerie is one already: site_kind.)
--
-- Military sites take what the sites around and inside them say (a site's own kind
-- comes first when it says more than "military area"):
-- - up: a military area, or a disused one, with sites in use inside takes the
--   commonest kind among them that says more (a historic fort with a radar station
--   inside is one), else is a military area in use;
-- - down: a military area, a disused site or a shooting stand inside a site in use
--   takes the kind of the smallest around it that says more (the areas and bunkers
--   inside a depot are the depot), else is a military area in use (a stand: a range;
--   a disused site stays disused: an area saying no more doesn't show it's used);
--   never an airfield's kind (nor up, nor to an annex): a shooting stand or an
--   old shelter on one isn't an airfield (its unnamed pieces aren't drawn, below);
-- - a shooting stand with nothing around it is a range when large (1 ha or more),
--   else a club's: left out;
-- - a camp (site-rules.sql) is a training ground from 90 ha, else a garrison (base),
--   before any of this;
-- - a military area still saying no more after this: a radio station when a radio,
--   radar or signal tower stands in it (the Navy's sémaphores), else the annex of a
--   named site in use it touches (of its kind), else disused when only disused sites
--   are in it or touch it;
-- - the unnamed pieces of a military airfield (guard posts, plots), and the points of
--   its flying units ("Escadron de chasse 1/3 Navarre"), aren't drawn: the airfield
--   stands for them;
-- - a disused site that was an airfield (was_military_airfield) is a former airfield,
--   whatever is in it now (Broyes-lès-Pesmes's old air base, the Graves radar inside:
--   the radar is drawn on its own).
--
-- One thing mapped twice (a building and its grounds, a point inside its area: the
-- same name and category, touching) is drawn once: the larger, with the other's kind
-- when its own says little (site_kind_says_little: a prefecture mapped as an office
-- and as government=prefecture).
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
), military_own AS (
    -- The military sites, camps as what their size says.
    SELECT site_id, area, CASE
               WHEN kind <> 'military_camp' THEN kind
               WHEN area >= 900000 THEN 'military_range'
               ELSE 'military_base' END AS kind
      FROM kept WHERE site_category(kind) = 'military'
), military AS (
    -- Whether their own kind says more than "military area", and whether they're in use.
    SELECT site_id, kind, area,
           kind NOT IN ('military_area', 'military_disused', 'shooting_stand') AS says_more,
           -- An airfield's kind isn't passed on (up, down, to an annex): a range with a
           -- heliport, or a stand on an airfield, isn't one.
           kind NOT IN ('military_area', 'military_disused', 'shooting_stand', 'military_airfield') AS lends_kind,
           kind NOT IN ('military_disused', 'shooting_stand') AS in_use
      FROM military_own
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
           CASE WHEN i.lends_kind THEN i.kind ELSE 'military_area' END AS kind
      FROM within w
           JOIN military i ON i.site_id = w.inner_id AND i.in_use
           JOIN military o ON o.site_id = w.outer_id AND NOT o.says_more AND o.kind <> 'shooting_stand'
     GROUP BY w.outer_id, i.lends_kind, i.kind
     ORDER BY w.outer_id, i.lends_kind DESC, count(*) DESC
), after_up AS (
    SELECT m.site_id, coalesce(u.kind, m.kind) AS kind, m.area FROM military m LEFT JOIN up u USING (site_id)
), down AS (
    -- A site that says no more, inside sites in use: the smallest of them that says
    -- more, else one that doesn't (military_area).
    SELECT DISTINCT ON (w.inner_id) w.inner_id AS site_id, o.kind
      FROM within w
           JOIN after_up i ON i.site_id = w.inner_id
                          AND i.kind IN ('military_area', 'military_disused', 'shooting_stand')
           JOIN after_up o ON o.site_id = w.outer_id
                          AND o.kind NOT IN ('military_disused', 'shooting_stand', 'military_airfield')
                          AND NOT (i.kind = 'military_disused' AND o.kind = 'military_area')
     ORDER BY w.inner_id, o.kind = 'military_area', w.outer_area
), military_final AS (
    SELECT a.site_id, CASE
               WHEN a.kind = 'shooting_stand' AND d.kind IS NULL AND a.area < 10000 THEN NULL
               WHEN a.kind = 'shooting_stand' AND coalesce(d.kind, 'military_area') = 'military_area'
                   THEN 'military_range'
               ELSE coalesce(d.kind, a.kind) END AS kind
      FROM after_up a LEFT JOIN down d USING (site_id)
), generic AS (
    -- The military areas that still say no more, with their outlines (the sites they
    -- touch are found through osm_site's index).
    SELECT k.site_id, k.geometry
      FROM military_final m JOIN kept k USING (site_id) WHERE m.kind = 'military_area'
), radio_tower AS (
    -- Radio, radar and signal towers (the Navy's watchtowers are its sémaphores), and
    -- antennas; not a mobile phone mast standing on military land.
    SELECT geometry FROM osm_mast
     WHERE (type IN ('communication', 'radar') OR (type = 'watchtower' AND tags->'operator' ~* 'marine'))
       AND NOT coalesce(tags->'communication:mobile_phone' = 'yes' OR tags->'operator' ~* 'bouygues|orange|\mSFR\M|\mfree\M', false)
    UNION ALL
    SELECT geometry FROM osm_telecom_antenna
     WHERE NOT coalesce(tags->'communication:mobile_phone' = 'yes' OR tags->'operator' ~* 'bouygues|orange|\mSFR\M|\mfree\M', false)
), by_tower AS (
    SELECT DISTINCT g.site_id, 'military_radio' AS kind
      FROM generic g JOIN radio_tower t ON t.geometry && g.geometry AND ST_Intersects(g.geometry, t.geometry)
), by_neighbour AS (
    -- Touching a named site in use: its annex, of its kind (the largest's).
    SELECT DISTINCT ON (g.site_id) g.site_id, m.kind
      FROM generic g
           JOIN osm_site n ON n.geometry && g.geometry AND n.id <> g.site_id AND ST_Intersects(n.geometry, g.geometry)
           JOIN military_final m ON m.site_id = n.id AND m.kind NOT IN ('military_area', 'military_disused', 'military_airfield')
     WHERE coalesce(n.name, '') <> ''
     ORDER BY g.site_id, ST_Area(n.geometry) DESC
), by_ruins AS (
    -- Only disused sites in it or touching it (nothing in use: up would have said):
    -- the grounds of a battery, a fort.
    SELECT DISTINCT g.site_id, 'military_disused' AS kind
      FROM generic g
           JOIN osm_site n ON n.geometry && g.geometry AND n.id <> g.site_id AND ST_Intersects(n.geometry, g.geometry)
           JOIN military_final m ON m.site_id = n.id AND m.kind = 'military_disused'
), former_airfield AS (
    SELECT o.site_id
      FROM military_own o JOIN kept k USING (site_id)
     WHERE o.kind = 'military_disused' AND was_military_airfield(k.tags)
), military_resolved AS (
    -- A military area still saying no more: what stands in it, or around it, says.
    SELECT m.site_id,
           CASE WHEN f.site_id IS NOT NULL THEN 'military_airfield_disused'
                ELSE coalesce(t.kind, n.kind, r.kind, m.kind) END AS kind
      FROM military_final m
           LEFT JOIN former_airfield f USING (site_id)
           LEFT JOIN by_tower t USING (site_id)
           LEFT JOIN by_neighbour n USING (site_id)
           LEFT JOIN by_ruins r USING (site_id)
), part_of_airfield AS (
    -- The unnamed pieces of a military airfield (guard posts, fenced plots, barracks),
    -- and its flying units' points: the airfield stands for them, they aren't drawn apart.
    SELECT DISTINCT w.inner_id AS site_id
      FROM within w
           JOIN military_resolved i ON i.site_id = w.inner_id
                                   AND i.kind IN ('military_area', 'military_base', 'military_airfield', 'military_office')
           JOIN military_resolved o ON o.site_id = w.outer_id AND o.kind = 'military_airfield'
           JOIN kept k ON k.site_id = w.inner_id
     WHERE coalesce(k.name, '') = '' OR (i.kind = 'military_airfield' AND k.area = 0)
), part_of_gendarmerie AS (
    -- The unnamed military pieces inside a gendarmerie's site (its schools' buildings).
    SELECT DISTINCT m.site_id
      FROM military_resolved m
           JOIN kept k ON k.site_id = m.site_id AND coalesce(k.name, '') = ''
           JOIN osm_site g ON g.geometry && k.geometry AND g.id <> k.site_id
                          AND ST_Contains(g.geometry, ST_PointOnSurface(k.geometry))
     WHERE m.kind IN ('military_area', 'military_base', 'military_office')
       AND site_kind(g.key, g.type, g.tags) = 'gendarmerie'
       AND oim_ground_area(g.geometry) > k.area
), station_in AS (
    -- Each gendarmerie station inside an unnamed, small military area.
    SELECT a.site_id AS area_id, st.site_id AS station_id
      FROM kept a JOIN kept st ON st.kind = 'gendarmerie' AND st.site_id <> a.site_id
       AND st.geometry && a.geometry AND ST_Intersects(a.geometry, ST_PointOnSurface(st.geometry))
     WHERE (a.kind IN ('military_area', 'military_base') AND coalesce(a.name, '') = '' AND a.area < 50000)
        OR (a.kind = 'military_base' AND a.name ~* '^caserne\M' AND a.area < 100000)
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
           CASE WHEN c.area_id IS NULL OR coalesce(k.name, '') <> '' THEN k.name ELSE st.name END AS name,
           CASE WHEN c.area_id IS NOT NULL THEN 'gendarmerie'
                WHEN m.site_id IS NOT NULL THEN m.kind
                ELSE k.kind END AS kind,
           CASE WHEN c.area_id IS NULL THEN k.tags
                WHEN coalesce(k.name, '') <> '' THEN st.tags || k.tags
                ELSE k.tags || st.tags END AS tags,
           k.area
      FROM kept k
           LEFT JOIN military_resolved m ON m.site_id = k.site_id
           LEFT JOIN compound c ON c.area_id = k.site_id
           LEFT JOIN kept st ON st.site_id = c.station_id
     WHERE NOT EXISTS (
           SELECT 1 FROM station_in i JOIN compound c2 ON c2.area_id = i.area_id WHERE i.station_id = k.site_id)
       AND NOT EXISTS (SELECT 1 FROM part_of_airfield p WHERE p.site_id = k.site_id)
       AND NOT EXISTS (SELECT 1 FROM part_of_gendarmerie p WHERE p.site_id = k.site_id)
), numbered AS (
    SELECT row_number() OVER () AS id, merged.*, site_category(kind) AS category
      FROM merged WHERE kind IS NOT NULL
), twin AS (
    -- Each named site and another of the same name and category touching it: one
    -- thing mapped twice. The larger (then the first) is kept.
    SELECT a.id, b.kind AS twin_kind, (b.area, -b.id) > (a.area, -a.id) AS twin_kept
      FROM numbered a JOIN numbered b
        ON b.id <> a.id AND lower(b.name) = lower(a.name) AND b.category = a.category
       AND b.geometry && a.geometry AND ST_Intersects(a.geometry, b.geometry)
     WHERE coalesce(a.name, '') <> ''
), better_kind AS (
    -- A kind that says more, from a twin, for a kept site whose own says little.
    SELECT n.id, min(t.twin_kind) AS kind
      FROM numbered n JOIN twin t ON t.id = n.id AND NOT site_kind_says_little(t.twin_kind)
     WHERE site_kind_says_little(n.kind)
     GROUP BY n.id
)
SELECT n.id, n.osm_id, n.geometry, n.name, coalesce(b.kind, n.kind) AS kind, n.category,
       site_importance(coalesce(b.kind, n.kind), n.tags, n.area) AS importance, n.tags, n.area
  FROM numbered n LEFT JOIN better_kind b ON b.id = n.id
 WHERE NOT EXISTS (SELECT 1 FROM twin t WHERE t.id = n.id AND t.twin_kept);
CREATE INDEX site_feature_geometry ON site_feature USING gist (geometry);
CREATE INDEX site_feature_importance ON site_feature (importance);

-- What a site is grouped with below zoom 14: its category's, but disused military
-- sites apart, former airfields with them (grey groups: modules/sites/style.ts
-- KIND_GROUPS).
CREATE OR REPLACE FUNCTION site_group(kind text, category text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
    SELECT CASE WHEN kind IN ('military_disused', 'military_airfield_disused') THEN 'military_disused' ELSE category END
$$;

-- One point per site for a tile (Tegola's sites_point), grouped below zoom 14: in
-- a grid of 12 x 12 cells per tile (~40 px), the sites of a group (site_group) sharing a cell
-- become one point with their count (count > 1, kind NULL) at their average
-- position, counting only kinds with two or more there: a kind's lone site in a
-- cell stays a site, so the map, hiding kinds, never shows a group of one. The grid
-- is aligned with the tiles, so a group never straddles two. Important sites
-- (importance 0) stay as they are from zoom 8, and military airfields always (the
-- map shows them under Transport too, which doesn't draw Military's groups:
-- modules/sites/style.ts shared_kinds); from zoom 14 nothing is grouped. A
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
               CASE WHEN zoom < 14 AND (f.importance > 0 OR zoom < 8) AND f.kind <> 'military_airfield'
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
