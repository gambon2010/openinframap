-- Fork: critical sites (imposm/sites.py imports them all into osm_site): what each
-- one is. Sorts each into a category and a kind, and how important it is, which
-- decides from which zoom it shows (0: zoom 8, 1: zoom 12, 2: zoom 14; see
-- tegola/layers.yml). Rows that fit no kind (e.g. a water tank, a WWII bomb crater)
-- are left out. Military sites are also sorted by their names (site-rules.sql);
-- the sites around and inside them, and the kinds set by hand (site-overrides.sql),
-- are site_feature's (sites.sql).
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
            -- Offices tagged no more than government, their names saying what they are.
            WHEN tags->'name' ~* 'finances publiques|trésorerie|centre des impôts|service des impôts' THEN 'tax'
            WHEN tags->'name' ~* '^(mairie|h[ôo]tel de ville)\M' THEN 'townhall'
            -- The armed forces' national service centres (DSNJ).
            WHEN tags->'name' ~* '^CSNJ\M|service national et de la jeunesse' THEN 'military_office'
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
