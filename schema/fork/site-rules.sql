-- Fork: what a military site's name says it is (site-kinds.sql's military_kind). OSM's
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
-- Three kinds here are not shown as they are (sites.sql resolves them):
-- not_military (left out: an archery or shooting club), shooting_stand (part of the
-- military site around it, a range when alone and large, else a club's: left out),
-- and military_camp (a training ground from 90 ha, else a garrison: the big camps,
-- Mailly, Suippes, Canjuers's Vaugine, are training grounds; the small ones, Camp des
-- Loges, des Matelots, de Sainte-Marthe, barracks and staffs).
--
-- To add a word or a language: a row (or an alternative in a row's pattern) with
-- the kind it means. Safe to run more than once; site-kinds.sql reads it, so run the site files
-- after changing it (a database rebuild does both).
CREATE OR REPLACE VIEW military_name_rule (priority, kind, replaces_tags, language, pattern) AS VALUES
    -- Not military: clubs mapped as military ranges.
    (10, 'not_military', true, 'fr', 'tir [àa] l.arc|ball[- ]?trap|club de tir|soci[ée]t[ée] de tir|tir sportif|\marchers?\M|\marc club|mus[ée]e|\mEPIDE\M'),
    (10, 'not_military', true, 'de', 'bogensch|sch[üu]tzen(verein|haus|gilde|gesellschaft)'),
    (10, 'not_military', true, 'en', 'archery|rifle club|gun club|shooting club'),
    -- Police and gendarmerie mapped as military (their schools, CRS companies, the
    -- Garde républicaine, mountain rescue): Police, gendarmerie, customs.
    (20, 'gendarmerie', true, 'fr', 'garde r[ée]publicaine|\mPGHM\M|\mPSIG\M|\mEGM\M|gendarmie|peloton (motoris|d.autoroute)|brigade de (proximit|recherches)'),
    (22, 'customs', true, 'fr', '\mdouanes?\M'),
    (22, 'customs', true, 'de', '\mzoll'),
    (21, 'police_national', true, 'fr', '\mpolice\M(?! militaire)|commissariat de police|\mcommisariat\M|\mC\.?R\.?S\M|compagnie r[ée]publicaine de s[ée]curit[ée]'),
    (21, 'police_national', true, 'de', 'polizei'),
    -- A shooting stand.
    (30, 'shooting_stand', true, 'fr', '\mstands? de tir'),
    (30, 'shooting_stand', true, 'de', 'schie(ß|ss)(stand|anlage)'),
    (30, 'shooting_stand', true, 'en', 'shooting range|rifle range'),
    -- Schools and training establishments (before camps: Saint-Cyr Coëtquidan is the
    -- academy, on its camp).
    (35, 'military_school', false, 'fr', '[ée]coles?\M|lyc[ée]e (militaire|de la d[ée]fense)|acad[ée]mie|prytan[ée]e|centre de formation|centre d.instruction|saint-cyr|\mCFIM\M|aguerrissement'),
    (35, 'military_school', false, 'de', 'schule|akademie'),
    (35, 'military_school', false, 'en', 'academy|school|college'),
    (35, 'military_school', false, 'es', 'escuela|academia'),
    -- Military airfields: air bases ("BA 105"), the Navy's air stations, army
    -- aviation, the air force's flying units (before schools' camps and ranges: an
    -- "Escadron de transport et d'entraînement" flies). The aerodromes themselves:
    -- site-kinds.sql's site_kind.
    (36, 'military_airfield', false, 'fr', 'base a[ée]rienne|\mBA ?[0-9]|a[ée]ronautique navale|a[ée]ronavale|\mBAN\M|escadre|escadrille|flottille|escadrons? (de chasse|de transport|de transformation|de soutien technique a[ée]ronautique|d.h[ée]licopt|de ravitaillement|de d[ée]tection|de drones|de reconnaissance|de transit)|\mRHC\M|r[ée]giment d.h[ée]licopt|\mALAT\M|aviation l[ée]g[èe]re|avions de l.arm[ée]e|h[ée]liport militaire|h[ée]listation|a[ée]rodrome|terrain d.aviation|commandos? (parachutistes? )?de l.air|artillerie de l.air|groupement a[ée]rien'),
    (36, 'military_airfield', false, 'de', 'fliegerhorst|flugplatz|heeresflieger|marineflieger'),
    (36, 'military_airfield', false, 'en', 'air ?base|air station|airfield|\mRAF\M'),
    -- Naval bases: ports, arsenals, the Navy's own sites (not the army's "infanterie
    -- de marine": "de la marine" is the Navy's; its radio stations, recruitment
    -- offices and archives are what they are). After research: the Navy's
    -- hydrographic service is one.
    (39, 'military_naval_base', false, 'fr', 'base navale|arsenal|port militaire|zone portuaire militaire|appontements?|\mdigue|centre marine|fusill?iers marins|sous-marins?\M|^(?!.*(transmission|cirfa|historique)).*(de la marine|marine nationale)\M'),
    (39, 'military_naval_base', false, 'de', 'marinest[üu]tzpunkt|marinebasis'),
    (39, 'military_naval_base', false, 'en', 'naval (base|station)|dockyard'),
    -- Research, test and weapons establishments: the CEA's military sites, the DGA's
    -- test centres, ONERA, the Franco-German institute, the arms makers (before
    -- ranges: "DGA Essais de missiles" is a test centre).
    (38, 'military_research', false, 'fr', '\mC\.?E\.?A\.?\M|\mDAM\M|\mDGA\M|\mD\.G\.A\.|recherches?\M|[ée]tudes scientifiques|exp[ée]rimentation|\messais\M|\mONERA\M|\minstitut\M|hydrograph|naval group|\mKNDS\M|nexter|\mMBDA\M|thal[eè]s|safran|arianegroup|expertise technique|section technique'),
    (38, 'military_research', false, 'de', 'forschung|erprobung|wehrtechnisch|rheinmetall|krauss'),
    (38, 'military_research', false, 'en', 'research|test (centre|center|range)|laborator'),
    -- Ranges and training grounds. A Swiss "Place d'armes de Bure" is the army's
    -- training ground; a French "Place d'armes" alone is a barracks' parade ground.
    (40, 'military_range', false, 'fr', '\mtirs?\M|aire de feu|place d.armes (de|du|des|d.)|village de combat|c[ôo]ne de s[ée]curit|zone dangereuse|polygone|man[œo]e?uvres?|terrain d.exercice|entra[iî]nement'),
    (40, 'military_range', false, 'de', '[üu]bungsplatz|schie(ß|ss)platz|bombodrom|truppen[üu]bung'),
    (40, 'military_range', false, 'en', 'training area|firing range|bombing range|\mrange\M'),
    -- Camps: "Camp de ...", "Camp militaire ...", "Terrain militaire de ..." (a camp
    -- named for a person is a base).
    (45, 'military_camp', false, 'fr', '\mcamps? (de |du |des |d.|militaire)|terrain militaire'),
    (45, 'military_camp', false, 'es', 'campamento'),
    (45, 'military_camp', false, 'de', '\mlager\M|truppenlager'),
    (45, 'military_camp', false, 'en', '\mcamp\M'),
    -- Ammunition and supply depots.
    (60, 'military_depot', false, 'fr', 'd[ée]p[ôo]ts?\M|munitions?\M|poudri[èe]re|entrep[ôo]ts?\M|stockage|carburants?\M|service des essences|p[ée]troli|pyrotechni|ravitaillement|logistique|soutien op[ée]rationnel|subsistances|\mELOCA\M|[ée]tablissement logistique|\mETAMAT\M|[ée]tablissement du mat[ée]riel|atelier industriel|\mAIA\M|service industriel|parc d.artillerie|\mBSMAT\M|zone technique|[ée]conomat'),
    (60, 'military_depot', false, 'de', 'munition|materiallager|\mdepot\M'),
    (60, 'military_depot', false, 'en', 'ammunition|\mammo\M|\mdepot\M|storage'),
    -- Forts, Maginot line works, batteries, citadels.
    (70, 'military_fort', false, 'fr', '\mforts?\M|\mlunette|ouvrage|citadelle|batterie|redoute|casemate|blockhaus|\mblocs?\M|forteresse|fortin|bastion'),
    (70, 'military_fort', false, 'de', 'festung|\mfort\M|zitadelle|schanze'),
    (70, 'military_fort', false, 'en', 'fortress|citadel|\mfort\M|battery|redoubt'),
    -- Barracks and bases: the army's, and joint ones.
    (80, 'military_base', false, 'fr', 'caserne|quartier|r[ée]giment|\mbases?\M|d[ée]tachement|garnison|escadron|bataillon|\mcamps?\M|l[ée]gion|commando|brigade|[ée]l[ée]ment air rattach|\mmess\M|cercle (militaire|mixte|des officiers)|logements militaires|\mstade|gymnase|sporti|\msports?\M|parcours|biathlon|\mDZ\M|\m[0-9]+ ?(e|er|[èé]me)? ?(R\.?A\.?|RI|RIMa|RPIMa|RPH|REC|REI|REG|RCP|RHC|RMT|RAMa|BCA|BCP|RG|RT)\M'),
    (80, 'military_base', false, 'es', 'cuartel|acuartelamiento'),
    (80, 'military_base', false, 'de', 'kaserne|st[üu]tzpunkt|garnison'),
    (80, 'military_base', false, 'en', 'barracks'),
    -- Radar, radio and listening stations, signal stations (sémaphores).
    (90, 'military_radio', false, 'fr', 'radar|s[ée]maphore|transmissions?\M|hertzien|radio|[ée]metteur|[ée]coute|\mrelais\M|antennes?\M|t[ée]l[ée]com|vigie|d[ée]tection|t[ée]l[ée]port|satellit|[ée]mission|\mCDC\M|\mCROSS\M|surveillance et de sauvetage|signalisation maritime'),
    (90, 'military_radio', false, 'de', 'radar|funk|fernmelde|\msender\M|sendeanlage|horch'),
    (90, 'military_radio', false, 'en', 'radar|radio|\msignals?\M|transmitter|listening'),
    -- Offices: staff, recruitment, ministries.
    (100, 'military_office', false, 'fr', 'cirfa|recrutement|[ée]tat[- ]major|\mDMD\M|d[ée]l[ée]gation|direction|bureau|minist[èe]re|commandement|centre d.information|service de sant[ée]|archives|commissariat de l.arm|service d.infrastructure|\mSID\M|pr[ée]fecture maritime|\mbalard\M|maison de l.arm[ée]e'),
    (100, 'military_office', false, 'de', 'kreiswehrersatzamt|karriere(center|centrum)|kommando|\mamt\M|ministerium'),
    (100, 'military_office', false, 'en', 'headquarters|\mHQ\M|recruit|ministry');
