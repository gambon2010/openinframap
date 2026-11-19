-- Fork: sites whose kind we set by hand, where OSM's tags and name lead sites.sql
-- astray (a fort still used by the army but tagged historic). Each row: the OSM id
-- (imposm's: a relation's negative), the name it has in OSM (the override holds only
-- while it matches: renamed in OSM, it's looked at again), the kind it is (one of
-- sites.sql's kinds; its site_kind's NULL can't be given), the date, and why.
-- What's inside one inherits from it as from any military site (sites.sql).
--
-- Safe to run more than once; sites.sql reads it, so run sites.sql after changing it
-- (a database rebuild does both).
CREATE OR REPLACE VIEW site_override (osm_id, name, kind, since, why) AS VALUES
    (36932087::bigint, 'Fort de Nogent', 'military_fort', '2026-11-19'::date,
     'Tagged historic, but the Foreign Legion''s recruitment centre and units are there.'),
    (-5658089::bigint, 'Fort d''Ivry', 'military_fort', '2026-11-19'::date,
     'Tagged historic, but the ECPAD (the defence ministry''s image agency) is there.'),
    (22727428::bigint, 'Fort de Portzic', 'military_fort', '2026-11-19'::date,
     'Tagged historic, but still in military use (Brest, the Navy''s port).');
