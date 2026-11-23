-- Fork: the critical sites the map shows (site_feature), each with its kind
-- (site-kinds.sql, site-overrides.sql), what the military sites around and inside it
-- say, sites mapped twice drawn once. The points Tegola serves, grouped zoomed out:
-- site-points.sql.

-- What Tegola serves (sites_point, sites_area): materialized, as the data only
-- changes with a rebuild. A kind set by hand (site-overrides.sql) comes before what
-- the tags and name say. A storage tank already drawn by the Oil & Natural Gas layer
-- (upstream's osm_petroleum_site: the same object, or inside its oil or gas site)
-- is left to it: drawn once.
--
-- A gendarmerie's compound is often mapped as a military area (or barracks) with its station
-- inside: one item, the area as a gendarmerie (its name, else the station's; the
-- station's tags), the station not drawn apart. An area is a compound when it has a
-- gendarmerie station inside, no named army site inside, and is small: unnamed and
-- under 5 ha, or a "Caserne ..." or "Quartier ..." under 10 ha (the gendarmerie's
-- barracks in towns, named for a gendarme: "Caserne Capitaine Guillo", "Quartier
-- Moncey"; the army's are larger). Its unnamed pieces (housing blocks mapped as
-- barracks) aren't drawn. Army bases (larger, or with their own sites) stay
-- military, a station inside them apart. The military sites inside a gendarmerie's
-- site (the quarters of its academy), mostly over it (the same caserne mapped
-- twice), or unnamed and touching it (its annex), aren't drawn either: the site stands for them. (A military area named for
-- the gendarmerie is one already: site_kind.)
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
           -- An override's 'none': not a site (site-overrides.sql).
           CASE WHEN fixed.kind = 'none' THEN NULL ELSE coalesce(fixed.kind, site_kind(o.key, o.type, o.tags)) END AS kind,
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
    SELECT site_id, area, coalesce(name, '') <> '' AS named, CASE
               WHEN kind <> 'military_camp' THEN kind
               WHEN area >= 900000 THEN 'military_range'
               ELSE 'military_base' END AS kind
      FROM kept WHERE site_category(kind) = 'military'
), military AS (
    -- Whether their own kind says more than "military area", and whether they're in use.
    SELECT site_id, kind, area, named,
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
    -- antennas; not a mobile phone mast standing on military land. What a tower is
    -- used for is in tower:type (man_made=tower or mast + tower:type=communication,
    -- Issoudun's transmitter); the main value only when there's none. A
    -- communication mast only with its operator named (TDF, the army): an anonymous
    -- one is most often a phone mast (a camp's would make it a radio station).
    SELECT geometry FROM osm_mast
     WHERE (coalesce(tags->'tower:type', type) IN ('radar', 'communications_tower')
            OR (coalesce(tags->'tower:type', type) = 'communication' AND (type <> 'mast' OR tags ? 'operator'))
            OR (coalesce(tags->'tower:type', type) = 'watchtower' AND tags->'operator' ~* 'marine'))
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
), station_in AS (
    -- Each gendarmerie station inside an unnamed, small military area.
    SELECT a.site_id AS area_id, st.site_id AS station_id
      FROM kept a JOIN kept st ON st.kind = 'gendarmerie' AND st.site_id <> a.site_id
       AND st.geometry && a.geometry AND ST_Intersects(a.geometry, ST_PointOnSurface(st.geometry))
     WHERE (a.kind IN ('military_area', 'military_base') AND coalesce(a.name, '') = '' AND a.area < 50000)
        OR (a.kind = 'military_base' AND a.name ~* '^(caserne|quartier)\M' AND a.area < 100000)
), compound AS (
    -- Those areas without a named army site inside, with one of their stations.
    SELECT i.area_id, min(i.station_id) AS station_id
      FROM station_in i
     WHERE NOT EXISTS (
           SELECT 1 FROM within w JOIN military m ON m.site_id = w.inner_id AND m.says_more AND m.named
            WHERE w.outer_id = i.area_id)
     GROUP BY i.area_id
), part_of_compound AS (
    -- A compound's unnamed pieces (its housing blocks, mapped as barracks).
    SELECT DISTINCT w.inner_id AS site_id
      FROM within w
           JOIN compound c ON c.area_id = w.outer_id
           JOIN military m ON m.site_id = w.inner_id AND NOT m.named
), gendarmerie_site AS (
    -- The gendarmerie's sites: mapped as such, and the compounds.
    SELECT o.id AS site_id, o.geometry FROM osm_site o
     WHERE o.type IN ('police', 'military', 'barracks', 'office', 'school') AND site_kind(o.key, o.type, o.tags) = 'gendarmerie'
    UNION ALL
    SELECT k.site_id, k.geometry FROM compound c JOIN kept k ON k.site_id = c.area_id
), part_of_gendarmerie AS (
    -- The military sites inside a gendarmerie's site (its academy's quarters), mostly
    -- over it (a caserne mapped twice), or unnamed and only touching it, saying no
    -- more (its annex); not the compounds themselves.
    SELECT DISTINCT m.site_id
      FROM military_resolved m
           JOIN military_final own ON own.site_id = m.site_id
           JOIN kept k ON k.site_id = m.site_id
           JOIN gendarmerie_site g ON g.geometry && k.geometry AND g.site_id <> k.site_id
                                  AND ST_Intersects(g.geometry, k.geometry)
           CROSS JOIN LATERAL (SELECT ST_Contains(g.geometry, ST_PointOnSurface(k.geometry))
                                      AND oim_ground_area(g.geometry) > k.area AS inside,
                                      ST_Area(ST_Intersection(g.geometry, k.geometry)) > 0.5 * ST_Area(k.geometry) AS mostly_over,
                                      own.kind = 'military_area' AND coalesce(k.name, '') = '' AS annex) placed
     WHERE m.kind IN ('military_area', 'military_base', 'military_office')
       AND (placed.inside OR placed.mostly_over OR placed.annex)
       AND NOT EXISTS (SELECT 1 FROM compound c WHERE c.area_id = k.site_id)
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
       AND NOT EXISTS (SELECT 1 FROM part_of_compound p WHERE p.site_id = k.site_id)
), numbered AS (
    SELECT row_number() OVER () AS id, merged.*, site_category(kind) AS category
      FROM merged WHERE kind IS NOT NULL
), twin AS (
    -- Each named site and another of the same name and category touching it or
    -- within 20 m (a bunker mapped as an area and as a point beside it): one thing
    -- mapped twice. The larger (then the first) is kept. Found by place first,
    -- through osm_site's index (the region's widest stretch, read once), then by
    -- name: pairing by name first compared all of France's "Mairie" with each other
    -- (minutes).
    SELECT a.id, b.kind AS twin_kind, (b.area, -b.id) > (a.area, -a.id) AS twin_kept
      FROM numbered a
           CROSS JOIN (SELECT oim_max_stretch() AS widest) stretch
           JOIN osm_site o ON o.geometry && ST_Expand(a.geometry, 20 * stretch.widest)
           JOIN numbered b
             ON b.osm_id = o.osm_id AND b.id <> a.id AND lower(b.name) = lower(a.name) AND b.category = a.category
     WHERE coalesce(a.name, '') <> ''
       AND ST_DWithin(a.geometry, b.geometry, oim_units(20, b.geometry))
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
