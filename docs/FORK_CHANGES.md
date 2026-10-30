# What this fork changes, and why

This fork of [openinframap/openinframap](https://github.com/openinframap/openinframap)
exists to run Open Infrastructure Map **entirely on your own computer**: your own
database, tile server and backend, built from OpenStreetMap data for a region you
choose, and shareable (on a USB drive, say) with a computer that has no internet
connection.

This document records what was changed and the reasoning behind each decision, so the
next person (or the next merge from upstream) doesn't have to rediscover it. For *how
to use* the result, see [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

- [Goals and decisions](#goals-and-decisions)
- [Building the data: `build-region.sh`](#building-the-data-build-regionsh)
- [EEZ country boundaries](#eez-country-boundaries)
- [Per-country stats](#per-country-stats)
- [Starting the app: `launch.sh` and `start.sh`](#starting-the-app-launchsh-and-startsh)
- [Backend in Docker](#backend-in-docker)
- [Sharing a built database: export / import](#sharing-a-built-database-export--import)
- [Search](#search)
- [Background map](#background-map)
- [Wikidata popups and image cache](#wikidata-popups-and-image-cache)
- [Critical sites (from OpenStreetMap)](#critical-sites-from-openstreetmap)
- [Extra data (not from OpenStreetMap)](#extra-data-not-from-openstreetmap)
- [My layers (layers you make on the map)](#my-layers-layers-you-make-on-the-map)
- [Grid connections between two stations (prototype)](#grid-connections-between-two-stations-prototype)
- [Satellite imagery (offline)](#satellite-imagery-offline)
- [One look for the panels; Settings](#one-look-for-the-panels-settings)
- [Tests](#tests)
- [Smaller fixes](#smaller-fixes)
- [Known limitations](#known-limitations)
- [Fork structure: keeping upstream's files close to upstream](#fork-structure-keeping-upstreams-files-close-to-upstream)
- [Merging from upstream](#merging-from-upstream)

---

## Goals and decisions

| Goal | Decision |
|------|----------|
| A new user shouldn't need to understand the stack | One entry point (`scripts/launch.sh`) that asks a few questions up front and then runs unattended; `scripts/start.sh` for every day after |
| Any region, up to the whole world | Geofabrik regions by menu or search, plus the planet file; downloads are kept and reused |
| Don't reprocess big regions | Ready-made exports (`export-db.sh` / `import-db.sh`) restore in minutes |
| Work without internet | Exports carry the database; the Docker images are saved alongside; the backend runs from its image |
| Background map offline too | Optional per region: `build-region.sh` downloads it (full or reduced detail) and a small local server serves it; otherwise it comes from openinframap.org |
| Stay mergeable with upstream | New behaviour lives in new files (`scripts/`, `schema/local-stats.sql`, `schema/eez.sql`, `tools/`) where possible; upstream files get small, commented changes |

---

## Building the data: `build-region.sh`

`scripts/build-region.sh` replaces the earlier `setup-local-db.sh` and `update-db.sh`.
`launch.sh` calls it when there's no database yet.

**Region menu.** The 9 Geofabrik continents with live download sizes, the whole world,
Luxembourg (46 MB, builds in under a minute, for testing), a search over all ~550
Geofabrik regions by name (e.g. "brem" → Bremen), and "use an `.osm.pbf` I already
have". Regions already downloaded or exported are marked in the menu.
*Why:* previously you had to download a PBF by hand and rename it to
`data/region.osm.pbf`.

**All questions first.** Region, whether to wipe the existing database, the EEZ
download, Wikidata images, disk space warnings: everything interactive happens before
any long step. *Why:* a continent build can take hours; it shouldn't stop halfway to
ask something.

**Downloads are kept and reused** in `data/osm/<region>-latest.osm.pbf`. Downloads
resume after an interruption (`curl -C -`), are checked against Geofabrik's MD5, and
only replace an older file once the new one is complete and verified. If Geofabrik
has a newer extract, the script *asks* (default: keep yours; `--refresh` always takes
the newer one). *Why:* Geofabrik republishes daily, and silently re-downloading 33 GB
(Europe) or 95 GB (world) because a database was wiped would be painful.

**Pre-filtering with osmium.** Before importing, the extract is filtered down to the
objects the imposm mapping actually imports. `scripts/osm_filter.py` generates the
filter from the mapping itself (`imposm/*.py`), so it stays correct when the mapping
changes. osmium runs in a small Docker image (`tools/osmium/Dockerfile`, Compose
service `osmium`, profile `tools`).
- Luxembourg: 46 MB → 0.3 MB. Russia: 3.9 GB → 53 MB; the whole Russia build takes
  about a minute and a half.
- *Why:* imposm reads every node of the input. A full Europe import was taking 10+
  hours and its node cache alone would have filled the disk Docker lives on.
- *Verified:* Bremen imported with and without the filter gives the same row counts
  in all 36 tables and the same geometries. The only differences are polygon order
  inside a few multipolygons, which also differs between two unfiltered runs.

**Whole world** (`--region planet`): the weekly planet file from
planet.openstreetmap.org (~95 GB). The script shows a warning with time and disk
estimates and asks before starting.

**Disk space checks** up front for `data/osm/` and for Docker's storage, using the
ratio measured on Russia (database ≈ 17× the filtered extract, rounded up to 20×).

**Build history.** `data/osm/build-history.log` records every build, export and
import: started, completed (with duration), failed (with the step) or interrupted.
The script shows the last few entries and everything already on disk when it starts.
*Why:* so it's obvious what exists if the database is deleted by accident.

**Progress.** Long quiet steps (views, EEZ import, stats, search indexes, restore)
show a ticking timer so it's clear nothing is frozen. Postgres doesn't report
progress for these, so a real progress bar isn't possible.

**Unattended mode** for servers and batch builds: `--region <id> --yes`,
`--pbf <file>`, `--refresh`, `--rebuild`, `--images` / `--no-images`, `--no-filter`.

**Build info.** Every build writes an `oim_build_info` table (region, OSM data date,
git commit, schema fingerprint, build time). `launch.sh`, `start.sh` and the exports
read it.

---

## EEZ country boundaries

EEZ = Exclusive Economic Zone. The marineregions.org "Union of the EEZ and land"
dataset gives one shape per country covering its land *and* sea. The backend uses it
to attribute features to countries, including offshore wind farms, platforms and
cables. Without it, search and every `/stats` country page fail; the map itself works.

- It's free (CC-BY 4.0) but behind a short form, so it's the one manual download.
  The script explains what it is, prints the link, opens the page, finds the zip in
  `~/Downloads` or `data/`, and accepts `skip`.
- The import SQL moved to `schema/eez.sql` (it was duplicated in two scripts).
- `shp2pgsql` now runs inside the PostGIS container, so the host doesn't need it.
  The alpine PostGIS image ships it without `libintl`, so the script installs that on
  the fly.

---

## Per-country stats

The country pages read the `stats` schema, which production fills with a scheduled
job (`schema/jobs/update-stats.sql`). Locally it was always empty, so every country
page crashed (`'None' has no attribute 'date'`). Builds now take one snapshot.

The production job's queries were unusably slow for Russia: 14+ minutes and still
running on power lines alone. Russia's EEZ shape crosses the 180° meridian, so its
bounding box covers the whole world and every feature on Earth was compared against
it. `schema/local-stats.sql` computes the same numbers country by country, so PostGIS
prepares each country shape once: 19 seconds for Russia. The upstream job file is
left untouched to keep merges clean.

---

## Starting the app: `launch.sh` and `start.sh`

- **`launch.sh`** (first time): checks prerequisites, builds or imports a database if
  there isn't one, writes `web/.env` and `web-backend/.env`, starts Tegola, offers to
  start the app, then offers to fill the Wikidata cache.
- **`start.sh`** (every day): no questions. Starts the database, Tegola and the
  backend, opens the frontend in a new terminal window, waits until it answers, and
  opens http://localhost:5173 in the browser. Anything already running is left alone.

Details and why:
- **New terminal windows** for the frontend (GNOME Terminal tested; Ptyxis, Konsole,
  Xfce Terminal, kitty, Alacritty, xterm and macOS Terminal supported but untested).
  The script's `PATH` is passed along, because a new window doesn't load your shell
  config and wouldn't find `uv` in `~/.local/bin` or Node from nvm.
- **The frontend only runs `npm install` when packages changed**, so it also starts
  offline from a copied `node_modules/`.
- **Rebuild on start:** the backend and Tegola images are rebuilt before starting
  (quick when nothing changed) so code changes are picked up; offline it falls back
  to the existing images.
- **Image cache question last**, with a real estimate ("N features have no cached
  text, M have no photo, up to ~X min") and three choices: text and images (slow),
  text only (~10 s), skip. It always prints the commands to run it later.
  `fetch_images.py --count` provides the numbers, so they match what the script
  would fetch.

---

## Backend in Docker

The backend now runs as the Compose service `backend` (port 8001), built from
upstream's own `web-backend/Dockerfile`.

- *Why:* `web-backend/.venv` points at a Python installed in your home folder, so a
  copied project couldn't start the backend on another computer without internet.
  The image contains its own Python and packages.
- The service runs the image's virtualenv directly (`/app/.venv/bin/uvicorn`)
  instead of the Dockerfile's `uv run`, which can try to install packages at startup.
  Tested with networking switched off.
- `data/images` and `data/wikidata_json` are mounted in, so offline popups work.
- `web-backend/.dockerignore` keeps the host `.venv` (400 MB) and `.env` out of the
  image.
- `uv` is now optional: only for the Wikidata cache script, or to run the backend on
  the host with auto-reload while developing it (`docker compose stop backend` first).
- `pool_pre_ping=True` on the database engine (`web-backend/src/main.py`): a backend
  running on the host survives the database being rebuilt or re-imported underneath
  it. Before, the first request afterwards failed.

---

## Sharing a built database: export / import

- **`export-db.sh`** writes `data/exports/<region>.oimdb` (`pg_dump`, zstd-compressed,
  only the `public`, `countries` and `stats` schemas) and `<region>.json` (region, OSM
  date, git commit, schema fingerprint, size, SHA-256). It can also save all five
  project Docker images to `data/exports/docker-images.tar.gz` (461 MB) for offline
  computers.
- **`import-db.sh`** restores one. `build-region.sh` lists exports in its menu
  ("✓ ready-made export — imports in minutes") and asks "Import it? (No = rebuild)".
- **Offline:** without internet the menu shows only exports, earlier downloads and a
  local `.osm.pbf`, instead of failing on the Geofabrik region list. Missing Docker
  images are loaded from the export folder *before* any container starts; otherwise
  Docker would try to download them.
- **Safety:** the import verifies the checksum (a damaged copy is caught) and warns
  if the export was made with a different import mapping or views.
- **Restore details** (why the restore uses a filtered object list): a fresh database
  already has PostGIS, its `spatial_ref_sys` table and the functions from
  `schema/functions.sql`, so those are skipped. Functions created by `views.sql`
  (e.g. `power_lines()`, which Tegola needs) are *not* in a fresh database and must be
  restored. The first version skipped all functions and broke every tile.
- *Verified* with Luxembourg: identical row counts in all 49 tables; 21 tiles across
  all 7 map layers have identical features to a fresh build; backend pages work; and a
  simulated offline computer (no database, no images, no region list, downloads
  blocked) imported it in 18 s.

Why not copy the Docker volume? It's tied to the Postgres version and includes
imposm's working tables. A `pg_dump` is smaller, portable and verifiable.

---

## Search

The search box combines three sources: coordinates, the backend's local database
search, and optionally a Photon server.

**One failing source no longer blanks the results.** The box waited for all sources
with `Promise.all`, so if any one failed (e.g. an online service while offline) you
saw nothing. Now `Promise.allSettled` in `web/src/search/search.ts`; this bug is in
upstream too.

**Word matching.** "Vianden" found the substation "Vianden" but not the plant
"Centrale de Vianden". `web-backend/src/views/search.py` now also matches names
where any word starts with the query (Postgres `\m` word-start regex; "ian" doesn't
match). Exact names first, then name prefix (the old results), then word matches.

### Everything else with a name

Upstream searches substations and power plants; the fork adds places (below) and
everything else with a name: critical sites, power lines (one result per name, as a
line comes in many pieces), generators, switchgear, telecoms buildings, sites,
masts, antennas and cables, oil and gas sites, wells and pipelines, water plants,
reservoirs, towers and wells, street cabinets, and the extra data (ICPE sites,
biomethane injection points, named distribution substations). About 250,000 for
France. Power towers are left out: their "names" are mostly reference numbers.

- **`schema/search.sql`**: the materialized view `search_feature`, one point per
  feature with its kind, the layer switcher entry that shows it, and the nearest
  city, town or village (or the commune the data gives, for ICPE), since tens of
  thousands of features share a name ("Mairie", "Château d'eau"). Names are kept in
  lower case without accents (`unaccent`), alone and with the town, with trigram
  indexes. Built in ~15 s by `build-region.sh` after the extra data tables;
  `extra_data.py` refreshes it after `import`, `dedupe` and `remove`; `import-db.sh`
  enables `unaccent` before the restore and builds the view for older exports.
- **`search_features`** in `search.py`: name prefix or word match without accents
  ("hopital" finds "Hôpital"), and for several words, all of them in the name or the
  town ("mairie duppigheim", "hopital strasbourg"). Important ones first (Seveso
  sites, hospitals...). 10-50 ms.
- **Results** say what and where ("Town hall, Duppigheim", "Classified installation
  (ICPE), Montauban"; `web/src/search/openinframap.ts`), and picking one also
  switches on its layer (`layer` on the result; `OIMSearch` takes a callback,
  `openinframap.ts` calls the layer switcher).

### Places, offline (replaces OpenCage)

Upstream finds towns and addresses with OpenCage, an online service whose key only
works from `localhost`. The fork imports places itself, so the search box finds
cities, towns and villages offline, for the region you built:

- **Import:** `imposm/places.py` (fork-only, one import line in `imposm/main.py`)
  adds an `osm_place` table: countries, states, regions, counties, municipalities,
  cities, towns, villages, hamlets, boroughs, suburbs, quarters, neighbourhoods,
  islands, islets, archipelagos, with population. Upstream's mapping dropped the
  `place` tag at read time, so it's taken off that drop list.
- **Pre-filter made exact:** `scripts/osm_filter.py` now keeps only the OSM object
  types each tag needs (e.g. `n/place=country,state,…` for points only, `nwr/` for
  settlements, which are also mapped as areas). Big administrative places are points
  only: their outlines are huge and the search needs one point. Re-verified on Bremen:
  filtered and unfiltered imports identical in all 50 tables.
- **Preparation** (`schema/places.sql`, run by builds after the import): an area
  containing a point with the same name and type is dropped (the same place mapped
  twice), remaining areas become a point inside them, unnamed places are removed.
  Russia: 343 MB → 93 MB, 355,000 → 177,000 places, Novosibirsk & co. no longer
  listed twice.
- **Search** (`search_places` in `search.py`): same name matching; ordered by match
  quality, then importance (country … town before infrastructure, villages, hamlets
  and neighbourhoods after it), then population. Works without the EEZ boundaries
  (the country is just left out). Results show e.g. "Town, Luxembourg".
- **Indexes:** `create_indexes.py` covers `osm_place` like the other tables.
- **Cost, measured on Russia:** database 1.11 GB (+~10%), places table 93 MB
  including indexes, preparation 10 s, imposm import 46 s; searches take 6-60 ms.
  So hamlets and neighbourhoods are included.
- **OpenCage removed** (`web/src/search/opencage.ts` deleted, no attribution
  footer). Upstream's older, unused `web/src/geocoder.ts` is left untouched.
- **Merging:** the frontend drops a result with the same name within ~5 km of a
  better-scored one (local place vs Photon, or point vs area).

Existing databases and exports have no places until rebuilt; the search then simply
returns no places.

### Photon (optional, configured by hand)

[Photon](https://github.com/komoot/photon) is an OpenStreetMap geocoder with street
addresses. Setting it up isn't handled by the scripts (pre-built indexes are 32 GB
for Europe, 63 GB for the world, and the per-country ones are outdated), but the app
can use one:

- `VITE_PHOTON_URL` in `web/.env` (e.g. `http://localhost:2322`); empty = not used.
- A **Photon row in the Map sources panel** shows where the setting comes from, can
  set or clear it for the current tab, checks the server answers, and explains how to
  set the default.
- `web/src/fork/search/photon.ts` queries `<url>/api` on every search; tested against
  photon.komoot.io ("Alexanderplatz" → Berlin; its "Bremen, Germany" merged with the
  local result).

**Search indexes.** Production creates name indexes with
`web-backend/create_indexes.py`; local builds never did. Builds and imports now run
it from the backend image (~5 s for Luxembourg). It also creates `pg_trgm` trigram
indexes (names in the 13 search languages, 70 in all) so word matching stays fast on
big regions. `pg_trgm` is a "trusted" extension, so the database owner can enable it.
Exports don't contain extensions, so `import-db.sh` enables it before restoring;
without that, restoring an export with these indexes failed.

---

## Background map

The background map (roads, buildings, water, place names) is a
[Protomaps](https://protomaps.com) build. openinframap.org serves it, and our map
style is written for Protomaps' layer layout (`roads`, `buildings`, `water`,
`places`, …), so other tile servers (OpenStreetMap's image tiles, OpenMapTiles)
would show a blank background.

We first decided not to host it. To run 100% offline we now can, optionally, per
region:

- **Download:** `build-region.sh` asks, with real sizes (measured with a dry run):
  **full detail** (to zoom 15: individual buildings), **reduced detail** (to zoom 13,
  ~3-4× smaller, blurry when zoomed in close) or **skip**. Full is the default unless
  it's over 10 GB. `--basemap full|reduced|none` for unattended runs.
- **How:** `pmtiles extract` cuts the region out of Protomaps' daily world build,
  fetching only that part, using the region's real outline from the Geofabrik index
  (or a local `.osm.pbf`'s bounding box). The whole world at full detail is the
  build file itself (~139 GB), downloaded resumably. Files go to
  `data/basemap/<region>.pmtiles` with a `.json` noting the build and detail level.
- **Serving:** the `basemap` Compose service (`protomaps/go-pmtiles`, `pmtiles serve`)
  on port 8090. No database or rendering: it reads the file.
- **Wiring:** `select_basemap` sets `VITE_BASEMAP_URL` in `web/.env` to the region's
  local map (and removes it if that file is gone), and starts the server. Builds,
  imports, `launch.sh` and `start.sh` all call it. Vite reads `.env` at startup, so
  the script says when the frontend needs a restart.
- **Copying:** `data/basemap/` travels with the project folder, and the server image
  is part of the saved Docker images.
- **Measured** (today's build, by outline): Luxembourg 67 MB full / 24 MB reduced,
  downloaded in 16 s. By bounding box (upper bounds): France 9.5 / 2.3 GB, Russia
  26 / 7.4 GB, Europe 49 / 13 GB. Rendering was checked in a browser: streets, rail
  and place names from the local file, zero requests to openinframap.org.
- **Caveat:** the style targets Protomaps' v4 layout. The build openinframap.org uses
  (2025-03-11) is no longer downloadable; today's build has the same layers and
  renders correctly, and each download records which build it came from. A future
  Protomaps major version could need style changes.
- The default `web/.env` written by `launch.sh` now leaves the URL unset (online)
  until a background map is downloaded.

**Night lights** (NASA Black Marble: the Earth at night) is an alternative background
in upstream's layer menu. It only exists online (tiles from openinframap.org), so the
fork hides the whole Background switch (OpenStreetMap / Nighttime Lights).

*Tried and reverted:* bringing the switch back with night lights greyed out when
offline. It worked, but broke saved map links: links made while the switch was hidden
list their layers without `A` (OpenStreetMap), e.g. `#6/50.4/8.7/B,L`, and the
restored switch then turned the background off, leaving a dark, empty map. If it's
re-enabled later, links without a background layer must default to OpenStreetMap.

**Map sources panel** (`web/src/fork/map-sources/`, a button under the key): shows the
background-map URL in use and its origin (built-in, `web/.env`, or this tab), lets
you switch to another URL immediately (MapLibre `setTiles`, no reload), validates
it ({z}/{x}/{y}, http(s) or `/`), reports when tiles fail to load, and explains how
to change the default in `web/.env`. Overrides live in `sessionStorage`, so they
last until the tab is closed, by design: the permanent default belongs in the
config. The panel is built as a list of sources so a geocoder row can be added
later.

---

## Wikidata popups and image cache

From earlier fork work, still current: `scripts/fetch_images.py` caches Wikidata
entity JSON and Commons thumbnails in `data/` (1 request per second, per Wikimedia's
etiquette), and the backend serves them before trying the internet. The cache is
keyed by Wikidata ID, so it works across regions. Added this session: `--count`, used
by `launch.sh`.

---

## Critical sites (from OpenStreetMap)

Infrastructure people tend to miss, from the same OSM data, as its own map
("Critical sites" in the layer switcher, one entry per category, all off by
default). Counts are France's OSM data in October 2026.

| Category (switcher code) | Kinds |
|---|---|
| Health and emergency (`H`) | hospitals (2,500), clinics and health centres, pharmacies (19,000), fire stations (6,100), police and gendarmerie (6,000), ambulance stations, warning sirens |
| Government and public services (`G`) | parliament and ministries, prefectures, town halls (37,000), tax offices / trésoreries, social security and CAF, France Travail, customs, other offices, courthouses, prisons, embassies, universities |
| Places of worship (`R`) | Christian, Muslim, Jewish, Buddhist and other (60,000; Hindu and Sikh use the generic icon: Maki has none) |
| Fuel and weapons (`F`) | fuel stations, fuel depots and fuel/gas storage tanks, gun shops and gunsmiths |
| Transport hubs (`V`) | airports and airfields, ports and harbours, border controls, rail yards |
| Military (`M`) | military areas, barracks, ranges, military airfields |
| Disused military (`D`) | bunkers, trenches, casemates and other fortifications (8,000 bunkers, nearly all WWII) |
| Food supply (`U`) | supermarkets, wholesalers and cash & carries, distribution centres, silos, slaughterhouses |
| Dams, landfills, weather stations (`Q`) | dams, landfills, weather stations and radars |

- **Import:** `imposm/sites.py`, one `osm_site` table (points and areas) with the
  matched key and value as columns, since `amenity`, `office`, `shop`, `landuse`,
  `barrier` and `railway` are left out of the stored tags. The osmium pre-filter
  follows automatically.
- **Classification:** `schema/sites.sql` (run by `build-region.sh`) sorts rows into
  a category and a kind (`site_kind`, `site_category`) and an importance
  (`site_importance`): 0 for parliament, ministries, prefectures, hospitals,
  prisons, airports with an IATA/ICAO code, cathedrals and basilicas, large military
  areas, border controls, dams, big ports/landfills/depots; 2 for the many small ones
  (pharmacies, churches, town halls, fuel stations, gun shops, silos, bunkers,
  supermarkets except hypermarkets) unless they have a Wikidata entry; 1 for the
  rest. Importance sets the icon size, which sites are labelled before zoom 15, and
  from which zoom areas are filled (8, 11, 13). A storage tank only counts if it
  holds fuel or gas; a WWII bomb crater not at all. All in the materialized view
  `site_feature`, served by Tegola's `sites` map (`sites_area`, and `sites_point`
  through `site_points`).
- **Groups instead of a zoom cut-off:** every site has an icon from zoom 4 (the map
  used to look empty until zoom 12–14). Below zoom 14, `site_points(bbox, zoom)`
  groups sites of the same category in a grid of 12 × 12 cells per tile (~40 px):
  a cell holding several becomes one point with their `count` and `count_label`
  (exact up to 999, then "1.2k", "12k") at their average position. The grid is
  aligned with the tiles, so a group never straddles two and counts don't change
  from one tile to the next. Important sites stay single from zoom 8 (below it,
  hospitals and dams alone would cover the country); from zoom 14 nothing is
  grouped and every icon is drawn, overlapping if need be. Groups of different
  categories in one cell would sit on top of each other, so each category's is
  moved ~10 px its own way, in SQL (with `icon-offset`, MapLibre puts the click
  target elsewhere than the icon). A group is a disc in the category's colour
  (`site_group_<category>.svg`) with the count on it, larger for more; clicking it
  zooms in two levels (`openinframap.ts`). Hiding a kind in the key doesn't change
  the groups' counts. France at zoom 5 is a ~0.5 MB tile taking ~1 s, once (Tegola
  caches tiles up to zoom 13).
- **Map:** `web/src/fork/sites/style.ts`: an icon per kind (a Maki glyph, CC0, in a
  white circle ringed in the category's colour: `web/src/icons/site_*.svg`, made by
  `scripts/make_site_icons.py`), important sites larger and labelled, and a light
  fill for sites mapped as areas. One layer per category so the layer
  switcher and the key (a section per category, a row per kind) can hide each.
  Disused military uses the prefix `sites_disused`, as the switcher matches
  prefixes and `sites_military` would cover it too. Popups: the name (or the kind),
  "Type" and the usual OSM details and links.
- **Left out on purpose:** defibrillators (28,000), post offices, doctors' and
  dentists' surgeries.

## Extra data (not from OpenStreetMap)

Some network operators publish their networks as open data, in far more detail than
OpenStreetMap has. The French distribution networks are the first source: every low-
(BT) and medium-voltage (HTA) line and every street-level substation, from Enedis,
Strasbourg Électricité Réseaux, Vialis and the other operators. OSM doesn't have them
because underground cables can't be verified on the ground, and imports go against
the French community's preference for mapping by hand (the licence isn't the reason).

- **Stored apart, drawn alike.** The data goes into its own schema, `extra`
  (`schema/extra.sql`), and is served as its own Tegola map (`/maps/extra`: lines from
  zoom 10, BT lines and substations from zoom 13), switched on in the layer switcher
  under "Not from OpenStreetMap" (code `X`, off by default). Tegola gives each feature
  a nominal voltage (HTA 20 kV, BT 0.4 kV: French HTA is legally 1-50 kV but 20 kV
  almost everywhere) so `fork/extra/style.ts` draws it with the OSM power expressions:
  same colours, widths and underground dashes as OSM lines of that voltage, and the
  key's voltage and Underground rows apply to it too. Popups say "Not from
  OpenStreetMap" with the source and licence, and have no OSM links. An invisible,
  wider copy of each line layer makes thin lines easy to click. The tables always
  exist, even when empty, because Tegola checks every layer's SQL when it starts.
- **`scripts/extra_data.py`**: `list` shows the sources covering the built region,
  `import` imports them, `remove` removes one, and `offer` (no database needed) tells
  `build-region.sh` whether any source covers a Geofabrik region. Each source is a
  class, so sources for other countries can be added later. Germany and Luxembourg
  have no equivalent nationwide open data yet.
- **Refreshing replaces, dataset by dataset.** Each dataset's old rows are deleted and
  its new ones inserted in one transaction, once the new copy has downloaded. So
  re-running never duplicates rows, finished datasets show on the map while the rest
  download, and a failed refresh keeps the old copy of what it didn't finish.
- **No duplicates of OSM.** OSM is kept as it is; extra features it already has are
  deleted, after each dataset is imported (and by `extra_data.py dedupe` for data
  imported before). Rules, in `schema/extra.sql`, from measurements around Pontivy
  where the answer was clear-cut:
  - a line goes if at least 80% of it is within ~10 m of OSM lines of the same
    voltage class (or no voltage) *and* the same placement. An underground cable
    beside an OSM overhead line is kept: it's usually the buried replacement, or a
    different line along the same road (145 of the 155 underground "matches" there
    were overhead OSM lines);
  - a substation goes if within ~15 m of an OSM small substation, a transformer or a
    pole with a `transformer` tag (big substations are left out: they can contain a
    street transformer without being it).
  In that sample, 66% of overhead HTA lines and a third of the substations were
  already in OSM, but almost no low-voltage lines or underground cables.
  `extra.source.osm_duplicates` counts what was removed.
- **Agence ORE, not each operator's portal.** [Agence ORE](https://opendata.agenceore.fr)
  consolidates all French operators, so it's the one source (also importing SER's own
  portal would duplicate Bas-Rhin). It publishes five datasets (overhead/underground ×
  BT/HTA lines, and HTA/BT substations). Its exports can't be filtered by area, only by
  département: for 20 or more départements each dataset is downloaded whole (all of
  France: 16.3 million features, ~5 GB, about 2 h 20 min, almost all of it waiting on
  their server), otherwise filtered to the départements touching the region. Either
  way only features inside the region outline are kept (Geofabrik's, or the extent of
  the power lines for a local file): a Luxembourg build gets the border strip of
  Moselle, a France build leaves out the overseas départements. Heights in 3D
  geometries are dropped.
- **Gas distribution** comes from the same source (`infrastructures-reseau-gaz`: GRDF,
  Régaz, GreenAlp, Vialis and the other distributors, 4.2 million pipe sections;
  OSM has about 28,000 km of gas pipe in France, roughly the transmission network).
  It goes into `extra.pipeline` and is drawn like OSM gas pipes (`pipeline_colour`
  from `style_oim_petroleum.ts`), from zoom 12, under its own layer-switcher entry
  "Gas distribution (open data)" (code `Y`; power is `X`). 97% of the sections,
  all of GRDF's, have no published pressure: they're drawn like OSM gas pipes
  without a pressure tag (the key's low-pressure distribution colour) but their
  popup says "Not published", since GRDF's network is largely medium pressure.
  Sections published as medium pressure are drawn as intermediate pressure.
  Their server cut the national gas export off twice (after 0.6 and 3.2 million
  rows), so gas is fetched département by département; every download is retried,
  and a national one that keeps failing falls back to départements.
  `extra_data.py import --only gaz` imports just this dataset; pipes OSM already has
  (same 80%-within-10-m rule) are left out.
- **Biomethane injection points** (`points-dinjection-de-biomethane-en-france`, 851
  open sites with exact coordinates: where biogas enters the gas network) go into
  `extra.facility`, a table for point sites (ICPE sites are meant to follow). Shown
  under the gas entry of the layer switcher (the gas layers share the `extra_gas`
  prefix) from zoom 5 with a new icon (`web/src/icons/biomethane_injection.svg`, the
  biomass leaf in a station circle), a key row under Gas, and a popup with capacity,
  feedstock, process, the gas network and operator, and the date in service. OSM has
  almost none of them (21 biogas plants in France, and those are power plants), so
  they aren't checked against OSM. Closed sites are left out. New icons are picked up
  when the frontend dev server starts, so restart it after adding one.
- **ICPE sites** (installations classées: industry, quarries, wind farms, large
  livestock farms regulated for their risks or pollution, Seveso sites among them)
  come from Géorisques' API (`GeorisquesICPE` in `extra_data.py`, source
  `fr-georisques-icpe`; 140 pages of 1,000 for France, 3 minutes, kept in
  `data/extra/georisques-icpe/`). Of 138,812 records only the 43,174 operating sites
  under authorisation or registration are imported: the rest are "other regimes" /
  "not ICPE" records without details, or closing sites. Into `extra.facility` (kind
  `icpe`), drawn as dots coloured by category (Seveso upper/lower tier, industry,
  quarry, wind farm, livestock), Seveso sites larger and from zoom 5, the rest from
  zoom 9; own key section and layer-switcher entry ("Classified installations",
  code `Z`); popups with Seveso status, regime, activities, inspections and a link to
  the site's Géorisques page. OSM duplicates: 75% of ICPE wind farms sit on OSM wind
  turbines, so wind farms within ~500 m of one (or of an OSM wind plant) and
  non-Seveso sites within ~100 m of an OSM combustion or waste power plant (an
  incinerator, a biomass or gas plant) are left out (1,797). Not solar, hydro,
  nuclear or battery plants: a solar farm on a quarry, landfill or warehouse roof
  isn't the site under it (the first version of the rule wrongly removed 165 such
  sites). Seveso sites are always kept, as OSM doesn't record that. 40,336 sites
  for France.
  Licence: Géorisques data is Licence Ouverte; no page says so for the API itself.
- **Downloads are kept**, like the OSM extracts in `data/osm/`: each dataset is saved
  gzipped in `data/extra/agence-ore/<dataset>/` (`all.csv.gz`, or one file per
  département for those fetched that way), with each row's département, and the
  database is loaded from those files. Re-importing (another region, new rules, a
  failed run) reuses them; `import --refresh` downloads again (the build's "fresh
  copy" does). A region smaller than France is cut from a national file by
  département. Downloading to a file also makes retries simple (no partial rows).
- **Kept across rebuilds.** A rebuild wipes the database, and the French data takes
  3-4 hours to download again, so `build-region.sh` saves the `extra` schema first
  (`data/extra/<region>.extra.dump` + `.json`: 2 GB and under a minute for France)
  and puts it back into a rebuild of the same region before `schema/extra.sql` runs
  (which then only adds what's new, so changes to existing extra tables must be
  `ADD COLUMN IF NOT EXISTS`-style). The kept data is then checked against the new
  OSM data (`dedupe`). Restoring France takes about 2 minutes. A saved copy only goes
  back into its own region; `--no-extra` skips it, and the question becomes "download
  a fresh copy as well?". Not restoring an export instead: that would bring back the
  old OSM tables.
- **Licence:** Licence Ouverte 2.0, which requires attribution: the source's
  attribution shows on the map whenever the layer is on.
- **Build and exports:** `build-region.sh` offers extra data only when a source covers
  the chosen region (France, a French region, Europe, a neighbour's border strip), as
  a menu with one line per dataset (electricity, gas, biomethane, ICPE) and what each
  costs, or "no download needed" when it's already downloaded (`extra_data.py offer`
  lists them; `import --choose KEY,...` imports just those). Flags: `--extra` (all),
  `--extra-only gas,icpe`, `--no-extra`; `--yes` means none new. Exports include
  the `extra` schema, and their manifest's `extra_data` says what's in it, shown in the
  build menu and by `import-db.sh`.
- **The old download route.** The importer uses Agence ORE's legacy v2.1 export API,
  which still works through a compatibility layer. Their new Data Fair API serves the
  same data (`/data-fair/api/v1/datasets/<id>/lines?code_departement_eq=…`); moving
  to it, keeping the old one as a fallback, is planned.

---

## My layers (layers you make on the map)

Layers people make themselves, on top of the map: military and emergency symbols,
their own pictures and icons, markers, lines and areas, and copies of map features
(power lines, substations, sites...). Saved in the database with a history that can
be played back step by step. The "My layers" button (top right) opens the panel.

- **Copies of map features** keep the original's properties, get its full geometry
  from the database (`GET /userdata/source-feature`; tiles have it cut at tile edges
  and simplified at low zoom) and are drawn by clones of upstream's own layers for
  that data, pointed at the user layer's source: a copied 400 kV line looks exactly
  like the original, label and towers included. Their map layers start with `user_`,
  which the layer switcher's prefixes never match and the key's hider skips
  (`fork/key/feature-hider.ts`), so hiding the grid (switcher or key) leaves the
  copies on the map.
- **Symbols** are the MIL-STD-2525C point symbols ODINv2 offers (1,258: emergency
  management first, i.e. incidents, infrastructure and emergency services; then
  installations, equipment, units, air, sea...), with affiliation (friend, hostile,
  neutral, unknown) and status (present, planned). Drawn in the browser by
  `@syncpoint/signs`, the library ODINv2 itself uses. **Licences:** ODINv2 is AGPL-3.0,
  which would put this BSD project under the AGPL, so none of its code or catalogue
  is used. `@syncpoint/signs` is MIT (Syncpoint GmbH; built on milsymbol, MIT, Måns
  Beckman), with `ramda` (MIT), `svg-path-bbox` (BSD-3-Clause) and `svgpath` (MIT).
  The names and codes come from the MIT tables of
  [mil-std-2525](https://github.com/spatialillusions/mil-std-2525) (Måns Beckman),
  turned into `web/src/fork/userlayers/symbols-2525c.json` by
  `scripts/make_symbol_catalog.py`. ODIN's Austrian SKKM signs (41) aren't there:
  their list is ODIN's (AGPL). The library is 3 MB, loaded only when the palette
  opens or a layer has symbols (and precached for offline use).
- **Tactical graphics** (version 2): the 413 of MIL-STD-2525C, as in ODIN. Point
  ones (checkpoints, task points...) are drawn by signs like other symbols. Lines,
  areas and arrows (axis of advance, phase line, assembly area, block, breach,
  obstacle lines... 212 drawable) are drawn by the US Army C5ISR renderer
  `@armyc2.c5isr.renderer/mil-sym-ts-web` (Apache-2.0, 7.4 MB / 1.4 MB gzipped,
  loaded on first use, precached) from the points the user clicks
  (`fork/userlayers/graphics.ts`). It draws 2525D/E, so the stored 2525C code is
  converted with its own `C2DLookup`; it says how many points each graphic takes
  (fixed-count ones finish by themselves). Its GeoJSON (lines, polygons, label
  points) goes into a second source per layer (`user_<id>_g`), redrawn when the zoom
  changes, since arrow heads and teeth are sized for a scale. Checked before use: all
  228 of ODIN's line/area graphics have a 2525D equivalent in it. Four catalogue
  entries it can't draw (section headings) are hidden from the picker.
  **Arrows** (draw rules AXIS1/AXIS2: axis of advance, main and supporting attack,
  aviation, airborne...): the standard's points are tip, centre line back to the
  tail, then a point setting the width, which is awkward to click and gave ugly
  results. They're drawn instead as a path from tail to tip (`axis: true`) plus a
  width in metres (`axisWidth`, a fifth of the length to start with).
  `axisControlPoints` turns that into the renderer's points. The width has its own
  blue handle at the arrowhead's corner, separate from the path and from the
  highlighted line: dragging it only changes the width (twice its distance from the
  last stretch of the path), so the arrow keeps its shape wherever it's dragged.
  The arrow redraws live while dragged. Arrows drawn the old way are converted when
  drawn (`pathFromAxisPoints`, keeping their width), one unsaved change each.
- **Details of an item** (version 2): selecting one opens its details in the left
  side panel, like a map feature's (`fork/userlayers/editor.ts`), with the fields
  ODIN has, from the standard (`fields.ts`): identity, status and operational
  condition, echelon, headquarters / task force / feint, mobility (all in the code
  itself: `sidc.ts`); designation, higher formation, type, quantity, additional
  information, staff comments, reinforced/reduced, evaluation rating, combat
  effectiveness, date-time group (or effective from/to), direction, speed, altitude,
  width/radius, attitude (`modifiers` in the properties); plus colour, size, layer
  (moving an item is two changes: out of one layer, into the other), notes and
  position. Only the fields that apply to that kind of symbol are shown. The labels
  are drawn around the symbol (signs) or along the graphic (C5ISR renderer); a
  setting in the Layers tab chooses none / designation only / all.
- **Panel layout** (version 2): tabs Layers (show/hide, colour, the layer new items go
  into, item list that selects and zooms, ⋯ menu) / Add (where to add, tool buttons,
  the picker with category chips, identity as the actual frame shapes, planned,
  recently used) / History; a save bar only while there are unsaved changes; the
  tool's hint at the bottom of the map with a Stop button; the history as a timeline
  bar at the bottom of the map (step, play at 0.5–4×, follow), each step saying what
  changed ("status: Planned → Present", "higher formation", "moved").
- **Pictures** are scaled to at most 1024 px in the browser (WebP; SVGs drawn at that size) and stored in the
  database (`userdata.image`); markers, lines and areas take the layer's colour or
  their own.
- **Changes and Save.** Every edit is a change (add, change, delete a feature; make,
  rename, recolour, delete a layer), applied at once and kept as unsaved, also in the
  browser's storage so a reload doesn't lose them. **Save** sends them all, in order;
  the backend applies them in one transaction and logs each with the layer or
  feature before and after (`userdata.change`, grouped by `userdata.save`, with the
  name typed in the panel). **Discard** goes back to what's saved. Showing or hiding
  a layer isn't a change (it's remembered per browser).
- **History.** The log played back: a slider and step buttons over every saved
  change, each described ("Added symbol "Fire" to "Grid"", when, who), the
  feature highlighted and the map moved to it if needed; Play steps through it.
- **Tools:** Symbol, Graphic, Picture, Marker, Line, Area, Copy from map; select an
  item to edit its details, drag it (points), drag the points of a line, area or
  graphic to change its shape, or delete it (also the Delete key; Esc cancels a
  tool, Enter finishes a drawing). Clicks the panel's tools
  take don't open upstream's popups: `fork/userlayers/index.ts` wraps the click
  router's `handleClick` on the instance, so `click-router.ts` stays upstream's.
- **Storage:** the `userdata` schema (`web-backend/src/fork/userdata.sql`), made by
  the backend on first use. The layers belong to the computer, not to a region:
  `build-region.sh` and `import-db.sh` save them (`data/userdata/userdata.dump`)
  before wiping the database and put them back afterwards (so local ones replace
  any in an imported export); `export-db.sh` includes them.
- **Backend:** `web-backend/src/fork/userdata.py` (`GET /userdata`, `POST
  /userdata/save`, `GET /userdata/history`, `POST`/`GET /userdata/images`, `GET
  /userdata/source-feature`). The frontend calls it through the dev server's proxy
  (`/userdata` in `vite.config.ts`): upstream's CORS settings only allow GET from
  another origin.
- **Not yet:** several people editing at once (the last save wins); adding or
  removing points of an existing line (they can be moved); ODIN's SKKM signs.

## Grid connections between two stations (prototype)

*From branch `grid-routing`.* Pick a substation or power plant as the start and another
as the end; the map shows how they're connected over lines of **110 kV and more**
(smaller lines aren't interesting at this scale), with up to three distinct paths.

- **Network** (`schema/grid.sql`, a build step after `views.sql`): OpenStreetMap
  stores lines as drawings, not connections, so the build turns in-service lines of
  110 kV and more into nodes and edges. Lines connect only where they share a vertex
  (the same pylon); lines that merely cross in the air don't. Line ends and shared
  pylons inside or near a substation (within 100 map units of its outline, 250 of a
  point; ~65 m / ~160 m in central Europe) become that station's node; power plants
  count where no substation does. Tables `grid_node` and `grid_edge`.
- **Paths** (`web-backend/src/fork/grid.py`, `GET /grid/route?from=substation/<id>&to=plant/<id>&paths=3`):
  loads the network around both ends, then uses networkx's shortest simple paths
  and keeps up to three that share at most 70% of their length (so a route that only
  swaps one parallel circuit isn't listed twice). Parallel circuits between the same
  two stations are drawn together. A station without a ≥110 kV line uses the nearest
  station on that grid within a few km, with a notice.
- **Map** (`web/src/fork/grid/`): "Route from here" / "Route to here" buttons in
  substation and plant popups; a panel listing each path with a breakdown of what
  it goes through: every stretch between two stations (distance, voltage), then the
  total (the backend returns these `segments`; junctions between lines are passed
  through, and a route ending at a line tap says "line junction"); paths drawn in different colours, side by side where they share
  lines; clicking a path shows only that one. The selection is kept in the map link
  (`route=s123_p-456`), so it can be shared.
- **Measured:** the network builds in about a second for Luxembourg or Saarland.
  Saarland: 57 substations, 274 line stretches, 925 km; 56 of the 57 substations form
  one connected grid. UA Merzig → UA Rehlingen gives 12.6 km (direct 110 kV), 24.8 km
  (via Saarwellingen) and 60.6 km (via Wadern and Lebach); across Saarland, two
  routes of 93-95 km that split around Bexbach and Heinitz.
- **Details in a side panel** (`web/src/fork/grid/info-panel.ts`): clicking a feature shows its
  details in a panel on the left, under the search box and above the Grid
  connection panel, instead of a popup over the map (which hid what you clicked).
  Both panels have minimise (keeps the highlight / routes on the map, shrinks to the
  title) and close (removes them). Clicking another feature replaces the details;
  clicking the same one again (its icon or its area) deselects it; Escape closes
  them. Picking a **search result** works like clicking it: after the map flies
  there, a substation or power plant opens its full details and highlight; places,
  coordinates and addresses get a short panel and a ring at the location. (The Osmose validation popups are unchanged.)
- **Highlight of the selected feature** (`web/src/fork/grid/highlight.ts`): areas
  (substations, plants, wind farms) get an outline and light fill, lines a glow,
  points a ring. Plants and substations are drawn both as an area and an icon: the
  area is highlighted when it's at least 16 px on screen (largest single part, so a
  plant made of small far-apart parts counts as small), otherwise the icon. The
  pieces of a feature in all loaded tiles are collected, so big areas are
  highlighted whole. Drawn above the background map but below infrastructure labels
  and icons (the background map's own labels come early in the stack, so "below
  the first label" put the highlight under its water).
- **Photos in the panel** are limited to the panel's width and 160 px high, and the
  panel can use most of the screen height (45% when the Grid connection panel is
  open below it), so a photo doesn't make it scroll; it never scrolls sideways.
- **Where a line goes** (`web/src/fork/grid/highlight.ts`,
  `GET /grid/line/<osm_id>`): clicking a power line highlights the whole connection
  it belongs to while its details are shown, not just the clicked piece (OpenStreetMap
  splits lines into many pieces). The backend follows stretches of the same voltage
  through junctions and branch points, stopping at stations; the panel says
  "Connects Heisdorf – Roost · 13.3 km" and has a "Show whole line" link that zooms
  to it. Lines without a known voltage (not in the network) highlight just
  themselves.
- **Limits:** paths are physical connections in OpenStreetMap, not how power flows;
  a missing line or substation in OpenStreetMap can hide a connection; both ends
  must be in the built region (France–Germany needs Europe or a custom region);
  exports made before this have no network (the panel says to rebuild). Not yet
  tested on a continent; the search loads the grid around both ends.
- **Stations on lower voltages** (e.g. Wandpark Housen-Pëtschent and Biogas Our
  Särl, both on a 65 kV line): the network also includes lines of 10 kV and more
  with a known voltage, and lines running *through* a station's outline connect to
  it (the line is split where it enters the outline, so the stretch inside stays
  part of the drawn route). If an end isn't on the ≥110 kV grid, the backend
  follows the lower-voltage lines (up to 50 km) to the nearest station that is;
  the distinct paths still run over 110 kV+ only. Each route is drawn as one line
  in its colour, connection legs included, and the panel's breakdown shows the
  lower-voltage stretches with their voltage. (A first version drew those legs dashed in grey; that read as two
  separate things meeting at a substation.) Example: Wandpark Housen-Pëtschent →
  Schifflange = 62.6 km, incl. 10.6 km at 65 kV to Flebour.
- **Not bridged on purpose:** Centrale de Vianden connects to the Vianden
  substation, but that cluster's 220 kV lines lead to a substation in Germany that a
  Luxembourg-only extract doesn't contain, so it has no path to the rest of
  Luxembourg's grid within that region.
- **Exports and imports:** `grid_node` / `grid_edge` are in the `public` schema, so
  exports include them; importing an export made before them builds the network
  (`import-db.sh`, about 2 minutes for France).
- A station mapped twice in OpenStreetMap (e.g. a substation's outline and its site
  relation, different IDs) is matched silently if within 300 m.
- **Scaling to France** (after merging into the fork's main line): the network build
  ran for over 20 minutes without finishing on France, because of query plans that
  are fine on Luxembourg: temp tables without statistics, `IN (subquery)` /
  `NOT IN (subquery)` filters, junction nodes matched back by `ST_Equals` (every
  junction against every node), and `ST_DWithin` with a per-station distance, which
  can't use the spatial index. Now: `ANALYZE` after each temp table, joins instead
  of `IN`, junction nodes keep their position key while building, and a constant
  reach (250) narrows the station search before the per-station one.
- New dependency: `networkx` (backend), `types-networkx` (dev).
- **Fixes found while testing with real clicks:** substation and line popups failed
  to open at all when the backend was unreachable (the circuits lookup read from an
  empty response); they now open without circuit details. And `build-region.sh` /
  `import-db.sh` stopped the backend (rebuilding removes all containers) without
  starting it again; they now restart it if it was running.

---

## Satellite imagery (offline)

Plan: `docs/plans/satellite-imagery.md`. Built by `scripts/satellite.py` (standard
library; GDAL and pmtiles in Docker), chosen in `build-region.sh` after the
background map, shown by `web/src/fork/satellite/`.

- **Three tiers**, one PMTiles file each in `data/basemap/<region>.sat-<tier>.pmtiles`,
  served by the existing `basemap` service (no new service; Tegola only serves vector
  tiles):
  - *overview*, zoom 0–8: NASA Blue Marble Next Generation from NASA GIBS
    (`GoogleMapsCompatible_Level8`, checked in GIBS' capabilities), the world to
    zoom 5 and the region's bounding box to zoom 8. Luxembourg: 1,369 tiles, 8 MB, 50 s.
  - *regional*, zoom 9–12 (or 13): the ESA WorldCover Sentinel-2 RGBNIR 2021
    composite (10 m, **CC BY 4.0**, stated in the files), 1°×1° cloud-optimised
    GeoTIFFs in a public S3 bucket. GDAL reads only the parts it needs over HTTP
    (for zoom 12 its built-in 20 m version), reprojects, cuts to the region's
    outline, scales the 16-bit reflectance with one fixed curve (so cells match),
    writes WebP tiles. Luxembourg: 0.85 MB, 23 s, a natural-looking result.
    Much smaller than planned (France ~200 MB to zoom 12, not 2 GB).
  - *detailed*, zoom 14–15/16/17, France only (Geofabrik region inside `france`):
    IGN orthophotos (20 cm, Licence Ouverte) from the Géoplateforme WMTS, tiles that
    touch the region's outline, 4 at a time, at most 20 a second.
- **Not used:** Esri / Google / Bing (no offline storage allowed), EOX Sentinel-2
  cloudless 2018+ (non-commercial).
- **Frontend:** `select_satellite` (`scripts/lib/common.sh`) writes
  `VITE_SATELLITE_TIERS` ("URL MIN MAX;..."); the module adds a raster source per
  tier (no layer maxzoom, so a coarser tier is stretched under a finer one where
  that has nothing) as the lowest data layers. **Settings → Background**: Map,
  Satellite (above the whole background map; place names stay above), Satellite
  with roads (moved under the background map's roads, railways and boundaries,
  buildings hidden). Remembered per browser. Settings sections can now be added by
  modules (`addSettingsSection`).
- `import-db.sh` also runs `select_satellite`; `export-db.sh` mentions the imagery
  to copy along with `data/basemap/`.
- **Not run yet:** a full `build-region.sh` with the satellite questions (only the
  steps on their own), and France at full size.

## One look for the panels; Settings

Upstream's controls each had their own look and placement: the layer list opened
while the pointer was over its button, level with it and over the other buttons;
the key opened over the buttons too; the Map sources panel was another button.

- **Right-hand dock** (`web/src/fork/ui/dock.ts`): Layers, Key and My layers open
  **on click** (again to close), next to the buttons rather than over them, one at
  a time, as tall as the map allows and scrolling inside. The open panel's button
  is outlined. Upstream's key and layer list are moved into the dock as they are
  (the layer list's hover handlers are removed), so their code is unchanged.
- **Shared look** (`web/src/fork/ui/panel.css`, `panel.ts`): every panel, left or
  right, has the same light grey title bar with square buttons (×, –), the same
  section titles and a body that scrolls, after the feature details panel.
- **Settings** (`web/src/fork/ui/settings.ts`): a "settings" link in the header,
  after about / stats / export, opens a window with the map sources (background
  map tiles, Photon), which used to have their own map button. Escape, × or a click
  outside closes it.

---

## Tests

Unit tests cover the fork's own code where there's logic to get wrong; upstream's
code keeps upstream's tests. Glue code (adding layers to the map, building panels)
is checked in the browser instead.

| Where | Run | What |
|---|---|---|
| `web/src/fork/**/*.test.ts` (89) | `cd web && npm run test:fork` | My layers: symbol codes (identity, echelon, mobility), descriptive fields and date-time groups, the change store and moving items, history descriptions, the catalogue and its search, geometry editing; tactical graphics through the real C5ISR renderer; satellite tier parsing; search duplicates and descriptions; grid route link and route assembly; the key's feature hider; the dock |
| `web-backend/tests/fork/` (13) | `cd web-backend && uv run pytest` | Grid routes (station parsing, graph, distinct paths, route description), search helpers, My layers' id parsing and schema, search indexes |
| `scripts/tests/` (58, + 1 opt-in) | `uv run --with pytest --with httpx --with psycopg2-binary pytest scripts/tests` | `satellite.py` (tile maths, outlines, cells, estimates, MBTiles, downloads from a local test server), the symbol catalogue, extra data outlines and ICPE categories, the osmium filter, `scripts/lib/common.sh` helpers run in bash, and the setup scripts themselves (below) |

The frontend tests run in happy-dom (a simulated browser, new dev dependency) with
their own config (`web/vitest.fork.config.ts`); upstream's `npm run test` (a real
browser through Puppeteer) excludes `src/fork/`.

**The setup scripts** (`scripts/tests/test_setup_scripts.py`) run for real, but
from a copy in a temporary folder (so their `data/` and `web/.env` are the
copy's), with fake `docker`, `curl`, terminals and browsers
(`scripts/tests/fakes/`) that log what they're asked and answer from the test
(e.g. "the database exists", "this query returns 3"). Nothing reaches Docker, the
database or the network. They check options and `--help`, that bad values and
missing files are refused before anything happens, and the safety rules: the
database is never wiped before the user agrees and the export's checksum matches;
My layers are saved before a wipe and the restore comes after it; an old export
gets search and the grid network built; what `export-db.sh` writes passes
`import-db.sh`'s checks; `start.sh` starts the services and opens the browser, or
explains the manual start without a desktop. They found two bugs: on a fresh
checkout `build-region.sh` stopped silently at the start (a `find` on the not yet
existing `data/wikidata_json/`), and bad `--basemap` / `--satellite` values were only
refused after the questions (now right after the options are read).

**A real build, export and import** of Luxembourg is the last test (opt-in:
`OIM_TEST_REAL_BUILD=1`, several minutes). It runs from a copy of the project in a
separate Docker Compose project (`COMPOSE_PROJECT_NAME=oimtest`: its own
containers, volumes and images; `compose.test.yml` removes the published ports so
nothing clashes with the running app), so **the real map database is never
touched**. It reuses the Luxembourg extract, Geofabrik index and EEZ zip from
`data/`, checks the database after the build and again after importing its own
export, then removes the test project (`docker compose down -v --rmi local`).

## Smaller fixes

- **Upstream merge.** The upstream changes since June were merged (backend moved to
  `web-backend/src/`, SQLAlchemy + asyncpg, PWA, new languages). The fork's code was
  adapted: `src.main:app`, `postgresql+asyncpg://` URLs (`launch.sh` migrates existing
  `.env` files), and the image cache path (the repo-root `data/`).
- **Popups without the backend:** substation and line popups failed to open at all
  when the backend was unreachable (the circuits lookup read from an empty response);
  they now open without circuit details.
- **Backend after rebuilds:** `build-region.sh` and `import-db.sh` remove all
  containers to start a fresh database, which stopped the backend and left the
  frontend without it. They now restart it if it was running.
- **Hiding things from the key.** Every key row has a checkbox: unticking it hides
  those features (with their labels, outlines and click areas) by adding a filter to
  the layers that draw them, worked out from the row's colour or icon
  (`web/src/fork/key/feature-hider.ts`). Filters rather than visibility, so it works
  alongside the layer switcher. The choice is remembered per browser; "Show all"
  undoes it. The checkbox column has a set width (`key.css`), so the boxes line up
  from one section to the next (the spare width used to be shared with it).
- **`npm start`**, not `npm run dev`: upstream renamed the command and every doc was
  out of date.
- **Docs** generally: README, `CLAUDE.md`, this file and `LOCAL_DEVELOPMENT.md`.

---

## Known limitations

- **Background map needs internet** unless you downloaded one for the region (or point
  `VITE_BASEMAP_URL` / the Map sources panel at your own server). Planned: a local
  geocoder, preferring local services and falling back to the online ones, with the
  panel showing and overriding each URL.
- **Node.js and npm must be installed** on the computer running the frontend.
- **Street addresses** need a Photon server (not set up by the scripts); places
  (cities down to hamlets) are found offline for the built region.
- **No live updates**: data is a snapshot; rebuild to refresh.
- **Time estimates for the whole world** are scaled from the Russia build; the first
  real world build will show actual numbers in `build-history.log`.
- **Photos missing on Wikidata** keep showing as "missing" in the cache count.

---

## Fork structure: keeping upstream's files close to upstream

Upstream won't take the fork's changes, so the fork keeps them out of upstream's
files wherever it can, and where it can't, makes them one-line hooks. Upstream
commits then merge with few or no conflicts.

**Frontend: fork modules.** Everything the fork adds to the map lives in
`web/src/fork/`. A module (`ForkModule` in `fork/types.ts`) can add map sources,
layers, layer switcher groups, key sections, popup rules, search descriptions and
code that runs once the map exists. `fork/index.ts` lists the modules and has the
hooks upstream files call:

| Upstream file | Hook |
|---|---|
| `style/style.ts` | `...forkSources()` in the sources, `...forkLayers()` in `getPrimaryLayers` |
| `openinframap.ts` | `...forkSwitcherGroups()` before the Validation group; `forkInit(...)` before clicks are routed (with the URL hash, the info popup kept in a variable, and the circuit inspector) |
| `key/key.ts` | `await forkKey(...)` once its sections are built; `data-icon` on sprites |
| `key/svg.ts` | swatches carry `data-colour`, `data-dash` or `data-layer` |
| `popup/infopopup.ts` | `forkPopup.hiddenKeys()`, `.renderKey()`, `.title()`, `.html()`; `forkPopup.open()` first in `popup()` (details in the side panel) |
| `search/search.ts` | `forkSearchSelected(result)`; `dropDuplicates` from `fork/search`; results carry the backend's result (`backend`) |
| `search/openinframap.ts` | `forkSearchDescription(result)`; `backend: result` |
| `index.ts` | `addForkTranslations()` |

Modules: `fork/extra` (data from outside OSM), `fork/sites` (critical sites),
`fork/userlayers` (My layers: symbols, pictures, drawings, copies, saving, history),
`fork/search` (place and feature descriptions, switching a result's layer on),
`fork/grid` (feature details in a side panel, highlight, where a line goes, routes
between stations), `fork/ui` (the right-hand dock, the shared panel look, the
Settings window). The key's checkboxes
(`fork/key/toggles.ts`) are added to upstream's rows after they're built, working
out what each row hides from its swatch, so upstream's key code is unchanged.
**Adding a layer** = a new module folder plus a line in `MODULES`.

**Translations.** The fork's English strings are in `web/src/fork/locales/en.json`,
added to upstream's at startup (`i18next.addResourceBundle`), which also lets the
fork override an upstream string. Upstream's `web/locales/` is untouched.

**Tile server.** The fork's layers are in `tegola/layers.fork.yml`;
`generate_tegola_config.py` takes more than one layers file (the fork's use
`layers.yml`'s field sets) and the Dockerfile passes it. `layers.yml` is
upstream's.

**Backend.** `web-backend/src/fork/`: its routes go ahead of upstream's
(`main.py`: `routes = fork_routes + routes`), so the fork's search
(`fork/search.py`: word matching, places, everything else with a name) replaces
upstream's at the same URL while `views/search.py` stays upstream's. Its extra
indexes (`fork/indexes.py`) are appended to `create_indexes.py`'s lists.

**Docker Compose.** `docker-compose.yml` is upstream's; the fork's services
(backend, basemap, osmium), ports and SELinux labels are in
`docker-compose.override.yml`, which Compose merges automatically (`!override`
replaces tegola's port list).

**Docs.** `web/README.fork.md` and `web-backend/README.fork.md` hold the fork's
notes; upstream's READMEs only get a pointer line at the end.

## Merging from upstream

The fork's own files are under `web/src/fork/`, `web-backend/src/fork/`,
`scripts/`, `tools/`, the fork's `schema/*.sql` and `imposm/*.py` files,
`tegola/layers.fork.yml`, `docker-compose.override.yml`, `*.fork.md` and the docs.
Upstream files the fork still changes, and how:

| File | Change |
|------|--------|
| `README.md` | The fork's description (the GitHub page) |
| `imposm/main.py` | Imports `places.py` and `sites.py`; no longer excludes the keys they match on |
| `schema/dev-init.sql` | Database from `template_postgis`, pre-installs `intarray` / `hstore` |
| `schema/functions.sql` | Function order fixed for fresh installs |
| `tegola/generate_tegola_config.py`, `Dockerfile` | More than one layers file |
| `web-backend/create_indexes.py` | Appends the fork's indexes |
| `web-backend/src/main.py` | `pool_pre_ping`; the fork's routes first |
| `web-backend/pyproject.toml`, `uv.lock` | `networkx` (grid routes), `types-networkx` |
| `web-backend/src/config.py`, `data.py`, `views/wikidata.py` | Offline Wikidata cache |
| `web/src/index.ts`, `openinframap.ts`, `style/style.ts`, `key/key.ts`, `key/svg.ts`, `popup/infopopup.ts`, `search/search.ts`, `search/openinframap.ts` | Fork hooks (above); backend and tile URLs configurable; background switch hidden |
| `web/src/search/search.ts` | Photon instead of OpenCage (`opencage.ts` is kept, unused); `Promise.allSettled` |
| `web/src/api.ts` | Backend URL configurable; no error when it's unreachable |
| `web/src/style/style_base.ts`, `style_oim_power.ts`, `style_oim_petroleum.ts` | Background layers hidden; a few constants exported for the fork's styles |
| `web/src/elements/external-links.ts` | Popup crash fix |
| `web/vite.config.ts` | Proxies backend routes (also `/userdata`) to the configured backend; PWA exclusions; larger precache limit (symbol and graphics libraries); tests exclude `src/fork/` |
| `web/package.json`, `package-lock.json` | `@syncpoint/signs` (My layers' symbols), `@armyc2.c5isr.renderer/mil-sym-ts-web` (tactical graphics); dev: `happy-dom`; script `test:fork` |
| `web/index.html` | "export (online)" label |

After merging, check: `bash scripts/build-region.sh --region luxembourg --rebuild
--yes`, then `bash scripts/start.sh`, and try a search and a country stats page.
If the import mapping or views changed, old exports will warn that they don't match.
