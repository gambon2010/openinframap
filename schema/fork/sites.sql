-- Fork: critical sites (imposm/sites.py imports them all into osm_site). Sorts
-- each into a category and a kind, and how important it is, which decides from
-- which zoom it shows (0: zoom 8, 1: zoom 12, 2: zoom 14; see tegola/layers.yml).
-- Rows that fit no kind (e.g. a water tank, a WWII bomb crater) are left out.
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

CREATE OR REPLACE FUNCTION site_kind(key text, type text, tags hstore) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
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
        -- police and gendarmerie: by the operator, else the name
        WHEN type = 'police' THEN CASE
            WHEN is_gendarmerie(tags) OR tags->'name' ~* '^brigade|\mescadron' THEN 'gendarmerie'
            WHEN tags->'operator' ILIKE 'police nationale' OR tags->'operator' ILIKE 'ministère de l''intérieur'
              OR tags->'name' ~* 'commissariat|police nationale|h[ôo]tel de police' THEN 'police_national'
            WHEN tags->'operator' ~* 'municipal|^ville |^mairie|^commune ' OR tags->'name' ~* 'municipal' THEN 'police_municipal'
            ELSE 'police' END
        -- military: in use (but the gendarmerie's), and disused fortifications
        WHEN key = 'landuse' AND type = 'military' THEN
            CASE WHEN is_gendarmerie(tags) THEN 'gendarmerie' ELSE 'military_area' END
        WHEN key = 'military' THEN CASE
            WHEN type IN ('bunker', 'trench', 'embrasure', 'casemate', 'cupola', 'abandoned', 'battery',
                          'blockhouse', 'pillbox', 'fort', 'gun_emplacement', 'shelter') THEN 'military_disused'
            WHEN is_gendarmerie(tags) THEN 'gendarmerie'
            WHEN type IN ('barracks', 'base', 'naval_base', 'airfield') THEN 'military_base'
            WHEN type IN ('office', 'checkpoint') THEN 'military_office'
            WHEN type IN ('ammunition', 'depot') THEN 'military_depot'
            WHEN type IN ('range', 'training_area', 'danger_area') THEN 'military_range'
            WHEN type = 'yes' THEN 'military'
            END
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
        WHEN kind IN ('gendarmerie', 'police_national', 'police_municipal', 'police') THEN 'police'
        WHEN kind IN ('townhall', 'tax', 'prefecture', 'social', 'employment', 'customs', 'national', 'government',
                      'courthouse', 'prison', 'embassy', 'university') THEN 'government'
        WHEN kind IN ('christian', 'muslim', 'jewish', 'buddhist', 'hindu', 'sikh', 'worship') THEN 'religion'
        WHEN kind IN ('fuel', 'storage_tank') THEN 'fuel'
        WHEN kind IN ('airport', 'port', 'border', 'rail_yard') THEN 'transport'
        WHEN kind IN ('military_area', 'military_base', 'military_office', 'military_depot', 'military_range',
                      'military') THEN 'military'
        WHEN kind = 'military_disused' THEN 'military_disused'
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
          OR (kind = 'military_area' AND area > 220000)
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
-- changes with a rebuild. A storage tank already drawn by the Oil & Natural Gas layer
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
DROP MATERIALIZED VIEW IF EXISTS site_feature;
CREATE MATERIALIZED VIEW site_feature AS
WITH s AS (
    SELECT id AS site_id, osm_id, geometry, name, tags, site_kind(key, type, tags) AS kind,
           CASE WHEN ST_GeometryType(geometry) IN ('ST_Polygon', 'ST_MultiPolygon')
                THEN oim_ground_area(geometry) ELSE 0 END AS area
      FROM osm_site
), kept AS (
    SELECT * FROM s
     WHERE kind IS NOT NULL
       AND NOT (kind = 'storage_tank' AND EXISTS (
           SELECT 1 FROM osm_petroleum_site p
            WHERE p.osm_id = s.osm_id
               OR (p.geometry && s.geometry AND ST_Intersects(p.geometry, ST_PointOnSurface(s.geometry)))))
), station_in AS (
    -- Each gendarmerie station inside an unnamed, small military area.
    SELECT a.site_id AS area_id, st.site_id AS station_id
      FROM kept a JOIN kept st ON st.kind = 'gendarmerie' AND st.site_id <> a.site_id
       AND st.geometry && a.geometry AND ST_Intersects(a.geometry, ST_PointOnSurface(st.geometry))
     WHERE a.kind = 'military_area' AND coalesce(a.name, '') = '' AND a.area < 50000
), compound AS (
    -- Those areas without an army site inside, with one of their stations.
    SELECT i.area_id, min(i.station_id) AS station_id
      FROM station_in i JOIN kept a ON a.site_id = i.area_id
     WHERE NOT EXISTS (
           SELECT 1 FROM kept m
            WHERE m.kind IN ('military_base', 'military_office', 'military_depot', 'military_range', 'military')
              AND m.geometry && a.geometry AND ST_Intersects(a.geometry, ST_PointOnSurface(m.geometry)))
     GROUP BY i.area_id
), merged AS (
    SELECT k.osm_id, k.geometry,
           CASE WHEN c.area_id IS NULL THEN k.name ELSE st.name END AS name,
           CASE WHEN c.area_id IS NULL THEN k.kind ELSE 'gendarmerie' END AS kind,
           CASE WHEN c.area_id IS NULL THEN k.tags ELSE k.tags || st.tags END AS tags,
           k.area
      FROM kept k
           LEFT JOIN compound c ON c.area_id = k.site_id
           LEFT JOIN kept st ON st.site_id = c.station_id
     WHERE NOT EXISTS (
           SELECT 1 FROM station_in i JOIN compound c2 ON c2.area_id = i.area_id WHERE i.station_id = k.site_id)
)
SELECT row_number() OVER () AS id, osm_id, geometry, name, kind, site_category(kind) AS category,
       site_importance(kind, tags, area) AS importance, tags, area
  FROM merged;
CREATE INDEX site_feature_geometry ON site_feature USING gist (geometry);
CREATE INDEX site_feature_importance ON site_feature (importance);

-- One point per site for a tile (Tegola's sites_point), grouped below zoom 14: in
-- a grid of 12 x 12 cells per tile (~40 px), the sites of a category sharing a cell
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
        SELECT f.id, f.osm_id, c.pt AS geometry, f.name, f.kind, f.category, f.importance, f.tags,
               CASE WHEN zoom < 14 AND (f.importance > 0 OR zoom < 8)
                    THEN floor((ST_X(c.pt) + 20037508.342789244) / g.cell)::bigint END AS cx,
               floor((ST_Y(c.pt) + 20037508.342789244) / g.cell)::bigint AS cy
          FROM site_feature f
               CROSS JOIN LATERAL (SELECT ST_Centroid(f.geometry) AS pt) c
               CROSS JOIN (SELECT 40075016.68557849 / power(2, zoom) / 12 AS cell) g
         WHERE f.geometry && bbox
    ), counted AS (
        -- How many of its kind share its cell.
        SELECT p.*, count(*) OVER (PARTITION BY p.category, p.kind, p.cx, p.cy)::integer AS of_kind FROM p
    ), grouped AS (
        SELECT counted.category, counted.cx, counted.cy, counted.kind, count(*)::integer AS n,
               min(counted.id) AS first_id, sum(ST_X(counted.geometry)) AS sum_x, sum(ST_Y(counted.geometry)) AS sum_y
          FROM counted WHERE counted.cx IS NOT NULL AND counted.of_kind > 1
         GROUP BY counted.category, counted.cx, counted.cy, counted.kind
    ), groups AS (
        SELECT grouped.category, grouped.cx, grouped.cy, sum(grouped.n)::integer AS n, min(grouped.first_id) AS first_id,
               sum(grouped.sum_x) / sum(grouped.n) AS x, sum(grouped.sum_y) / sum(grouped.n) AS y,
               ',' || string_agg(grouped.kind || ':' || grouped.n, ',' ORDER BY grouped.kind) || ',' AS kinds
          FROM grouped
         GROUP BY grouped.category, grouped.cx, grouped.cy
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
           -- Groups of different categories in one place would sit on top of each
           -- other: each category's is moved ~10 px (on a 512 px tile) its own way.
           CROSS JOIN LATERAL (SELECT 2 * pi() * (array_position(
               ARRAY['health', 'government', 'religion', 'fuel', 'transport', 'military',
                     'military_disused', 'food', 'water_waste', 'police'], groups.category) - 1) / 10 AS angle) a
           CROSS JOIN (SELECT 40075016.68557849 / power(2, zoom) / 512 AS px) s
$$;
