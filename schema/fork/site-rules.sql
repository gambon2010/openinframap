-- Fork: what a military site's name says it is (sites.sql's military_kind). OSM's
-- tags often say no more than "military area" (landuse=military); the name says
-- "Dépôt de munitions", "Champ de tir", "Station radar". Each row is a pattern (a
-- case-insensitive Postgres regular expression: \m and \M mark a word's start and
-- end) and the kind a name matching it gives; the first matching row, by priority,
-- decides.
--
-- replaces_tags: the name decides even when the tags name a kind (a "Stand de tir"
-- tagged military=range that is a shooting club's; an "École nationale de police"
-- tagged barracks). Otherwise the name only decides for sites tagged as no more than
-- military.
--
-- Two kinds here are not shown as they are: not_military (left out: an archery or
-- shooting club), and shooting_stand (part of the military site around it, a range
-- when alone and large, else a club's: left out; sites.sql).
--
-- To add a word or a language: a row (or an alternative in a row's pattern) with
-- the kind it means. Safe to run more than once; sites.sql reads it, so run sites.sql
-- after changing it (a database rebuild does both).
CREATE OR REPLACE VIEW military_name_rule (priority, kind, replaces_tags, language, pattern) AS VALUES
    -- Not military: clubs mapped as military ranges.
    (10, 'not_military', true, 'fr', 'tir [àa] l.arc|ball[- ]?trap|club de tir|soci[ée]t[ée] de tir|tir sportif'),
    (10, 'not_military', true, 'de', 'bogensch|sch[üu]tzen(verein|haus|gilde|gesellschaft)'),
    (10, 'not_military', true, 'en', 'archery|rifle club|gun club|shooting club'),
    -- Police and gendarmerie mapped as military (their schools, CRS companies, the
    -- Garde républicaine, mountain rescue): Police, gendarmerie, customs.
    (20, 'gendarmerie', true, 'fr', 'garde r[ée]publicaine|\mPGHM\M|\mPSIG\M'),
    (20, 'police_national', true, 'fr', '\mpolice\M(?! militaire)|commissariat de police|\mC\.?R\.?S\M|compagnie r[ée]publicaine de s[ée]curit[ée]'),
    (20, 'police_national', true, 'de', 'polizei'),
    -- A shooting stand.
    (30, 'shooting_stand', true, 'fr', '\mstands? de tir'),
    (30, 'shooting_stand', true, 'de', 'schie(ß|ss)(stand|anlage)'),
    (30, 'shooting_stand', true, 'en', 'shooting range|rifle range'),
    -- Ranges, training and test grounds ("Camp de ...": a training ground; a camp
    -- named for a person is a base).
    (40, 'military_range', false, 'fr', '\mtir\M|polygone|man[œo]e?uvres?|terrain d.exercice|entra[iî]nement|\messais\M|\mcamps? (de |du |des |d.|militaire)'),
    (40, 'military_range', false, 'de', '[üu]bungsplatz|schie(ß|ss)platz|bombodrom|truppen[üu]bung'),
    (40, 'military_range', false, 'en', 'training area|firing range|bombing range|\mrange\M'),
    -- Schools and training establishments.
    (50, 'military_school', false, 'fr', '[ée]coles?\M|lyc[ée]e (militaire|de la d[ée]fense)|acad[ée]mie|prytan[ée]e|centre de formation|centre d.instruction|saint-cyr'),
    (50, 'military_school', false, 'de', 'schule|akademie'),
    (50, 'military_school', false, 'en', 'academy|school|college'),
    -- Ammunition and supply depots.
    (60, 'military_depot', false, 'fr', 'd[ée]p[ôo]ts?\M|munitions?\M|poudri[èe]re|entrep[ôo]ts?\M|stockage|carburants?\M|service des essences|p[ée]troli|pyrotechni|ravitaillement|logistique'),
    (60, 'military_depot', false, 'de', 'munition|materiallager|\mdepot\M'),
    (60, 'military_depot', false, 'en', 'ammunition|\mammo\M|\mdepot\M|storage'),
    -- Forts, Maginot line works, batteries, citadels.
    (70, 'military_fort', false, 'fr', '\mforts?\M|ouvrage|citadelle|batterie|redoute|casemate|blockhaus|\mblocs?\M|forteresse|fortin|bastion'),
    (70, 'military_fort', false, 'de', 'festung|\mfort\M|zitadelle|schanze'),
    (70, 'military_fort', false, 'en', 'fortress|citadel|\mfort\M|battery|redoubt'),
    -- Barracks and bases (army units, air bases: "BA 901", naval air stations).
    (80, 'military_base', false, 'fr', 'caserne|quartier|r[ée]giment|\mbases?\M|\mBA ?[0-9]|\mBAN\M|d[ée]tachement|garnison|escadron|escadrille|bataillon|a[ée]ronavale|terrain d.aviation|\mcamps?\M|l[ée]gion|commando'),
    (80, 'military_base', false, 'de', 'kaserne|fliegerhorst|st[üu]tzpunkt|flugplatz|garnison'),
    (80, 'military_base', false, 'en', 'barracks|air ?base|naval base|air station|naval station|\mRAF\M'),
    -- Radar, radio and listening stations, signal stations (sémaphores).
    (90, 'military_radio', false, 'fr', 'radar|s[ée]maphore|transmissions?\M|hertzien|radio|[ée]metteur|[ée]coute|\mrelais\M|antennes?\M|t[ée]l[ée]com|vigie|d[ée]tection'),
    (90, 'military_radio', false, 'de', 'radar|funk|fernmelde|\msender\M|sendeanlage|horch'),
    (90, 'military_radio', false, 'en', 'radar|radio|\msignals?\M|transmitter|listening'),
    -- Offices: staff, recruitment, ministries.
    (100, 'military_office', false, 'fr', 'cirfa|recrutement|[ée]tat[- ]major|\mDMD\M|d[ée]l[ée]gation|direction|bureau|minist[èe]re|commandement|centre d.information'),
    (100, 'military_office', false, 'de', 'kreiswehrersatzamt|karriere(center|centrum)|kommando|\mamt\M|ministerium'),
    (100, 'military_office', false, 'en', 'headquarters|\mHQ\M|recruit|ministry|\moffice\M');
