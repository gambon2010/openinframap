-- Fork: power grid network for routing between two stations (/grid/route).
--
-- Turns power lines of 10 kV and more (with a known voltage) into nodes and
-- edges. Routes run over 110 kV and more; the lower voltages are only used to
-- connect a station that isn't on that grid (e.g. a wind farm on a 65 kV line)
-- to the nearest station that is:
--   * Lines connect where they share a vertex (the same pylon). Lines that only
--     cross each other in the air don't connect.
--   * Every line end or shared pylon inside or close to a substation (or a
--     power plant without a substation) becomes that station's node.
--   * Each stretch of line between two such points is an edge.
-- Run by scripts/build-region.sh after views.sql.

DROP TABLE IF EXISTS grid_edge;
DROP TABLE IF EXISTS grid_node;

-- How close a line end must be to a station to count as connected (metres in
-- EPSG:3857, which is larger than real metres away from the equator: at 50°N
-- 100 units are about 65 m).
\set station_polygon_snap 100
\set station_point_snap 250

-- 1. Lines: in service, 10 kV and more.
CREATE TEMP TABLE grid_line AS
SELECT row_number() OVER () AS line_id,
       osm_id,
       convert_voltage(voltage)::integer AS voltage,
       voltage AS voltage_tag,
       tags -> 'name' AS name,
       geometry AS geom
  FROM osm_power_line
 WHERE type IN ('line', 'cable', 'minor_line')
   AND convert_voltage(voltage) >= 10000
   AND coalesce(construction, '') = ''
   AND coalesce(disused, '') = ''
   AND NOT (tags ? 'construction:power' OR tags ? 'disused:power');

-- 2. All vertices, keyed by position (rounded to 1 cm) to find shared pylons.
CREATE TEMP TABLE grid_vertex AS
SELECT line_id, (dp).path[1] AS idx, (dp).geom AS geom,
       ST_AsText(ST_SnapToGrid((dp).geom, 0.01)) AS key
  FROM (SELECT line_id, ST_DumpPoints(geom) AS dp FROM grid_line) AS d;
CREATE INDEX ON grid_vertex (key);
CREATE INDEX ON grid_vertex (line_id, idx);
-- Temporary tables have no statistics until analysed; without them the planner
-- picks nested loops that take hours on a country like France.
ANALYZE grid_vertex;

-- 3. Stations a junction can belong to. Substations first; plants only count
--    where no substation claims the junction.
CREATE TEMP TABLE grid_station AS
SELECT 'substation' AS kind, osm_id, name, voltage AS voltage_tag, geometry AS geom,
       CASE WHEN GeometryType(geometry) = 'POINT' THEN :station_point_snap
            ELSE :station_polygon_snap END AS snap,
       0 AS priority
  FROM substation
UNION ALL
SELECT 'plant', osm_id, name, NULL, geometry,
       CASE WHEN GeometryType(geometry) = 'POINT' THEN :station_point_snap
            ELSE :station_polygon_snap END,
       1
  FROM power_plant;
CREATE INDEX ON grid_station USING gist (geom);
ANALYZE grid_station;

-- 4. Junctions: line ends, vertices shared by more than one line, and the
--    first vertex where a line enters a station's outline (a line running
--    through a substation or a wind farm connects to it). Only the entry point
--    is split: the stretch leaving the station keeps the part inside it, so
--    the drawn route has no gap.
CREATE TEMP TABLE grid_vertex_in_station AS
SELECT v.line_id, v.idx,
       (SELECT s.kind || ':' || s.osm_id
          FROM grid_station AS s
         WHERE GeometryType(s.geom) <> 'POINT' AND ST_Intersects(s.geom, v.geom)
         ORDER BY s.priority
         LIMIT 1) AS station
  FROM grid_vertex AS v;

CREATE TEMP TABLE grid_shared AS
SELECT key FROM grid_vertex GROUP BY key HAVING count(DISTINCT line_id) > 1;
CREATE TEMP TABLE grid_entering AS
SELECT line_id, idx
  FROM (SELECT line_id, idx, station,
               lag(station) OVER (PARTITION BY line_id ORDER BY idx) AS previous
          FROM grid_vertex_in_station) AS w
 WHERE station IS NOT NULL AND station IS DISTINCT FROM previous;
ANALYZE grid_shared;
ANALYZE grid_entering;

-- (Joins rather than IN (subquery): those turn into a scan per vertex at scale.)
CREATE TEMP TABLE grid_junction AS
WITH last AS (
    SELECT line_id, max(idx) AS last_idx FROM grid_vertex GROUP BY line_id
)
SELECT v.line_id, v.idx, v.key, v.geom
  FROM grid_vertex AS v
  JOIN last USING (line_id)
  LEFT JOIN grid_shared AS sh ON sh.key = v.key
  LEFT JOIN grid_entering AS en ON en.line_id = v.line_id AND en.idx = v.idx
 WHERE v.idx = 1 OR v.idx = last.last_idx OR sh.key IS NOT NULL OR en.line_id IS NOT NULL;
CREATE INDEX ON grid_junction (key);
ANALYZE grid_junction;

-- Each distinct junction position -> the best station within reach, if any.
CREATE TEMP TABLE grid_key_station AS
SELECT DISTINCT ON (j.key) j.key, s.kind, s.osm_id
  FROM (SELECT DISTINCT key, geom FROM grid_junction) AS j
  -- The constant reach lets the spatial index be used (the per-station one alone can't).
  JOIN grid_station AS s ON ST_DWithin(s.geom, j.geom, greatest(:station_point_snap, :station_polygon_snap))
                        AND ST_DWithin(s.geom, j.geom, s.snap)
 ORDER BY j.key, s.priority, ST_Distance(s.geom, j.geom);
CREATE INDEX ON grid_key_station (key);
ANALYZE grid_key_station;

-- 5. Nodes: one per station that has a line, plus one per other junction.
CREATE TABLE grid_node (
    node_id serial PRIMARY KEY,
    kind text NOT NULL,          -- substation, plant or junction
    osm_id bigint,               -- the station's osm_id (NULL for junctions)
    name text,
    voltage_tag text,
    geom geometry(Point, 3857) NOT NULL,
    key text                     -- junction position while building (dropped below)
);

INSERT INTO grid_node (kind, osm_id, name, voltage_tag, geom)
SELECT DISTINCT ON (s.kind, s.osm_id) s.kind, s.osm_id, s.name, s.voltage_tag, ST_PointOnSurface(s.geom)
  FROM grid_key_station AS ks
  JOIN grid_station AS s USING (kind, osm_id);

INSERT INTO grid_node (kind, geom, key)
SELECT DISTINCT ON (j.key) 'junction', j.geom, j.key
  FROM grid_junction AS j
 WHERE NOT EXISTS (SELECT 1 FROM grid_key_station AS ks WHERE ks.key = j.key);

-- Junction position -> node.
CREATE TEMP TABLE grid_key_node AS
SELECT ks.key, n.node_id
  FROM grid_key_station AS ks
  JOIN grid_node AS n ON n.kind = ks.kind AND n.osm_id = ks.osm_id
UNION ALL
SELECT n.key, n.node_id
  FROM grid_node AS n
 WHERE n.kind = 'junction';
CREATE INDEX ON grid_key_node (key);
ANALYZE grid_key_node;
ALTER TABLE grid_node DROP COLUMN key;

-- 6. Edges: each stretch of a line between two consecutive junctions.
CREATE TABLE grid_edge (
    edge_id serial PRIMARY KEY,
    line_osm_id bigint NOT NULL,
    source integer NOT NULL REFERENCES grid_node,
    target integer NOT NULL REFERENCES grid_node,
    voltage integer NOT NULL,
    voltage_tag text,
    name text,
    length_m double precision NOT NULL,
    geom geometry(LineString, 3857) NOT NULL
);

INSERT INTO grid_edge (line_osm_id, source, target, voltage, voltage_tag, name, length_m, geom)
SELECT l.osm_id, a.node_id, b.node_id, l.voltage, l.voltage_tag, l.name,
       ST_Length(ST_Transform(s.geom, 4326)::geography), s.geom
  FROM (
        SELECT line_id, key AS from_key, idx AS from_idx,
               lead(key) OVER w AS to_key, lead(idx) OVER w AS to_idx
          FROM grid_junction
        WINDOW w AS (PARTITION BY line_id ORDER BY idx)
       ) AS p
  JOIN grid_line AS l USING (line_id)
  JOIN grid_key_node AS a ON a.key = p.from_key
  JOIN grid_key_node AS b ON b.key = p.to_key
  CROSS JOIN LATERAL (
        SELECT ST_MakeLine(v.geom ORDER BY v.idx) AS geom
          FROM grid_vertex AS v
         WHERE v.line_id = p.line_id AND v.idx BETWEEN p.from_idx AND p.to_idx
       ) AS s
 WHERE p.to_key IS NOT NULL
   AND a.node_id <> b.node_id;  -- stretches inside one station don't connect anything

CREATE INDEX ON grid_edge USING gist (geom);
CREATE INDEX ON grid_edge (source);
CREATE INDEX ON grid_edge (target);
CREATE INDEX ON grid_edge (voltage);
CREATE INDEX ON grid_node USING gist (geom);
CREATE INDEX ON grid_node (kind, osm_id);
ANALYZE grid_node;
ANALYZE grid_edge;
