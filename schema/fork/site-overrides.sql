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
     'Tagged historic, but still in military use (Brest, the Navy''s port).'),
    (161297197::bigint, 'Camp de Cercottes', 'military_school', '2026-11-19'::date,
     'The DGSE''s training centre (CPES; press reports, Wikipedia: Action Division), not a range.'),
    (-7770108::bigint, 'Lignes de Quélern', 'military_school', '2026-11-19'::date,
     'The DGSE''s maritime training centre (CPEOM) is in the Réduit de Quélern (Brittany heritage inventory).'),
    (167587638::bigint, 'Elément Air Rattaché 943 de Nice Mt-Agel', 'military_radio', '2026-11-19'::date,
     'The air force''s radar station on Mont Agel (CDC 05.943, a Ground Master 406 radar).'),
    (122578387::bigint, 'Station du Cranou', 'military_radio', '2026-11-19'::date,
     'The Navy''s radio monitoring station of the Atlantic and North Sea (naval intelligence).'),
    (-1558419::bigint, 'BND Aussenstelle Rheinhausen', 'military_radio', '2026-11-19'::date,
     'The German intelligence service''s station intercepting satellite links (netzpolitik.org).'),
    (110264552::bigint, 'Bundesnachrichtendienst Außenstelle Rheinhausen', 'military_radio', '2026-11-19'::date,
     'The same station (another OSM object).'),
    (49153096::bigint, 'eu-LISA (European Union Agency for the Operational Management of Large-Scale IT Systems in the Area of Freedom, Security and Justice)',
     'government', '2026-11-19'::date,
     'An EU agency (IT systems for borders and justice), mapped as military: not military.'),
    (134244770::bigint, 'Etamat', 'military_disused', '2026-11-19'::date,
     'The Le Mans army materiel establishment, closed in June 2018 (the city plans housing there).'),
    (512713295::bigint, 'Terrain Billard', 'military_depot', '2026-11-19'::date,
     'The 4e régiment du matériel''s Billard detachment (Drôme defence brochure).'),
    (1561330550::bigint, 'Gare de Sainte-Rosaline', 'military_depot', '2026-11-19'::date,
     'The rail station for military traffic to the Canjuers camp (La Motte-Sainte-Roseline line).'),
    (41233994::bigint, 'Le Lazaret', 'military_school', '2026-11-19'::date,
     'Inside the Navy''s Pôle Écoles Méditerranée at Saint-Mandrier (its schools).'),
    (-7382430::bigint, 'Zone du Lazaret', 'military_school', '2026-11-19'::date,
     'The same (Pôle Écoles Méditerranée, Saint-Mandrier).');
