-- Fork: everything with a name, for the search box (web-backend/src/views/search.py),
-- apart from what it already searches on its own: substations, power plants and
-- places. One row per feature: where it is (a point, EPSG:4326), what it is
-- (source + kind, labelled by web/src/search/openinframap.ts), the layer switcher
-- entry that shows it (layer), and the nearest town to tell apart the many
-- features with the same name ("Mairie", "Château d'eau"...).
--
-- Run after schema/sites.sql and schema/extra.sql; scripts/extra_data.py refreshes
-- it when the extra data changes. Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

-- The layer switcher entry for a pipeline (web/src/openinframap.ts).
CREATE OR REPLACE FUNCTION search_pipeline_layer(substance text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE
        WHEN substance IN ('gas', 'natural_gas', 'oil', 'fuel', 'petroleum', 'hydrocarbons', 'condensate',
                           'lpg', 'lng', 'cng', 'diesel', 'kerosene', 'naphtha', 'ethylene', 'propane') THEN 'O'
        WHEN substance IN ('water', 'drinking_water', 'wastewater', 'sewage', 'rainwater', 'irrigation') THEN 'W'
        ELSE 'I' END
$$;

DROP MATERIALIZED VIEW IF EXISTS search_feature;
CREATE MATERIALIZED VIEW search_feature AS
WITH named AS (
    -- Critical sites (schema/sites.sql); the kind is the site's (hospital, townhall...).
    SELECT 'site' AS source, kind, NULL::text AS subtype, name, tags, tags -> 'operator' AS detail,
           NULL::text AS town, importance,
           CASE category WHEN 'health' THEN 'H' WHEN 'government' THEN 'G' WHEN 'religion' THEN 'R'
                         WHEN 'fuel' THEN 'F' WHEN 'transport' THEN 'V' WHEN 'military' THEN 'M'
                         WHEN 'military_disused' THEN 'D' WHEN 'food' THEN 'U' ELSE 'Q' END AS layer,
           ST_Centroid(geometry) AS geom
      FROM site_feature WHERE name <> ''
    -- Power
    UNION ALL
    -- A line is mapped in many pieces with the same name: one result, on the longest.
    (SELECT DISTINCT ON (lower(tags -> 'name')) 'osm', 'power_line', type, tags -> 'name', tags, tags -> 'operator',
            NULL, 1, 'P', ST_LineInterpolatePoint(geometry, 0.5)
       FROM osm_power_line WHERE tags -> 'name' <> '' AND ST_GeometryType(geometry) = 'ST_LineString'
      ORDER BY lower(tags -> 'name'), ST_Length(geometry) DESC)
    UNION ALL
    SELECT 'osm', 'generator', tags -> 'generator:source', tags -> 'name', tags, tags -> 'operator', NULL, 1, 'P',
           ST_Centroid(geometry)
      FROM osm_power_generator WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'switchgear', NULL, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'P', ST_Centroid(geometry)
      FROM osm_power_switchgear WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'street_cabinet', tags -> 'utility', tags -> 'name', tags, tags -> 'operator', NULL, 2,
           CASE tags -> 'utility' WHEN 'power' THEN 'P' WHEN 'water' THEN 'W' ELSE 'T' END, ST_Centroid(geometry)
      FROM osm_street_cabinet WHERE tags -> 'name' <> ''
    -- Telecoms
    UNION ALL
    SELECT 'osm', 'telecom_building', type, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'T',
           ST_Centroid(geometry)
      FROM osm_telecom_building WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'telecom_location', type, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'T',
           ST_Centroid(geometry)
      FROM osm_telecom_location WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'mast', type, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'T', ST_Centroid(geometry)
      FROM osm_mast WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'antenna', type, tags -> 'name', tags, tags -> 'operator', NULL, 2, 'T', ST_Centroid(geometry)
      FROM osm_telecom_antenna WHERE tags -> 'name' <> ''
    UNION ALL
    (SELECT DISTINCT ON (lower(tags -> 'name')) 'osm', 'telecom_cable', NULL, tags -> 'name', tags,
            tags -> 'operator', NULL, 1, 'T', ST_LineInterpolatePoint(geometry, 0.5)
       FROM osm_telecom_cable WHERE tags -> 'name' <> '' AND ST_GeometryType(geometry) = 'ST_LineString'
      ORDER BY lower(tags -> 'name'), ST_Length(geometry) DESC)
    -- Oil, gas and other pipelines
    UNION ALL
    SELECT 'osm', 'petroleum_site', type, name, tags, tags -> 'operator', NULL, 1, 'O', ST_Centroid(geometry)
      FROM osm_petroleum_site WHERE name <> ''
    UNION ALL
    SELECT 'osm', 'petroleum_well', type, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'O',
           ST_Centroid(geometry)
      FROM osm_petroleum_well WHERE tags -> 'name' <> ''
    UNION ALL
    (SELECT DISTINCT ON (lower(tags -> 'name')) 'osm', 'pipeline', tags -> 'substance', tags -> 'name', tags,
            tags -> 'operator', NULL, 1, search_pipeline_layer(tags -> 'substance'),
            ST_LineInterpolatePoint(geometry, 0.5)
       FROM osm_pipeline WHERE tags -> 'name' <> '' AND ST_GeometryType(geometry) = 'ST_LineString'
      ORDER BY lower(tags -> 'name'), ST_Length(geometry) DESC)
    UNION ALL
    SELECT 'osm', 'pipeline_feature', type, tags -> 'name', tags, tags -> 'operator', NULL, 1,
           search_pipeline_layer(tags -> 'substance'), ST_Centroid(geometry)
      FROM osm_pipeline_feature WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'marker', type, tags -> 'name', tags, tags -> 'operator', NULL, 2,
           search_pipeline_layer(tags -> 'substance'), ST_Centroid(geometry)
      FROM osm_marker WHERE tags -> 'name' <> ''
    -- Water
    UNION ALL
    (SELECT DISTINCT ON (lower(name)) 'osm', 'pressurised_waterway', NULL, name, tags, tags -> 'operator', NULL, 1,
            'W', ST_LineInterpolatePoint(geometry, 0.5)
       FROM osm_pressurised_waterway WHERE name <> '' AND ST_GeometryType(geometry) = 'ST_LineString'
      ORDER BY lower(name), ST_Length(geometry) DESC)
    UNION ALL
    SELECT 'osm', 'pumping_station', NULL, name, tags, tags -> 'operator', NULL, 1, 'W', ST_Centroid(geometry)
      FROM osm_pumping_station WHERE name <> ''
    UNION ALL
    SELECT 'osm', 'wastewater_plant', NULL, name, tags, tags -> 'operator', NULL, 1, 'W', ST_Centroid(geometry)
      FROM osm_wastewater_plant WHERE name <> ''
    UNION ALL
    SELECT 'osm', 'water_treatment_plant', NULL, name, tags, tags -> 'operator', NULL, 1, 'W',
           ST_Centroid(geometry)
      FROM osm_water_treatment_plant WHERE name <> ''
    UNION ALL
    SELECT 'osm', 'water_reservoir', NULL, name, tags, tags -> 'operator', NULL, 1, 'W', ST_Centroid(geometry)
      FROM osm_water_reservoir WHERE name <> ''
    UNION ALL
    SELECT 'osm', 'water_tower', NULL, tags -> 'name', tags, tags -> 'operator', NULL, 1, 'W',
           ST_Centroid(geometry)
      FROM osm_water_tower WHERE tags -> 'name' <> ''
    UNION ALL
    SELECT 'osm', 'water_well', NULL, tags -> 'name', tags, tags -> 'operator', NULL, 2, 'W', ST_Centroid(geometry)
      FROM osm_water_well WHERE tags -> 'name' <> ''
    -- Extra data (schema/extra.sql): ICPE sites, biomethane injection points (gas
    -- layer), distribution substations
    UNION ALL
    SELECT 'extra', kind, details ->> 'category', name, NULL, details ->> 'operator', details ->> 'commune',
           CASE WHEN details ->> 'category' IN ('seveso_high', 'seveso_low') THEN 0 ELSE 1 END,
           CASE kind WHEN 'icpe' THEN 'Z' ELSE 'Y' END, ST_Centroid(geometry)
      FROM extra.facility WHERE name <> ''
    UNION ALL
    SELECT 'extra', 'distribution_substation', kind, name, NULL, NULL, NULL, 2, 'X', ST_Centroid(geometry)
      FROM extra.power_substation WHERE name <> ''
)
-- Searched in lower case without accents ("hopital" finds "Hôpital"), also as the
-- name and town together ("mairie duppigheim").
SELECT *, lower(unaccent(name)) AS name_plain, lower(unaccent(name || ' ' || COALESCE(town, ''))) AS name_town FROM (
SELECT row_number() OVER () AS id, n.source, n.kind, n.subtype, n.name,
       -- Names in other languages (name:en...), for showing them in that language.
       (SELECT hstore(array_agg(key), array_agg(value)) FROM each(n.tags) WHERE key LIKE 'name:%') AS names,
       n.detail, n.importance, n.layer,
       -- The nearest city, town or village (a commune in France; ~10 km at most),
       -- where the data has none.
       COALESCE(n.town, (SELECT p.name FROM osm_place p
                          WHERE p.type IN ('city', 'town', 'village')
                            AND ST_DWithin(p.geometry, n.geom, 15000)
                          ORDER BY p.geometry <-> n.geom LIMIT 1)) AS town,
       ST_Transform(n.geom, 4326) AS geometry
  FROM named n
) f;

CREATE INDEX search_feature_name ON search_feature (substr(name_plain, 1, 20) text_pattern_ops);
CREATE INDEX search_feature_name_words ON search_feature USING gin (name_plain gin_trgm_ops);
CREATE INDEX search_feature_name_town ON search_feature USING gin (name_town gin_trgm_ops);
