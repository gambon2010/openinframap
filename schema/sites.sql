-- Fork: critical sites (imposm/sites.py imports them all into osm_site). Sorts
-- each into a category and a kind, and how important it is, which decides from
-- which zoom it shows (0: zoom 8, 1: zoom 12, 2: zoom 14; see tegola/layers.yml).
-- Rows that fit no kind (e.g. a water tank, a WWII bomb crater) are left out.
-- Safe to run more than once.

CREATE OR REPLACE FUNCTION site_kind(key text, type text, tags hstore) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        -- health and emergency
        WHEN type = 'hospital' THEN 'hospital'
        WHEN type IN ('clinic', 'centre') THEN 'clinic'
        WHEN type = 'pharmacy' THEN 'pharmacy'
        WHEN type = 'fire_station' THEN 'fire_station'
        WHEN type = 'police' THEN 'police'
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
        -- fuel and weapons (a storage tank only if it holds fuel or gas)
        WHEN type = 'fuel' THEN 'fuel'
        WHEN type IN ('fuel_depot', 'oil_storage') THEN 'fuel_depot'
        WHEN type = 'storage_tank' THEN CASE
            WHEN tags->'content' IN ('fuel', 'oil', 'diesel', 'petrol', 'gasoline', 'kerosene', 'gas',
                                     'natural_gas', 'lpg', 'lng', 'biogas', 'hydrocarbons') THEN 'fuel_depot' END
        WHEN type IN ('weapons', 'gunsmith') THEN 'weapons'
        -- transport
        WHEN type = 'aerodrome' THEN 'airport'
        WHEN type = 'port' OR key = 'harbour' THEN 'port'
        WHEN type = 'border_control' THEN 'border'
        WHEN type = 'yard' THEN 'rail_yard'
        -- military: in use, and disused fortifications
        WHEN key = 'landuse' AND type = 'military' THEN 'military_area'
        WHEN key = 'military' THEN CASE
            WHEN type IN ('bunker', 'trench', 'embrasure', 'casemate', 'cupola', 'abandoned', 'battery',
                          'blockhouse', 'pillbox', 'fort', 'gun_emplacement', 'shelter') THEN 'military_disused'
            WHEN type IN ('barracks', 'office', 'range', 'training_area', 'airfield', 'naval_base', 'base',
                          'danger_area', 'checkpoint', 'yes', 'depot', 'ammunition') THEN 'military'
            END
        -- food supply
        WHEN type = 'silo' THEN 'silo'
        WHEN type = 'slaughterhouse' THEN 'slaughterhouse'
        WHEN type = 'distributor' THEN 'distribution'
        WHEN type = 'wholesale' THEN 'wholesale'
        -- water and waste, monitoring
        WHEN type = 'dam' THEN 'dam'
        WHEN type = 'landfill' THEN 'landfill'
        WHEN type = 'monitoring_station' THEN CASE
            WHEN tags->'monitoring:weather' = 'yes' OR tags ? 'radar' OR tags->'monitoring:radar' = 'yes' THEN 'weather' END
    END
$$;

CREATE OR REPLACE FUNCTION site_category(kind text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN kind IN ('hospital', 'clinic', 'pharmacy', 'fire_station', 'police', 'ambulance', 'siren') THEN 'health'
        WHEN kind IN ('townhall', 'tax', 'prefecture', 'social', 'employment', 'customs', 'national', 'government',
                      'courthouse', 'prison', 'embassy', 'university') THEN 'government'
        WHEN kind IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'worship') THEN 'religion'
        WHEN kind IN ('fuel', 'fuel_depot', 'weapons') THEN 'fuel'
        WHEN kind IN ('airport', 'port', 'border', 'rail_yard') THEN 'transport'
        WHEN kind IN ('military_area', 'military') THEN 'military'
        WHEN kind = 'military_disused' THEN 'military_disused'
        WHEN kind IN ('silo', 'slaughterhouse', 'distribution', 'wholesale') THEN 'food'
        WHEN kind IN ('dam', 'landfill', 'weather') THEN 'water_waste'
    END
$$;

-- 0: from zoom 8 (national institutions, hospitals, airports with a code,
-- cathedrals, military areas...), 1: from zoom 12, 2: from zoom 14 (the many small
-- ones: pharmacies, churches, silos, bunkers...).
CREATE OR REPLACE FUNCTION site_importance(kind text, tags hstore, area float) RETURNS integer
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN kind IN ('national', 'prefecture', 'hospital', 'prison', 'military_area', 'border', 'dam')
          OR (kind = 'airport' AND (tags ? 'iata' OR tags ? 'icao'))
          OR (kind IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'worship')
              AND tags->'building' IN ('cathedral', 'basilica'))
          OR (kind IN ('port', 'landfill', 'fuel_depot') AND area > 200000) THEN 0
        WHEN kind IN ('pharmacy', 'christian', 'worship', 'silo', 'military_disused', 'fuel', 'weapons', 'townhall')
          AND NOT tags ? 'wikidata' THEN 2
        ELSE 1
    END
$$;

-- What Tegola serves (sites_point, sites_area): materialized, as the data only
-- changes with a rebuild.
DROP MATERIALIZED VIEW IF EXISTS site_feature;
CREATE MATERIALIZED VIEW site_feature AS
SELECT row_number() OVER () AS id, osm_id, geometry, name, kind, site_category(kind) AS category,
       site_importance(kind, tags, area) AS importance, tags, area
  FROM (SELECT osm_id, geometry, name, tags, site_kind(key, type, tags) AS kind,
               CASE WHEN ST_GeometryType(geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                    THEN ST_Area(geometry) ELSE 0 END AS area
          FROM osm_site) s
 WHERE kind IS NOT NULL;
CREATE INDEX site_feature_geometry ON site_feature USING gist (geometry);
CREATE INDEX site_feature_importance ON site_feature (importance);
