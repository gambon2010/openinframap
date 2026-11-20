-- Fork: the critical sites as one point each for the map's tiles (Tegola's
-- sites_point), grouped below zoom 14 into numbered bubbles (site_feature: sites.sql).
-- Safe to run more than once. The functions set their search_path: Postgres builds
-- materialized views with a restricted one, where hstore's -> isn't visible.

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
