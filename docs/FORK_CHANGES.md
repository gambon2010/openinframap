# What this fork changes, and why

How the fork is organised today, and recipes for adding to it, are in
`ARCHITECTURE.md`; this page is the history: what changed, why, and the merge notes.

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
Its steps are functions, run in order by the last lines of the script (the questions
first, then `download_extract`, `filter_extract`, `import_osm`...); a step must not
end with a test that can be false (`set -e`; checked by a test).
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
- **Start order** (2026-11-05, `docker-compose.override.yml`): the database has a
  health check (`pg_isready` over TCP, which only answers once its first-start setup
  is done); Tegola and the backend wait for it (`depends_on: condition:
  service_healthy`). Tegola connects once at start and exits if it can't: started
  together with the database it used to stay down. It also restarts by itself up
  to 5 times (`restart: on-failure:5`).

---

## Sharing a built database: export / import

- **`export-db.sh`** writes `data/exports/<region>.oimdb` (`pg_dump`, zstd-compressed,
  only the `public`, `countries` and `stats` schemas) and `<region>.json` (region, OSM
  date, git commit, schema fingerprint, size, SHA-256). It can also save all five
  project Docker images to `data/exports/docker-images.tar.gz` (461 MB) for offline
  computers.
- **Exports kept up to date:** `export_outdated` (`lib/exports.sh`) compares the
  region's manifest with the database (`built_at`, `schema_hash`, extra data);
  `reexport_if_outdated` runs `export-db.sh --yes --no-docker-images` at the end of
  `build-region.sh` (unless `--no-export`) and of `start.sh`. Only regions that
  already have an export are re-exported.
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
- A **Photon row in the map sources** (Settings) shows where the setting comes from, can
  set or clear it for the current tab, checks the server answers, and explains how to
  set the default.
- `web/src/fork/modules/search/photon.ts` queries `<url>/api` on every search; tested against
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

**Map sources** (`web/src/fork/modules/map-sources/`; first a button under the key, now in
**Settings** in the header): shows the
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
- **Map:** `web/src/fork/modules/sites/style.ts`: an icon per kind (a Maki glyph, CC0, in a
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

The code (refactor step 17): `scripts/extra_data.py` is the command line;
`scripts/extradata/` has `base.py` (what every source shares and the `Source`
class), `france.py` (`FrenchSource`), one file per source (`agence_ore.py`,
`georisques_icpe.py`), `cli.py`, and `SOURCES` in `__init__.py`. Adding a source is
a new file and a line in `SOURCES`.

- **Stored apart, drawn alike.** The data goes into its own schema, `extra`
  (`schema/extra.sql`), and is served as its own Tegola map (`/maps/extra`: lines from
  zoom 10, BT lines and substations from zoom 13), switched on in the layer switcher
  under "Not from OpenStreetMap" (code `X`, off by default). Tegola gives each feature
  a nominal voltage (HTA 20 kV, BT 0.4 kV: French HTA is legally 1-50 kV but 20 kV
  almost everywhere) so `fork/modules/extra/style.ts` draws it with the OSM power expressions:
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
  (`fork/ui/key/feature-hider.ts`), so hiding the grid (switcher or key) leaves the
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
  turned into `web/src/fork/modules/userlayers/model/symbols-2525c.json` by
  `scripts/make_symbol_catalog.py`. ODIN's Austrian SKKM signs (41) aren't there:
  their list is ODIN's (AGPL). The library is 3 MB, loaded only when the palette
  opens or a layer has symbols (and precached for offline use).
- **Tactical graphics** (version 2): the 413 of MIL-STD-2525C, as in ODIN. Point
  ones (checkpoints, task points...) are drawn by signs like other symbols. Lines,
  areas and arrows (axis of advance, phase line, assembly area, block, breach,
  obstacle lines... 212 drawable) are drawn by the US Army C5ISR renderer
  `@armyc2.c5isr.renderer/mil-sym-ts-web` (Apache-2.0, 7.4 MB / 1.4 MB gzipped,
  loaded on first use, precached) from the points the user clicks
  (`fork/modules/userlayers/graphics/graphics.ts`). It draws 2525D/E, so the stored 2525C code is
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
  side panel, like a map feature's (`fork/modules/userlayers/ui/editor.ts`), with the fields
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
  take don't open upstream's popups: `fork/modules/userlayers/index.ts` wraps the click
  router's `handleClick` on the instance, so `click-router.ts` stays upstream's.
- **Storage:** the `userdata` schema (`web-backend/src/fork/userdata/userdata.sql`), made by
  the backend on first use. The layers belong to the computer, not to a region:
  `build-region.sh` and `import-db.sh` save them (`data/userdata/userdata.dump`)
  before wiping the database and put them back afterwards (so local ones replace
  any in an imported export); `export-db.sh` includes them.
- **Backend:** `web-backend/src/fork/userdata/` (refactor step 13: `schema.py`,
  `changes.py` applying and logging changes, `layers.py`, `situations.py`, `images.py`,
  and `users.py`, whose `current_user()` is the one place login and access control
  will go; copying a map feature's geometry is `src/fork/map_data.py`) (`GET /userdata`, `POST
  /userdata/save`, `GET /userdata/history`, `POST`/`GET /userdata/images`, `GET
  /userdata/source-feature`). The frontend calls it through the dev server's proxy
  (`/userdata` in `vite.config.ts`): upstream's CORS settings only allow GET from
  another origin.
- **Not yet:** several people editing at once (the last save wins); adding or
  removing points of an existing line (they can be moved); ODIN's SKKM signs.

### Version 3: one workspace (docs/plans/my-layers-v3.md)

The v2 panel followed ODIN closely (tabs, a long form of the standard's fields) and
was hard to read. Version 3, built in steps:

- **Step 1, layout** (`panel.ts`, since split into `userlayers/ui/`: `workspace.ts`,
  `toolbar.ts`, `sidebar.ts`, `inspector.ts`, `situations.ts`, `timeline.ts`,
  `toast.ts`): My layers is a workspace turned on by its button.
  Its sidebar sits in the left column between the search box and the details panel
  (which becomes the shared inspector: my items and map features alike); the left
  column is one flex stack that fits the map's height. The grid connection folds to
  a one-line summary when details open (`GridRouteControl.fold`). A toolbar at the
  top of the map holds the tools (keys V S A L R M P C), the "Into" layer, undo /
  redo, history and Save; the symbol picker opens under it as a wide grid.
  **Undo / redo** (`Store.undo` / `redo`, Ctrl+Z / Ctrl+Shift+Z): unsaved changes
  are rebuilt from the saved layers plus the pending changes; changes made by one
  action (moving an item between layers) share a `batch` and are undone together.
  Undo goes on past a Save (in this tab, up to 200 steps): `save()` keeps, for each
  step sent, what it touched before and after it (`applyStep`, `SavedStep`); undoing
  one records new pending changes that put back only the fields that step changed
  (`restoring`, `revertFields`: the position, a name, a modifier...), on top of the
  item as it is now, so what others changed since stays and the server's log is
  never rewritten. Redo drops those changes again; Discard puts the steps back.
  Folders (refactor step 12): `model/` (what items are: `model.ts`, `sidc.ts`,
  `fields.ts`, `labels.ts`, the symbol catalogue), `state/`, `map/` (drawing and
  working on the map: `render.ts`, `graphics.ts`, `symbols.ts`, `tools.ts`,
  `interactions.ts`), `ui/` (the workspace's components, `editor.ts`, `outliner.ts`,
  `palette.ts`). The state is in `userlayers/state/` (refactor step 9; the history
  playback is `state/playback.ts`): `store.ts` (the `Store`
  the UI uses), `changes.ts` (pure: applying changes, steps, `revertFields`,
  `restoring`, `differences`), `undo.ts` (`UndoHistory`), `local.ts` (what's kept in
  the browser), `transport.ts` (load and Save; where live sync will plug in),
  `view.ts` (`store.view`: live, a situation or a history step; `canEdit(layer)` is
  the one answer to "may this be changed now?", used by the tools, the list, the
  card and the right-click menu).
- **Step 2, the item card** (`editor.ts`, card helpers in `fields.ts`): header with
  the large symbol and the designation edited in place; identity as the item's own
  symbol in each identity, Present / Planned and condition as chips, the echelon as
  its marks, HQ / task force / dummy toggles; the details for its kind shown even
  empty (`DEFAULT_FIELDS`: units T M W, equipment T V C W, graphics T W W1...) plus
  any it has, with values in words (`displayValue`: dates with "2 h ago", ratings
  spelled out, compass points); "+ Add detail" lists the rest by question (who,
  what, when, where, how sure); notes always shown; Duplicate.
- **Step 3, the outliner** (`outliner.ts`, `labels.ts`): folders (one level,
  `style.folder` on each layer, folded state per browser; both per account since
  sync phase 5) with an eye and a lock
  for all their layers; layers with eye, lock (`style.locked`: no drags, deletes or
  edits, the card read-only, nothing new drawn into it), colour, item count, ⋯
  (draw into, rename, move to folder, delete); items with their symbol and a status
  line ("Infantry · Hostile · planned · 2 h ago"). A search box (every word, in
  names, types, details, notes) and filter chips (hostile, friend, planned, units,
  graphics, pictures). Drag an item onto a layer to move it, a layer onto a folder
  to put it in.
- **Step 4, the picker** (`palette.ts`): categories in plain words instead of the
  standard's sections (`CATEGORIES`): symbols in Units, Equipment and vehicles,
  Installations, Incidents and emergencies, Points on the map, Air, Sea, Space,
  Intelligence, Civil and stability; graphics in Arrows, Tasks, Lines, Areas,
  Shapes, Obstacles, Fire support, Logistics (a test checks every entry is in at
  least one). Any symbol can be starred: Favourites come first when the picker
  opens, then Recently used.
- **Step 5, on the map** (`interactions.ts`): hovering an item shows its name, type
  and status; right-click opens a menu (identity, present / planned, rename,
  duplicate, copy, move to layer, delete; greyed out in a locked layer);
  double-click puts the cursor in its name on the card (no zoom); Ctrl+C copies
  the selected item and Ctrl+V pastes it where the pointer is, into the "Into"
  layer.
- **Situations** (`situations.ts`, `userdata.situation`, `GET/POST
  /userdata/situations`, `DELETE /userdata/situations/{id}`): a named moment is just
  a name and the last saved change it includes; viewing it replays the history up
  to there (read-only: tools off, the list greyed out, a banner on the map with
  "Back to live"). Nothing is copied, so situations cost nothing to keep. In the
  sidebar it's one line: `Situation: Live ▾` with the saved ones, "Save now as a
  situation…" (offers to save unsaved changes first) and delete. The backend now
  adds missing userdata tables to older databases (it checks for the newest one).
- **Several items at once:** Shift-click on the map or in the list adds an item to
  the selection (`Tools.toggle` / `selection()`; the map's Shift-drag zoom is off
  while My layers is open so the click gets through). The details panel then shows
  one card for all of them: their names, identity and present / planned for all,
  move to a layer, delete all. Each of those is one undo step (`Store.updateFeatures`
  / `moveFeatures` / `deleteFeatures` share a `batch`).
- **Fix found while testing:** saving several changes at once redrew the layers
  before all their symbols' images were loaded (the first redraw resumed after the
  others had changed the layers); the renderer now waits until no image is missing.
- **The unsaved count** ("Save (n)") is what Save would really change: layers and
  items that differ from the saved state (`Store.unsavedCount`), so changes that
  cancel out (lock then unlock) count for nothing; they stay in the list for undo,
  and Save with nothing really changed just clears them.
- **Not done:** situations as marks on the history bar; selecting by dragging a box.

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
- **Map** (`web/src/fork/modules/grid/`): "Route from here" / "Route to here" buttons in
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
- **Details in a side panel** (`web/src/fork/ui/details.ts`, `modules/details/`): clicking a feature shows its
  details in a panel on the left, under the search box and above the Grid
  connection panel, instead of a popup over the map (which hid what you clicked).
  Both panels have minimise (keeps the highlight / routes on the map, shrinks to the
  title) and close (removes them). Clicking another feature replaces the details;
  clicking the same one again (its icon or its area) deselects it; Escape closes
  them. Picking a **search result** works like clicking it: after the map flies
  there, a substation or power plant opens its full details and highlight; places,
  coordinates and addresses get a short panel and a ring at the location. (The Osmose validation popups are unchanged.)
- **Highlight of the selected feature** (`web/src/fork/modules/grid/highlight.ts`): areas
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
- **Where a line goes** (`web/src/fork/modules/grid/highlight.ts`,
  `GET /grid/line/<osm_id>`): clicking a power line highlights the whole connection
  it belongs to while its details are shown, not just the clicked piece (OpenStreetMap
  splits lines into many pieces). The backend follows stretches of the same voltage
  through junctions and branch points, stopping at stations; the panel says
  "Connects Heisdorf – Roost · 13.3 km" and has a "Show whole line" link that zooms
  to it. Lines without a known voltage (not in the network) highlight just
  themselves.
- **Every circuit named** (`web-backend/src/fork/circuits.py`, asked 2026-10-31): most
  circuits (route=power relations) have no name in OpenStreetMap (7 of 10 at
  Sierentz), shown as "-" in a substation's circuits. The fork's routes replace
  upstream's `/api/substation`, `/api/circuit` and `/api/line` (same answers) and fill
  in the name: the one its lines carry that names the substations it joins, for its
  circuit number (from RTE's code, `MUHLBL71SIERE` = n°1); else "Muhlbach – Sierentz"
  from its substations; else the code. A missing voltage comes from its lines.
- **Selected circuit** (`web/src/fork/modules/details/circuit.ts`): "view" on one of
  a substation's circuits opens upstream's circuit panel in the left column below the
  substation's details, which stay open (they used to close, and the panel sat at the
  bottom right). When both don't fit, the details shrink and scroll. Upstream's
  `CircuitInspector` is wrapped, not changed.
- **Voltages meet only at stations** (`grid.py` `build_graph`): in the route graph a
  pylon joins only lines of the same voltage, and a way carrying several
  ("225000;63000") is one line per voltage; voltages meet at substations and plants
  (their transformers). Before, a route could jump from a 400 kV line to a 225 kV one
  at a pylon (Logelbach → Guebwiller had a 79.9 km route that way). A junction is
  `(node id, voltage)` in the graph, a station its node id.
- **Following a line** (`web-backend/src/fork/line_trace.py`): the network is kept in
  the backend's memory (loaded on the first click, ~4 s for France, and again after a
  rebuild). A line is followed along its own way; then into a way of the same name
  (compared by the places it joins and its circuit number: "n°1", "N0 1"; "Ligne à",
  remarks in brackets left out). Where its way ends and several start: the one into a
  station named in the line's name (Guebwiller - Logelbach turns into Logelbach at
  the pylon where Anould - Logelbach goes straight on); else the straightest, never
  one turning back alongside it (the other circuit going back); if they all lead to
  one station, the straightest of them. Each line goes to one place: two ways leaving
  side by side with nothing to tell them apart get the straightest, as a guess (an
  earlier version followed both circuits; wrong, a line is one of them). A line
  ending beside another one passing through is a tap (connected). A way clicked
  without a name takes the name of the line it goes on into, and is followed again
  knowing it. Only where none of that tells is the first stretch of each way shown,
  not followed. A way with several voltages ("225000;63000") belongs to each, and only
  the clicked line's circuit is highlighted (drawn side by side). Ways are drawn
  whole, into the substations.
- **Tower numbers** (`web-backend/src/fork/tower_numbers.py`, after `schema/grid.sql`):
  every line of the network is followed (`line_trace.py`) and its towers are numbered
  by how far along it they are, from the station its name starts with (else another
  of its places, else a substation first by name). A line followed twice (from ways
  side by side near a substation) is kept once. A tower carrying several lines has a
  number on each; its details say "Tower 23 of 61 on A – B (225 kV), counted from A"
  (`GET /grid/tower/<id>`, `modules/grid/towers.ts`); a tower without a ref shows the
  number of its highest-voltage line as its label from zoom 16 (the `tower_number`
  tile layer); the search finds "23 marlenheim", "pylône 23 reichstett". The tables
  (`tower_line`, `tower_line_edge`, `tower_number`) are made empty by
  `schema/tower-numbers.sql` (Tegola serves `tower_number`) and filled with the
  backend's image (`number_towers` in `scripts/lib/db.sh`): about 30 s for France,
  1.47 million towers. `bash scripts/number-towers.sh` numbers them again, e.g. after
  the line rules change. Imports of older exports number them.
- **Short tower labels** (asked 2026-10-31): some towers have a whole sentence in
  their `ref` ("Ligne à 63 kv Lutterbach Masevaux - Pylône N°44"), which upstream
  wrote under the icon. Towers and poles are now labelled (from zoom 15) by the
  `tower_number` layer only: their ref cut down to its number (`tower_short_ref` in
  `schema/tower-numbers.sql`: "44"; a short ref as it is), else their number along
  the line; towers with a ref on no line of the network are labelled too.
  Upstream's tower and pole labels are hidden (`hideUpstreamTowerLabels`).
- **Tower numbers that last** (asked 2026-10-31): a register in the `userdata` schema
  (`tower_line_ref`, `tower_ref`) keeps every number given, so it survives rebuilds
  and goes with exports. At each numbering, a line is matched to the register's
  line it shares most towers with (30% at least, same voltage), and counted the way
  it was. A tower already numbered keeps its number; one added between two gets the
  one before's number and a letter ("23a", "23b"; before the first: "0a"); past the
  end, the next numbers; a number is never given again. "Of 61" is how many towers
  the line has now. Numbering runs after My layers' data is put back (build and
  import), and the rebuild keeps that data when the register has towers. Two
  numberings of France in a row: 0 of 1,472,964 changed.
- **Checking the grid** (`web-backend/src/fork/grid_check.py`, `uv run python -m
  src.fork.grid_check` in `web-backend/`): follows every line of 63 kV and more and
  writes each end that isn't at a station to `data/grid-check.csv`, likely data errors
  first: "not joined to a station / line N m away", "open end", "other line" (its way
  ends where only other lines go on), "unclear split", "guessed split", "leaves the
  region". On France: 169 not joined, 72 open ends, 50 other line, 59 unclear
  splits, 222 guessed, 100 leaving.
- **Limits:** paths are physical connections in OpenStreetMap, not how power flows;
  a missing line or substation in OpenStreetMap can hide a connection; both ends
  must be in the built region (France–Germany needs Europe or a custom region);
  importing an export made before this builds the network (`import-db.sh`). Tested on
  France (network built in under 2 minutes); not yet on a continent.
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

## Statuses of map features (docs/plans/feature-status.md, step 1)

- **What:** any map feature the details panel shows with an id (power lines,
  substations, towers, plants, transformers, pipelines, masts, critical sites, extra
  data...) can be marked Operational, Repaired, Threatened, Suspected damage,
  Damaged, Destroyed, Under repair or Unknown, with how it's known (seen, reported,
  imagery), a note and who set it. Shared by everyone; separate from My layers.
- **Setting it:** a "Status" section in the feature's details
  (`web/src/fork/modules/status/details.ts`): the status, who set it and when, its
  note, "Set status" / "Change status" (a form), and the history (newest first).
  The name typed is remembered with My layers' (`core/author.ts`).
- **Colours:** threatened yellow, suspected damage purple (as power supply mode's
  "at risk"; orange there means less power), damaged red, destroyed black, under
  repair blue.
- **On the map** (look C): only the problems (threatened, suspected damage, damaged,
  destroyed, under repair), as a coloured casing along both sides of a line, an
  outline round an area, a ring round a point, and from zoom 12 a badge with the
  status's sign (⚠ ? ! ✕ 🔧, drawn by the browser) (`modules/status/map.ts`). The
  layers start with `status_` (the layer switcher's "Damage and threats", K) and
  aren't clickable: a click goes to the feature underneath. The key lists them.
- **Stored** in the `userdata` schema (`userdata.sql`): `feature_status` (the current
  status; the feature is its table and id, as several tile layers show the same
  table, with a copy of its geometry so it's drawn whatever the tiles) and
  `status_change` (every change: the history). So statuses are kept across rebuilds
  and imports like My layers (`user_data_saves` counts their changes too).
- **Backend** (`web-backend/src/fork/userdata/status.py`): `GET /userdata/status`
  (the problems, GeoJSON with a badge point), `GET /userdata/status/feature?layer=&id=`,
  `POST /userdata/status`. Who may set statuses: `can_set_statuses()` in `users.py`
  (everyone until there are accounts).

- **Not on small parts** (asked 2026-10-31): switches, disconnectors, compensators,
  gantries, street cabinets, poles, busbars and bays get no Status section (and are
  left out of "Set status for all"): a status there says nothing useful, and power
  supply mode doesn't use them (`NO_STATUS`, `can_have_status` in `status.py`;
  `canHaveStatus` in `modules/status/fields.ts`). Transformers keep it (step 5).

### Step 2: extra fields, several at once, convenience stores

- **Extra fields by kind** (`modules/status/fields.ts`, checked by `clean_details` in
  `status.py`, kept in `details`): stock (Full, Half, Low, Empty, Unknown) and what's
  short for supermarkets, convenience stores, wholesale, distribution centres, silos
  and fuel depots; capacity (Normal, Saturated, Closed) for hospitals and clinics;
  fuel available (Yes, No, Rationed) for fuel stations and depots. Shown under the
  status ("Stock: Low · What is short: water") and in the history.
- **Several at once** (`services/selection.ts`, `modules/status/selection.ts`): Shift-click
  adds a feature to a selection (or takes it out) instead of showing its details. The
  picked features are outlined in purple (their whole shape) and listed in a panel
  in the left column; "Set status for all" sets them together, each getting only the
  extra fields of its kind. MapLibre's Shift-drag box zoom is off for good (it
  swallowed Shift-clicks; My layers had already turned it off while open).
- **Convenience stores** (`shop=convenience`) are critical sites now (food supply,
  from zoom 14, Maki's convenience icon): `imposm/sites.py`, `schema/sites.sql`,
  `scripts/make_site_icons.py`. They appear at the next rebuild of the region.

### Step 3: the Status board, playback, search by status

- **The Status board** (`modules/status/board.ts`): a ⚠ button with the others on the
  right opens it in the dock. Every feature with a status (`GET
  /userdata/status?all=1`), newest first, with counts per status (click one to show
  only those, more than one at a time), a filter by kind (power, critical sites,
  telecoms, pipelines, water, open data) and by name. A row shows the status, who set
  it and when, the extra fields and the note; clicking it zooms there and highlights
  the feature.
- **Playback** (`playback.ts`, `GET /userdata/status/history`): a timeline over every
  status change, with first, back, play, forward and Now. At an earlier step the map
  (`StatusMap.showPast`) and the board show the statuses as they were then (the
  timeline turns yellow); closing the board goes back to now. My layers' history is
  separate.
- **Search by status** (`search.py` `search_statuses`): typing a status ("damaged",
  "under rep", 4 letters at least) finds the features that have it; the result says
  "Status: Damaged" and switches the statuses layer on.

### Step 4: power supply mode

- **Turned on** with the switch at the top of the Status board ("Power supply mode"). A banner at the bottom sums it up ("Without supply: 2 ×
  400 kV, 2 × 63 kV substations or plants; 1 with less power") with the legend and
  "Turn off".
- **Worked out** by `web-backend/src/fork/grid_supply.py` (`GET /grid/supply`) on the
  grid network held in memory, voltages meeting only at stations (as routes):
  - sources: plants of 10 MW and more (or the substation they're in), and line ends
    at the edge of the region (power comes from outside);
  - lost: power lines, substations, plants and towers Destroyed or Damaged (a tower
    cuts the lines it carries);
  - for every point, the best path's lowest voltage from a source (widest path), with
    nothing lost (kept) and now: **red** if no source reaches it any more, **orange**
    if only through lower voltages than before (a 225 kV substation fed through 63 kV
    lines), **purple** ("at risk") if it would be red or orange were what has
    Suspected damage lost too, **green** otherwise. (A first version had a
    "Pessimistic" switch counting suspected damage as lost; replaced by the purple.) About 0.5 s for France (6 s the first time).
  - **grey**: what no source reaches even with nothing lost, missing in OpenStreetMap
    (about 99,000 ways and 15,000 stations in France, mostly 20 kV):
    `GET /grid/supply/unconnected?grid=<build>`, made once per grid build, served
    gzipped (0.5 MB). Its address names the grid build (`grid` in `/grid/supply`'s
    answer): a first version had a fixed address cached for an hour, and browsers
    that had its old answer (shapes) failed to colour anything (all green).
  - Both send ids only (per way and circuit, in the tiles' order: `{"s1": "red"}`),
    no shapes.
- **On the map** (`modules/status/supply.ts`): nothing is drawn over the map.
  Upstream's power line, substation and plant layers are recoloured while the mode is
  on (their paint put back when it's off), by the feature state the backend's ids get:
  each circuit of a way carrying several (power_line_1/2/3) its own colour, so double
  lines stay double; lines below 10 kV (not in the network) grey. A first version
  drew a green copy of every line plus the grey lines as a 14 MB GeoJSON over the
  map: slow, and the double lines showed through. A way gets one colour along its
  whole length (a tower down turns all of it red, not only from the break).
- **Copies in My layers** of power lines, substations and plants take their original's
  colour while the mode is on (`services/supply.ts`, read by My layers' renderer), and their
  own look when it's off.
- **Inside a substation** without supply (or with less), every power line within its
  outline (bays, connections, often not in the network) takes its colour.
- Not yet: scenarios ("what if these were lost?" without setting statuses), and the
  detailed substation model (step 5: levels and transformers).

## Login for the whole app (docs/plans/sync.md, phase 1)

- **Accounts** (`web-backend/src/fork/auth/`, tables `userdata.app_user` and
  `userdata.user_session`): local only, made by admins; the first one at setup (the
  login page offers it while there's no account). Rights: admin, can set statuses.
  Passwords hashed with scrypt; sessions are a random token in an HttpOnly cookie
  (`oim_session`), stored hashed, 30 days from the last visit.
- **Every call needs a session:** `LoginMiddleware` (added in `main.py` after the
  database middleware, one line) answers 401 to anything but `/login` and `/auth/*`.
  `current_user()` (`userdata/users.py`) is the logged-in user; statuses use its
  rights (`can_set_statuses`) and name.
- **The gate** (`gate/nginx.conf`, Compose `gate`, on the host's network, port 8800):
  the only way in from the network. It checks the session with the backend
  (`auth_request` → `/auth/check`) on every request and passes it to the frontend dev
  server, Tegola (`/tegola/`), the background map (`/basemap/`) or the backend; a page
  without a session goes to `/login?next=…` (the map's place after `#` is kept). The
  database, Tegola, the backend and the background map server listen on 127.0.0.1
  only (checked: from the network address only 8800 answers).
- **Frontend:** `throughGate()` (`fork/config.ts`) sends the local services of
  `web/.env` (localhost:7800, 8001, 8090) through the gate, at the page's address. The
  `account` module shows "log out (name)" in the header, Settings → Accounts for
  admins (add, rights, new password, disable), and goes back to the login page when
  an answer from the site says the session has ended (401).
- **Scripts:** `start.sh` / `launch.sh` start the gate and open https://localhost:8800.
- **HTTPS** (asked 2026-11-01): the gate has its own image (`gate/Dockerfile`: nginx and
  openssl) and makes a self-signed certificate on first start (`gate/10-certificate.sh`,
  10 years, for localhost, this computer's name and addresses; kept in `data/gate/`).
  Plain http on 8800 is sent to https; the session cookie is `Secure` (the gate
  passes `X-Forwarded-Proto`; in nginx, a location setting a header of its own loses
  the server's, so they're repeated). The gate passes the host with its port
  (`$http_host`) and the backend trusts its `X-Forwarded-Proto` (uvicorn
  `--proxy-headers` in `docker-compose.override.yml`), so the backend's redirects
  (a power plant's page) stay on https://…:8800 (2026-11-03: they went to
  http://localhost). Browsers warn once (nobody vouches for the
  certificate); installing `data/gate/cert.pem` avoids it. The gate's image is saved
  with the others for offline use.
- **What can't be changed is locked** in Settings → Accounts (greyed out, the reason as
  its tooltip) rather than refused after: your own admin right and Disabled, and
  Disabled for another admin (take away the admin right first; the backend refuses
  it too).

## Owners and sharing for My layers (docs/plans/sync.md, phase 2)

- **Rules** (`web-backend/src/fork/userdata/access.py`, one place): a layer belongs to
  who made it (`layer.owner_id`); its owner shares it per account to **view** or
  **modify** (`userdata.layer_access`). The owner may do everything; modify: its
  items, name, colour, folder; view: see it, read-only. Only the owner locks or
  unlocks it, deletes it, shares it. Moving an item needs modify on both layers.
  Admins see nothing more of other people's layers.
- **Layers from before accounts** (no owner) stay open to everyone (modify); admins act
  as their owner. The first time an admin shares one, they become its owner and every
  other account gets modify access, so nothing changes until it's changed on purpose.
- **Checked on the server:** `/userdata` sends only the layers you can see, with your
  access and their owner; Save (`changes.py`) refuses a change to a layer you may not
  change (403, nothing saved); the history leaves out layers you can't see; a
  situation records its layers (those shown on the map when it's made) and is seen
  only by who can see them all. Saves record the account (`save.user_id`, its name as
  author).
- **Frontend:** a layer shared to view is read-only (`view.canEdit`); the lock and
  Delete are its owner's; a shared layer shows 👥 (can change) or 👁 (view only) with
  whose it is; **"Share…"** in the layer's menu (owner) opens the sharing dialog
  (`ui/sharing.ts`, `GET/PUT /userdata/layers/{id}/access`), saved at once.
- Tested end to end with two accounts: not shared → not seen; view → seen, changes
  refused; modify → items changed, lock/delete/share refused; access taken back → the
  layer, its history and the situation gone for them.

## Versions, merging and conflicts in My layers (docs/plans/sync.md, phase 3)

- **Versions** (`userdata.sql`): every layer and item has a `version`, raised by each
  saved change, and `updated_by` (who saved it last). `/userdata` sends them.
- **Save checks them** (`changes.py` `stale`, `layers.py` `save`): the browser sends,
  with its changes, the version each changed item started from (`bases`); if any
  moved on since (someone else saved it), nothing is saved: 409 with those items.
- **The browser keeps a base** for everything it changes: how it was saved, and its
  version, when the first change to it was made (`state/store.ts`, kept with the
  unsaved changes in the browser, `local.ts`).
- **Merging** (`state/merge.ts`, pure): field by field, as the plan's table: the
  position, the layer, each property, each detail (modifier), each part of the
  symbol code (identity, status, echelon...); a layer's name and each style key.
  Deleted on one side and changed on the other is a conflict.
- **Bringing your changes up to date** (`state/reconcile.ts`, pure): when Save is
  refused, and when the page loads with unsaved changes kept in the browser, your
  changes are merged with the server's layers: rewritten on top of them, new bases,
  and the conflicts left. Your undo history starts again then.
- **The conflict window** (`ui/conflicts.ts`): one conflict at a time ("Conflict 2 of
  5"), what and in which layer, who changed it and when, the differing fields yours
  and theirs side by side, **Keep mine** / **Take theirs**, ◀ ▶, **Keep all mine** /
  **Take all theirs**; "–" folds it to a bar ("⚠ 3 conflict(s): resolve"). Until
  resolved, the map shows your version with an orange dashed ring (the list a ⚠), and
  **Save is disabled** ("Resolve the 3 conflict(s) first"). Keep mine: your version
  is saved with the next Save, against the server's new version.
- Tested end to end: A's unsaved rename (to "Charlie") on an item B renamed meanwhile
  ("Bravo"): A's Save with the old version is refused (409); A's page shows the
  conflict; Keep mine, Save: the server has "Charlie", version 3.

## Live updates (docs/plans/sync.md, phase 4)

- **The backend pushes** (`web-backend/src/fork/userdata/events.py`, `GET
  /userdata/events`, Server-Sent Events): each open page keeps a connection; every 2
  seconds it looks for new saved changes on layers that user can see ("changes": how
  many, which layers, by whom), a change in what they can see ("access": a layer
  shared with them or not any more), a status changed ("status"). A comment every 25
  s keeps it open through proxies. The event id is the last change: the browser
  reconnects by itself after a break and is told what it missed.
- **No database connection held:** the stream takes one for each look; `main.py`'s
  database middleware skips it (`streaming_paths`, a one-line hook), and the login
  middleware then opens one just to check the session.
- **The page** (`fork/services/live.ts`, one connection, `onLive(kind, listener)`): My layers
  fetches the layers again (`store.refresh`): shown as they are if you have nothing
  unsaved, merged with your changes otherwise (phase 3; conflicts not yet resolved
  stay); a Save under way first. The statuses (map, supply, board) refresh too.
- Tested: A's page open, B saves a layer and shares it with A, sets a status: A's list
  shows the layer 2 s later, its statuses refresh, no reload.

## Per-user settings (docs/plans/sync.md, phase 5)

- **The backend** (`web-backend/src/fork/userdata/settings.py`, `GET/PUT
  /userdata/settings/{key}`): one JSON value per account and key (at most 200 KB),
  in `userdata.user_setting` (`userdata.sql`'s last statement: `schema.py` checks
  for it to know the schema is up to date). Without an account (`ANYONE`): 403.
- **My layers** (`web/src/fork/modules/userlayers/state/personal.ts`, key
  "userlayers"): each layer's folder, the layers hidden, the layers open and the
  folders folded in the list, the folders still empty, the layer you draw into
  (`store.activeLayer`: yours if it's still there, else the first), favourite and
  recently used symbols (the picker, `ui/palette.ts`). Kept in this browser too
  (shown at once, used when the server can't be reached), sent half a second after
  a change. What the account doesn't have yet is taken from what the browser kept
  before (`oim-userlayers-hidden`, `-folded`, `-empty-folders`, `-favourites`,
  `-recent`) and sent.
- **Folders aren't changes any more:** moving a layer to a folder isn't recorded,
  saved or undone, and works on layers shared with you to view only. A layer's
  `style.folder` (set before) is only the fallback when you haven't chosen.
- Tested: a layer whose shared folder is "Shared" shows in the account's "Mine";
  moved to a new folder from its menu, the server has it and nothing is unsaved.

## Measuring and grid references (SPECIFICATIONS 10.2)

**Grid references** (`web/src/fork/modules/coordinates/`):
- **Where the cursor is** (`readout.ts`), bottom left, to the right of the scale, in
  a fixed place just past the scale bar's widest (it grows and shrinks with the
  zoom; `coordinates.css`): latitude, longitude and the military grid reference (MGRS,
  to the metre; the `mgrs` package from proj4js, MIT, bundled: works offline;
  formatting in `fork/core/mgrs.ts`). Off the map: its centre. **G** copies the grid reference under the cursor (the
  pointer stays where it is; not while typing in a field), which the readout's tooltip says
  ("G: copy grid at pointer", the page's tooltip: `ui/tooltip.ts`); clicking it does
  nothing.
- **Search** (`mgrs.ts`, `MgrsSearch`): a grid reference typed in any usual way
  ("32TLT7257789913", "32T LT 725 899") goes to the centre of the square it names.
  Search providers come from the modules (`searchProviders` hook,
  `forkSearchProviders` in `search/search.ts`, which used to name Photon).

**Measuring is a My layers tool** (2026-11-02; it was a panel of its own before):
a measurement is an item of the kind `measure` (`userlayers/kinds/measure.ts`),
so it's saved, shared, in the history, undone, exported and printed like the
others, and its points are moved like a drawing's.
- **The tools**, in My layers' toolbar after the drawing ones: 📏 distance (D),
  ⬠ area (E), ◎ range rings (O). Distance and area are the line and area tools
  making a measurement (`Tool.properties`): while drawing, the lengths and bearings
  so far follow the cursor (`Renderer.measureDraft`; marks only once it's done).
  Click points; double-click or Enter finishes; Backspace takes back a point;
  right-click drops what's drawn so far (again: stops; any drawing tool); Esc stops.
  Points can be moved afterwards, not added or removed.
- **What it shows** (`userlayers/measure/features.ts`, pure): each leg's length and
  bearing in degrees and NATO mils, written along the leg and above it; the total
  beyond the end; an area and its perimeter; rings and their radii, outside each
  ring (only rings at least 25 px across on screen; the bigger ring's label wins;
  when the largest is under 60 px, one label above it with its diameter, "Ø 20 km":
  the map's font has no ⌀). A leg too short on screen for its whole label shows only its length. Where
  labels would overlap, the total stays, then the legs, then the marks
  (`symbol-sort-key`). Lines follow great circles (`greatCirclePath`, a point every
  2 km so the straight pieces on the flat map stay within a metre of it).
- **Marks along distances** (`measure/ticks.ts`, pure), like a ruler: a mark at the
  start, a labelled mark every `major` with one plain mark halfway, on full values
  (majors 1 or 2 × 10ⁿ; a 5 × 10ⁿ step has no halfway mark), labels about 80 px
  apart, never under 10 m. Labels: "18 km" when the step is a kilometre or more,
  else "18 km 450 m"; under the line, along it. None when fewer than four labelled
  steps fit along the whole measurement (zoomed out: one or two lone marks say little). Placed on the line as drawn (in Web Mercator,
  where screen directions are true) and square to it; only those in view are made,
  again as the map moves. Drawn in the measurement's line and label layers.
- **Legs on the card** (`ItemKind.card`, a new hook, which can also change the
  shape): each leg's length, typed over ("18 km 450 m", "2.5 km", "800"): its end
  moves along the same bearing and the legs after keep their length and bearing
  (`withLegLength`); an area's closing leg follows from the others.
- **No areas that cross themselves** (`model/shapes.ts`, any area, drawn or
  measured; a click on the first point closes an area, and a last point finished on
  it is dropped; a new point at least 12 px from the others, dragging one closer is
  fine): a point that would make the outline cross isn't added, closing one
  that would is refused (add a point, or take one back), a point dragged stops
  where it would cross, a leg length that would is refused.
- **Testing note:** the headless browser used for checks only draws a new frame when
  something asks for one, so labels fading in and freshly updated sources can be
  missing from screenshots; force repaints (`map.triggerRepaint()`) before taking one.
- **Range rings' distances** are on the item's card (`ItemKind.card`, a new hook);
  new rings get the last ones set.
- **Which north** (`measure/north.ts`), in My layers' settings ("Measured bearings
  from"), kept per account (`personal.ts` `north`, `radii`; `measure/prefs.ts`):
  true north (°T), magnetic north (°M: the declination at the leg's start from the
  World Magnetic Model 2025, `magvar` package, MIT, offline, valid to 2030) or grid
  north (°G: UTM/MGRS grid convergence).
- **Locking one item** (any kind): 🔒 Lock on its card. A locked item can't be
  changed, moved or deleted until unlocked (`View.canEditItem`, used by dragging,
  deleting, moving to another layer, the card and the right-click menu); 🔒 in the list.
- Exports keep a measurement's type, ring distances and lock.
- Not done: the MGRS grid drawn on the map, polar areas (UPS), adding or removing a
  point of a placed measurement (its points are moved, as a drawing's).

## Import, export and printing (SPECIFICATIONS 10.7)

- **My layers to and from files** (`userlayers/io/formats.ts`, pure; `io/files.ts`):
  GeoJSON, KML (a folder per layer, colours) and GPX (points as waypoints, lines and
  area outlines as tracks: GPX has no areas, symbols or colours). Exported items keep
  what they are (kind, symbol code, details, notes) in their properties or KML's
  ExtendedData (`oim:...`), so they come back as they were. Files from elsewhere
  (`@tmcw/togeojson` reads KML and GPX): points become markers, the rest drawings,
  with their name, colour if any, other fields in the notes; multi-geometries are
  taken apart, heights dropped. **Import a file…** under the list makes a new layer
  (`Store.importLayer`: one change, undone at once, shown once); **Export…** saves the
  layers shown (a situation's while one is shown); each layer's ⋯ → Export as.
- **Print** (`fork/modules/print/`, "print" in the header; `pdf.ts` puts the page
  together from `parts.ts` (header, map and north, legend, footer), `layout.ts`
  (sizes, scale, pure) and `images.ts` (the map's picture, symbols as PNG)): title, A4 or A3,
  landscape or portrait, legend or not. jsPDF, loaded only when used. The map as on
  screen, drawn again at twice the resolution (`setPixelRatio`), north as the map is
  turned, the scale (1:N) and a bar, the centre's position and MGRS, the map's credits,
  the date and who printed it. The legend (`fork/services/legend.ts`, `addLegend`): the map
  layers on (print), the layers shown and the symbols in view (My layers), the power
  supply colours while the mode is on (status). Long legends end with "…and N more".
- `fork/ui/panel.ts` `makeModal`: the window Settings used, shared with Print (Print's is a floating panel since 2026-11-05).
- MGRS formatting moved to `fork/core/mgrs.ts` (used by measure and print).
- Tested: a GeoJSON file with a symbol, a point and a line imported, exported as KML,
  printed: the PDF has the map, the legend (map layers, the layer, "Infantry"), 1:20 000.

## Position area for artillery, drawn point by point (2026-11-06)

2525C has the PAA only as a rectangle or a circle (both need a width or radius the
tool doesn't ask for, so the rectangle was removed with the others); 2525D and E have
it irregular too (entity 240503). It's back in the catalogue under a 2525C-style code
of ours, G*F*ACPI ("Position area for artillery (paa)"), which `toDCode`
(`graphics/graphics.ts`, `BEYOND_C`) turns into 2525D's irregular PAA: the irregular fire
support area's code (G*F*ACSI, for the affiliation and status) with its entity
swapped. Note: G*F*ACPI isn't a real 2525C code, for anything exported to other
systems. The renderer writes "PAA" on every side, as the standard's template does
(readable whatever part of a large area is in view): kept.

## Fork folders tidied (2026-11-06)

Pure moves, nothing changed in behaviour:
- `userlayers/graphics/`: everything about tactical graphics, out of `map/` (which
  kept the map's own drawing and tools): `graphics.ts`, `labels.ts`, `variants.ts`,
  `svg.ts` (were `map/graphics.ts`, `map/graphic-labels.ts`, `graphic-variants.ts`,
  `graphic-svg.ts`), `tta106-sigles.json`.
- `fork/services/`: the shared state and registries, out of `fork/ui/` (which kept
  what's on screen): `legend.ts`, `live.ts`, `map-mode.ts`, `selection.ts`,
  `supply.ts`. `structure.test.ts` checks the new area: modules and `ui/` may use
  `services/`, `services/` never `ui/`.

## Satellite menu easier to read; more detail added later (2026-11-06)

- **The aerial photo question** (`scripts/satimagery/menu.py`) line by line: what the
  photos are, one line per zoom with what it shows (`ZOOM_SHOWS`: 15 streets and
  blocks, 16 houses, 17 cars), its size and time, the free space on the disk (a
  zoom that wouldn't fit, at twice its size during the last step, is marked). The
  Sentinel-2 zoom question too: "a town fills the screen … on disk (downloads ~…)".
- **More detail later without downloading again**: the first download makes
  `<area>.sat-detailed-<source>.pmtiles` (zoom 14 up); asked for more later, the menu
  (and `--satellite-detailed`) sees what's there (`detailed_have`, from the files'
  PMTiles headers) and offers only the zooms after it, with their own size
  (`detailed_estimate(..., start)`), downloaded into a file of their own
  (`detailed_file`: `...-z16-17.pmtiles`; `satellite.py detailed --minzoom`). What's
  there stays. The tiers line takes each aerial file's own first zoom
  (`pmtiles_minzoom`, 14 at the lowest), and the map draws each file from its
  first zoom, coarsest first, so the added file takes over from its first zoom.
  Before, the working file was deleted once converted, so asking for more meant
  downloading zoom 14 up again.

## One graphic, two versions (2026-11-06)

Block, Disrupt and Fix were each in the picker twice (the task and the obstacle
effect), Main attack, Supporting attack and Aviation too (an axis of advance and a
direction of attack), with the same names. Now a switch on the card (`userlayers/graphics/variants.ts`, `VARIANTS`): **Task / Obstacle**,
**Axis of advance (wide) / Direction of attack (thin)**. The two versions take the
same points (an arrow: its path, tail to tip), so switching keeps the drawing; an
axis gets its width back (`axisWidth`), a direction has none. Both versions are in
the picker (a filter hiding the second ones was tried and removed: how to list and
name them is in the backlog, SPECIFICATIONS 9.29). The second versions are named for what they are in the catalogue ("Block (obstacle)", "Main attack (direction of attack)") for the
legend. The obstacle effects are green: the standard's colour for friendly
obstacles (as is neutral; the shapes differ).
- **Directions of attack pointed backwards**: the renderer wants their tip first,
  the tool gives the path tail to tip. Reversed for the renderer (`isDirection`: the
  three, and the feint's direction of attack), on the map and in the preview.
- **Engagement area** was in the catalogue twice (G*G*GAE, G*G*DAE: the same 2525D
  symbol): G*G*DAE removed.

## Rectangular fire support areas removed (2026-11-05)

The 17 "…, rectangular" graphics (FSA, ACA, FFA, NFA, RFA, PAA, sensor zone, DA,
ZOR, TBA, TVAR, ATI zone, call for fire zone, censor zone, CFZ, blue and purple kill
boxes) need a width in metres besides their two points, which the drawing tool never
asks for: the renderer refused them ("requires a modifiers object that has 1
distance/AM value") and nothing was placed. Removed from `model/symbols-2525c.json`:
the irregular versions draw a rectangle just as well (four points). The position
area for artillery (PAA) had only the rectangular one in 2525C: it's back as 2525D's
irregular one (below).
With no other shape left, the remaining 16 lose ", irregular" from their names
("Zone of responsibility (zor)").

## Plain labels on tactical graphics (2026-11-05)

The renderer writes the standard's text on 110 graphics, and several share a letter
(B: Block, Breach, Bypass, Bridgehead, Bearing line). Each now gets a label of its
own, in English or French, as agreed in `docs/plans/graphic-labels.md`: one letter
only for the most common, short words in full, others shortened or initials (WUP);
French from the French Army's terms (TTA 106).
- `userlayers/graphics/labels.ts`: `GRAPHIC_LABELS` (2525C code without
  affiliation and status, `graphicKey`, now shared with `SQUARE`) → for each text the
  renderer writes, what to write instead in English and French ('' = not written:
  Contain's ENY), and the French name. `renderGraphic` replaces them (`language`:
  the chosen one by default, null the standard's), so the map, the preview, prints
  and the legend's drawings all show them.
- **Graphic labels: English / Français / Standard (MIL-STD-2525)** in My layers'
  "Labels, bearings, name", kept in this browser (`oim-userlayers-graphic-labels`);
  chosen, not the browser's language, so everyone on a map can see the same.
- The legend: "WUP: Withdraw under pressure", in the chosen language
  (`graphicSvg` returns the labels written; `graphicName`).
- `graphics/labels.test.ts`: every catalogue graphic through the real renderer, in
  both languages: no two different graphics share a label; every replaced text is
  one the renderer writes; no French label means something else in TTA 106
  (`tta106-sigles.json`: its abbreviations and the letters on its task symbols).
  It found DA, ZOR and TBA (kept as acronyms) clashing: Z-MORT, ZR, Z-CIB in French.

## One tooltip for the page (2026-11-05)

The browser's tooltips (`title`) wait for the pointer to rest, often didn't show
(the coordinates' "press G"), and look like nothing else here. `fork/ui/tooltip.ts`
(installed by `forkInit`) shows every title on the page, the fork's, upstream's and
MapLibre's, as one tooltip of its own: the title moves to `data-tip` when the pointer
first comes (an icon-only control keeps it as its `aria-label`); shown after 350 ms,
at once when going from one control to the next; below the element, above if there's
no room, kept on screen (`placeTip`); hidden on a click, a key, a scroll or the wheel;
on keyboard focus too; from where the pointer is (`elementFromPoint`: disabled
buttons send no pointer events). The coordinates' tooltip: "G: copy grid at pointer"
(its CSS one removed).

## The printed legend: what's on the page (2026-11-05)

It listed the layer switcher's names (Labels, Borders), a colour square per My
layers layer, and graphics as a line in the layer's colour: none of it explained
the map.
- **The key, only what's on the page** (`fork/ui/key/legend.ts` `keyLegend`): the Key
  panel's rows (upstream's and the modules', read from its DOM: label, swatch, and
  what it draws, `swatchSpec` / `data-hide`), kept when a feature they draw is drawn
  in the printed area (`specConditions`, moved out of `FeatureHider`, turned into a
  `queryRenderedFeatures` filter over the area), under the Key's own headings, with
  their swatches (inline SVG, sprites fetched).
- **My layers by layer** (`userlayers/map/legend.ts`): a section per layer shown, by
  its name, in the list's order, listing what of it is in the printed area, each kind
  once: a unit's symbol, a graphic drawn small by the real renderer from made-up
  points in its usual shape (`graphics/svg.ts`; in its own colour, else the
  renderer's, as on the map), lines, areas and markers in their colour by name.
  Copies are left to the key; pictures and measurements explain themselves.
- Legend sources get the printed area (`addLegend((map, area) => …)`).
- The PDF's built-in font has no ≥ or ≤: written >= and <= (`printable`).

## Three-point graphics drawn square (2026-11-05)

Of the 31 graphics in the catalogue drawn from exactly three points, the renderer
squares none up itself: a third point off to one side drew a skewed Contain, Block or
Bypass. Checked one by one (each drawn with its third point skewed):
- **Square, third point on the perpendicular through the middle of points 1-2**:
  Block (task and obstacle effect), Penetrate, Contain, Clear, Breach, Bypass (and
  easy, difficult, impossible), Canalize.
- **Disrupt**: its arrows run along the line from one end of the base to point 3
  (the task: from point 2; the obstacle effect: from point 1): point 3 on the
  perpendicular through that end.
- **Ambush, Attack by fire position**: point 1 (the arrow's tip) on the perpendicular
  through the middle of points 2-3.
- Left free (their angle means something, or the renderer already fixes it):
  Search area, Dummy, Principal direction of fire, Turn, Delay, Withdraw and
  Retirement, roadblocks, fords, infiltration lane, minimum safe distance zones.

`squareUp(sidc, points)` (`graphics/graphics.ts`, table `SQUARE` by 2525C code) moves the
free point onto the perpendicular, keeping its distance from the base. Used while
drawing (the preview and the stored points), when a point is dragged (the free one
stays on the perpendicular, or follows when the base moves), for the handles, and
when drawing on the map, so items drawn before are square too.
Filled shapes the renderer gives no outline colour (an obstacle Disrupt's
arrowheads) are outlined in their fill (`normalise`), not in the layer's colour the
map falls back to (they had red edges in a red layer). Obstacles are green: the
standard's colour for friendly obstacles.

Each graphic's points mean something of their own (the standard's, per graphic), so
there's no one rule: `graphics.test.ts` draws every graphic in `SQUARE` through the
real renderer with its free point skewed, squares it up, and checks its main stroke
(the longest line not along the base) is at a right angle to the base. (The task
Disrupt was first squared through point 1: that check fails on it.)

## Place names and satellite zooms: rules instead of numbers (2026-11-06)

- **Place names** (`map-sources/labels.ts`): one rule read from the style: a
  place-name layer that ends after zoom 10 (towns, neighbourhoods: the name of where
  you are) is kept to the closest zoom, from where the style starts it; countries and
  regions (ending at 8) keep upstream's end. Before: each layer's zooms copied in
  by hand (5.5 and 13), after three tweaks.
- **Satellite zooms** (`select_satellite`, `scripts/lib/satellite.sh`): each imagery
  file is shown over the zooms its own header gives (satellite.py writes them); the
  tier's usual zooms are only a fallback when a header can't be read. Before: fixed
  0–8 and 9–… per tier, and aerial photos forced to start at 14 at least.

## Printed text: one font with every character (2026-11-06)

The PDF used jsPDF's built-in Helvetica, which only knows Latin-1; characters it
lacked were swapped one by one (`printable`: ≥ → >=, ≤, −, thin spaces), and the
next one (œ, Cyrillic, →) would have printed wrong. Now the PDF embeds DejaVu Sans
(`print/fonts/`, its free licence beside it; fetched only when printing, from the
app, so offline too): one font because jsPDF can't switch fonts inside a text.
Noto Sans (the map's) was tried first: it has no ≥ ≤ →. The rule is tested
(`fonts.test.ts`): the font must have every character of the app's strings
(`locales/en.json`), the symbol catalogue and the key's ≥ ≤ → (emoji excepted: on
screen only). `printable` is gone.

## Measurement marks: one rule, like a ruler (2026-11-06)

The marks had two rules that fought: labels about 80 px apart, and "at least four
labelled steps along the measurement, else none". On a short measurement, or just
under a zoom where the step jumps (2 km labels 79 px apart: 5 km steps), they
couldn't both hold and every mark went; a first fix (smaller steps down to 45 px)
only moved the gap. Now one rule (`tickSteps`, `measure/ticks.ts`): the step is the
smallest round distance (1, 2 or 5 × 10ⁿ m, at least 10 m) whose labelled marks are
at least 60 px apart, so they're always 60 to 150 px apart; a measurement shorter
than two steps (tiny on screen) has none. A test checks it at every zoom from 6 to
18. Labels that would overlap the legs' own labels give way (MapLibre); the marks
stay.

## A layer's items, in groups (2026-11-06)

An open layer lists its items under small headings that fold (`ui/outliner/groups.ts`,
`ITEM_GROUPS`): friendly units, hostile units, neutral and unknown units, friendly
graphics, hostile graphics, other graphics, measurements, drawings and markers,
pictures, copies of map features (empty groups not shown; friendly includes assumed
friend, hostile includes suspect). Inside a group: present first and planned at the
end, then by shape (arrows, lines, areas, points), then by type (the same graphics
one after another), then by name (numbers in order: 2 before 10). Folded groups are
yours (`foldedGroups` in the personal settings); while searching, every group is
open. Items were in the order they were made before. The groups have no eye: a
layer is shown or hidden as a whole. The groups go by side (friendly units and
graphics, then hostile ones, then the others).

Selecting in the list: a click selects one item, Ctrl / Cmd-click adds or takes one
out, Shift-click adds everything shown between the item clicked last and this one
(across groups and layers; `tools.selectAll`). On the map, Shift-click still adds
one item.

## Satellite menu: two independent steps (2026-11-06)

The menu's Sentinel-2 question ended the menu when answered "None", so the aerial
photos were never offered; and it offered the built region again ("+204 MB to zoom
12") without saying it was already there, to zoom 13. Now: step 1 (Sentinel-2) says
what's there and defaults to keeping it ("Keep what you have (France to zoom 13)");
step 2 (aerial photos) always follows, for the area chosen in step 1 or else the
region built, or says no agency's photos cover it (`regional_have`, menu.py).

With one aerial source, step 2 asks the zoom straight away ("Download France (IGN)
up to which zoom? [15/16/17, Enter: none]"); with several, which ones, then the
zoom. An answer that doesn't fit is said so and asked again (`ask`, `ask_numbers`),
never dropped: a zoom typed where a source number was asked used to vanish.

The catch-up only touches files that start above the lowest zoom their area can
have (`lowest_zoom`, tiles.py: where it spans half a tile; Luxembourg 8, France 5):
`lower-zooms --list-needed` says which. Before, Luxembourg (which GDAL can't take
below 8) was redone on every run.

## Picker: one row per graphic type (2026-11-06)

A graphic with two versions (Block, Disrupt, Fix: task or obstacle; Main attack,
Supporting attack, Aviation: axis or direction of attack) is one row in the picker,
its first version, with its versions noted under its name ("Task / Obstacle"); the
card switches between them (variants.ts). Searching either name finds it ("obstacle"
finds Block), and favourites or recent picks of a second version show as the first
(`offeredAs`, palette.ts). Before, both versions were rows after several patches
(hidden, then shown when the first wasn't listed). Closes 9.29.

## Distances in real metres everywhere (2026-11-06)

The map's coordinates (EPSG:3857) stretch away from the equator by 1/cos(latitude):
10 map units are 10 m at the equator, 6.9 m in France, 5 m in Oslo. Distances and
areas had been written in those units, tuned for France ("15 ≈ 10 m", "725 ≈ 500 m",
"roughly 4–7 km in Europe"), or scaled by hand in one place (grid_check.py). Now one
rule: every distance and area is written in real metres, converted by
`schema/distances.sql` (`oim_units`, `oim_metres`, `oim_ground_area`, and
`oim_max_stretch()`, the region's largest stretch from the table statistics: the
constant radius that lets an indexed search find candidates before the exact check
at the point). France keeps the same results: the values are the ones they meant
there (grid snapping 65 / 170 m, open-data duplicates 10 / 17 / 100 / 500 m and
900 m², search's town 10 km, sites' sizes 220,000 / 90,000 / 5,000 m², grid routing
5 / 40 / 65 km, a plant's substation 650 m). Checked on France in a rolled-back run:
the grid 272,670 lines (272,357 before), sites' importance within a few dozen.
The frontend's search merges the same name within 5 km on the ground
(`groundDistance`, core/geo.ts), not 0.05°. `distances.sql` is in `SCHEMA_FILES`,
run by builds and imports; a test fails if a build SQL file measures with a bare
number.

## Data layers: the layer list and the key in one panel (2026-11-06)

The Layers button opens **Data layers** (`fork/ui/data-layers.ts`); the Key button
is gone. Upstream's groups (Overlays, Infrastructure, Critical sites...) are
headings; each entry has its tick box and unfolds (▸) to the key sections of what
it draws, each key row with its tick box as before. A key section goes under the
entry of the same name, else the entry whose map layers its rows draw (by layer
prefix), else under "Other" (`assignSections`, tested). Statuses' key stays a key:
no tick boxes on its rows. Which entries are unfolded is kept in this browser.

Upstream's list is rebuilt when the address changes, so it isn't moved: the tick
boxes here call its switcher (`setVisibility`) and are redrawn from it (on opening,
on `hashchange`). The key is built once, so its sections are moved into the panel,
whose body keeps the class `oim-key-body` (the printed legend reads the rows there;
`keyRows` now finds them at any depth). "Show all" moved to the panel's header and
looks for the key's tick boxes anywhere on the page. Background stays in Settings.

Open data isn't a group of its own: the distribution and gas networks have no entry
and follow Power and Oil & Natural Gas (`modules/extra/follow.ts`: their map layers
take the category's visibility whenever the style changes); ICPE is under Critical
sites (groups of the same title from several modules are one: `mergeGroups` in
`fork/index.ts`). Search results of open data switch on Power (P) or Oil & gas (O)
instead of their old entries (X, Y; `schema/search.sql`).

## Satellite downloads all at once (2026-11-06)

`download_satellite` ran its steps one after another (Blue Marble, then Sentinel-2,
then the aerial photos), each waiting for the last though they come from different
servers and write different files. Now they all start together (`run_parallel` in
`lib/ui.sh`: one live line per step with its time and latest progress, then each
one's result); each still keeps its own server's speed limit and waits for a lost
connection on its own.

## The background map's colours (2026-11-06)

Upstream's background style draws most areas at the same lightness from zoom 6 on
(93%), told apart only by a faint tint: fields (farmland) were the very colour of
parks and grass, and towns, industry and hospitals another single one, so it was
hard to see where a town or a field stops. One palette now (`modules/map-sources/
palette.ts`, `PALETTE`), still pale and washed out (saturation 35% at most,
lightness 82–94%), a shade per kind of area: unmapped land 94% warm off-white,
fields 91% pale straw, grass and parks 88% soft green, woods 84% deeper green,
housing 89% cool grey, industry, shops and airports 87% mauve-grey, hospitals and
universities 90% pale rose, farmyards 88% tan, water 82% blue, sand, glaciers.
Zoomed out (zoom 2 to 6) each is 8% darker, as upstream's are. A paint override of
upstream's layers (style_base.ts unchanged); a test fails if one of them is renamed.

Buildings keep upstream's warm pinkish beige, a little darker (87% at zoom 12 to
81% at 16, so they stand out of the housing around them) and airports have their own pale blue-grey
(93%), lighter than the land, so the runways stand out as upstream's do. Roads
are white with a grey edge (74%) and footpaths a mid grey: upstream's light grey
roads (89%) stood out of its darker towns (82%) but were lost on this palette's
lighter housing (89%).
**Settings → Background** chooses *Map, high contrast* (this palette, the default),
*Map, original colours* (upstream's paint, restored from what the override saved) or
satellite imagery; the choice is kept in this browser (`services/map-colours.ts`,
`oim-map-colours`).

## Statuses removed (2026-11-06)

The status system (docs/plans/feature-status.md) is gone, to be rebuilt simpler
later (SPECIFICATIONS 10.11): statuses of map features (the ⚠ status board, the
form, the badges on the map, the per-feature history and its playback, searching
by status), the power supply mode built on them (the grid's red, orange and "at
risk" colours, the grey of what's connected to nothing, My layers copies coloured
the same), Shift-click selection of map features (only used to set statuses) and
the "Can set statuses" account right. Gone: `modules/status/`,
`services/supply.ts`, `services/selection.ts`, the backend's `userdata/status.py`
and `grid_supply.py` (`/userdata/status*`, `/grid/supply*`), the "status" live
event, `search_statuses`. `userdata.sql` no longer makes `feature_status`,
`status_change` or `app_user.can_set_statuses`; a database that already has them
keeps them, unused (the code no longer reads or writes them).

## Aerial photos from zoom 12 (2026-11-06)

Every aerial source (`TIERS["detailed"]`, IGN's départements too) now starts at
zoom 12, a town on screen, instead of 14: scaled down, the photos are sharper and
truer in colour than Sentinel-2's 10 m there already (about 8% more). Files made
before get the two zooms without downloading anything: `lower-zooms` now takes any
imagery file (`--file fr-75.sat-detailed-fr_ign`; Sentinel-2's too) and
`--list-needed` lists aerial photo files starting above 12 as well as Sentinel-2's
starting above their area's lowest; `catch_up_lower_zooms` (was
`catch_up_regional`) runs it after every satellite download. Paris: 1 min 10 s.

## Refactors: the satellite menu, one rule for more detail, Background (2026-11-06)

- `satimagery/menu.py`: `command_choose` was one 320-line function (presets, the
  Sentinel-2 step, the tile sources, IGN's départements), where the menu's bugs
  came from. Now a `Planner` with a method per step (`presets`, `step_sentinel`,
  `search_area`, `world_zoom`, `area_zoom`, `step_aerial`, `choose_tile_sources`)
  and the prompts in `read_answer` / `ask` / `ask_numbers`.
- More detail later: one rule for every aerial source. A tile source's file used
  to get its new zooms in a second file (`…-z16-17.pmtiles`, `--minzoom`, an
  estimate "from zoom N"); now, like IGN's départements, the file is made again up
  to the new zoom and replaces the old one when finished (the zooms below are
  about a third more work). `detailed_file(folder, area, source)` is the one file.
- `fetch_images.py` and `extradata/cli.py`: each `main()` was 200 lines. Now a
  function per step (`wikidata_ids`, `step_entities`, `step_thumbnail_urls`,
  `step_images`) and per command (`command_offer`, `command_dedupe`,
  `command_remove`, `command_list`, `command_import` with `wanted_sources` and
  `import_source`; the duplicates total in one place, `total_duplicates`).
- Settings → Background is its own module (`modules/background/`): it chose the
  map's colours too but lived in `modules/satellite`. The choice is kept in
  `services/background.ts` (replacing `services/map-colours.ts`; what browsers kept
  is read the same), which `map-sources/palette.ts` and `modules/satellite` follow;
  the satellite module only draws the imagery and says what there is
  (`offerImagery`: its last zoom, where it covers). Strings `satellite.*` of the
  section became `background.*`.

## France's aerial photos from IGN's files (2026-11-06)

IGN's tile server blocked this computer after a thousand tiles (below), so France's
photos no longer come from it: `DETAILED_SOURCES["fr_ign"]` is `"files": "bdortho"`
and `satimagery/bdortho.py` downloads IGN's BD ORTHO, the files IGN publishes for
bulk use, one département at a time: the latest colour 20 cm edition from IGN's
download service (an Atom listing, `latest_edition`), its 7z archive in 4 GB parts
(3 at once, `netsafe.fetch_file`: resumed with HTTP Range, a connection closed
early is not taken for the end; each part checked against IGN's md5, fetched again
once if damaged), the JPEG 2000 images extracted (7-Zip, else in Docker) and the
archive deleted, then GDAL makes WebP tiles (quality 75) from zoom 12 to the zoom
asked (15 to 19), and the images are deleted. The tiles (`pipeline`): the images
reprojected into one image at the last zoom's resolution (`gdalwarp` on every core,
reading each JPEG 2000 at the reduced resolution it needs; JPEG inside, a
transparency band outside the photos), then each zoom straight from it with GDAL
3.11's `gdal raster tile` on every core (`TILER_IMAGE`), packed into MBTiles
(`pack`, with the tiles' bounds) for `pmtiles convert`. Paris to zoom 17: 1 min 30 s
in all. A virtual mosaic reprojected on the fly took over 15 min (every image read
whole at 20 cm), and tiles made from the zoom above failed (read while being
written). One file per département
(`fr-67.sat-detailed-fr_ign.pmtiles`): no copy of a whole country's file to make
at the end (which would need twice its size), a département already there is
skipped, and the work folder (`data/basemap/.bdortho-67/`) is kept between runs so
a stopped download goes on. The menu asks the zoom, then which départements of the
area (`departements.py`: the 96 of metropolitan France with their area, bounds and
Geofabrik region, made once from france-geojson's outlines). The tiers in
`VITE_SATELLITE_TIERS` now carry each file's bounds (from its header) and the
frontend gives them to its sources, so the map only asks the files that cover
what's on screen; the scripts sum the départements up as "IGN photos of N
départements". The partial download from IGN's tile server was deleted.

## A server that stops answering, the internet working (2026-11-06)

IGN's aerial photo server (data.geopf.fr, behind a web firewall) stopped answering
this computer altogether after about a thousand tiles at 20 a second: not even a
connection, while every other site answered. IGN documents no limit for its WMTS,
so it's the firewall's bot protection. The downloads took it for a lost connection,
waited 15 min and said "No internet connection". Now (`netsafe.py`, `lib/net.sh`,
the same rule): while waiting, a few big sites are checked (`INTERNET_PROBES`); if
they answer and the server hasn't for `NET_SERVER_GRACE` seconds (2 min), the
download stops at once with `ServerStopped`, exit status 76 (`SERVER_STOPPED`),
saying the server stopped answering this computer and to try again later; every
other thread stops with it, what's downloaded is kept. `run_parallel` also cuts
each live line to the terminal's width: a longer one wrapped, and the redraw left a
copy of it behind every second.

## Sentinel-2 from zoom 7 (2026-11-06)

For every area, Sentinel-2 is made from zoom 7 and shown from 7 at the earliest
(`TIERS["regional"]` in sources.py; `REGIONAL_FIRST_ZOOM` in lib/satellite.sh, which
clamps any file's range, a test keeping the two equal); further out, Blue Marble.
At zoom 5 or 6 a country is a patch of a few dozen pixels: not worth it. France's
file, made when it started at 5, keeps its zooms 5 and 6 unused (a few MB). Below:
how it got lower zooms at all.

## Sentinel-2 from zoom 5, at first (2026-11-06)

Sentinel-2 imagery started at zoom 9, under Blue Marble's 500 m pixels until then.
It now starts at zoom 5 (`TIERS["regional"]`): the download adds the lower zooms
(GDAL's overviews, a few hundred tiles more); GDAL stops where the whole area fits in
about one tile. Files made before get them with `satellite.py lower-zooms --region
ID`: their tiles read back from the local imagery server, the lower zooms computed
the same way, the file replaced once the new one is complete; nothing downloaded.
The imagery server (basemap service) caches each file's index: restart it after a
file is replaced.

The scripts do it themselves: `download_satellite` (satellite.sh, build-region.sh)
ends with `catch_up_regional`, which runs `lower-zooms` on any Sentinel-2 file still
starting above zoom 5 (with its outline), then restarts the imagery server.
satellite.sh runs it even when nothing new is chosen.

## Debug info; no Edit button (2026-11-06)

- **Debug** (`modules/debug/`): Settings → Debug → "Show debug info" (kept in this
  browser) shows a box at the bottom right, of a fixed size so it never moves or
  resizes as values change: zoom, centre, scale and metres per
  pixel, whether tiles are loading, how many style layers are drawn, the screen, and
  under the pointer its position and each feature there (style layer, tile layer,
  id).
- **The Edit button** (upstream's, bottom right: OpenStreetMap's online editors) is
  removed, with its code (see "Merging from upstream").

## No header: settings, print and the account among the map's buttons (2026-11-06)

- Upstream's header (title, about, stats, a paid export) is removed by the layout
  module (`document.querySelector('header')?.remove()`; index.html unchanged). The
  search box sits at the top left.
- At the bottom of the top-right buttons (`fork/ui/map-button.ts`, line icons from
  `fork/ui/icons.ts`, ordered with CSS `order`): **print** (the printer opens the
  print window, whether My layers is open or not), **Settings** (the gear: the
  app's settings only: background, map sources, accounts) and **your account** (the
  person: who is logged in, Log out, in the right-click menu's look).
- **About this map** opens from the map's credits (bottom right): the credits
  control is replaced by one with that link (`modules/layout/about.ts`), put back in
  the corner.
- **My layers' settings** (colour of new items, unit and graphic labels, bearings)
  are in their own window, opened only from My layers' ⚙ (no longer a section of
  Settings).

## My layers' panel, cleaner; dead code removed (2026-11-06)

- **The panel:** as tall as its content, down to the bottom of the left column
  (it was capped at 45% of the window); only the list scrolls. The header holds the
  title, the situation, ⚙ and ×. Search and a **Filter** button share a line (the
  chips show only when it's open; it says how many are on). A footer that doesn't
  scroll: + Layer, + Folder, import ⤓, export (the same arrow turned round).
- **Right-click menus** (`fork/ui/context-menu.ts`, `withContextMenu`; also the
  Menu key / Shift+F10, arrows to move, Escape to close): a layer's (draw into it,
  zoom, rename, lock, share, move to folder, export, delete) and a folder's (new
  layer in it, rename, lock its layers, export, remove the folder: its layers stay).
  The ⋯ menu is gone (clicking it also opened the layer, which redrew the list and
  closed the menu), and so are the row's lock, colour and folder buttons. Rows: an
  eye (`fork/ui/icons.ts`, crossed out when hidden), the name, 🔒 when locked, ✎
  where you draw, the count.
- **Settings:** My layers' preferences moved to the Settings window
  (`ui/preferences.ts`; ⚙ opens it there, `openSettings`): the colour of new items,
  unit labels ("Labels on the map" before), graphic labels, bearings.
- **No layer colour:** a layer no longer has a colour. What has no colour of its own
  is black (`DEFAULT_COLOR`); new drawings, markers, measurements and graphics get
  the colour chosen in Settings (`map/new-colour.ts`, kept in this browser). Layers
  saved with a colour keep it in their data, unused.
- **The typed author name, removed:** "Saved as" in My layers and "Set by" on a
  status (and `core/author.ts`). Every request comes from a logged-in account and
  the backend signed saves, situations and statuses with its name anyway; its
  fallback to a typed name is gone too.
- **Dead code removed:** unused helpers (`isSquare`, `labelOf`, `describeNorth`,
  `SECTIONS` and every field's `section`, `region_in`, `StreamReader`), styles of
  removed elements (the old menus' `menus.css`, the colour input, old panel classes),
  50 unused strings. Found by scans of exports nobody imports, CSS classes no code
  names, strings no code uses, Python (vulture) and shell functions never called.

## Setup scripts tidied; safe downloads (2026-11-06)

**Every download goes through one safe function.** Shell: `download URL FILE`
(`lib/net.sh`, curl, through `FILE.part`, resumed) and `safely URL command...` for
another downloading command (`pmtiles extract`). Python: `scripts/netsafe.py`
(`safely(call, url)`, `fetch(url)`), used by the satellite tiles and Sentinel-2's
GDAL pipeline, the extra data (Agence ORE, Géorisques, the départements) and the
Wikidata cache. What they do when a download fails:

- the server still answers (a drop, a busy server): tried again a few times;
- it doesn't: wait for the connection (checked every 15 s, `NET_CHECK_EVERY`) for
  up to 15 minutes (`NET_WAIT_SECONDS`), then go on where it stopped;
- a download that hangs (curl: under 1 kB/s for 2 minutes; pmtiles: its progress
  stops for 2 minutes, `run_with_timer --stall`) counts as failed;
- the connection doesn't come back: stop, keeping what's downloaded, with exit
  status 75 and "run again to go on". The build stops on the OSM extract; the
  background map, satellite imagery, extra data and Wikidata cache are skipped
  with a warning (the map works without them).

Small files fetched while asking the questions (`download --quick`: the Geofabrik
index, checksums, Protomaps' build list; extra data's estimates) are retried but
never waited for: the questions have an offline fallback.

The crash this fixes: the server hanging up mid-download (`RemoteDisconnected`)
wasn't caught, and the world's Blue Marble download stopped with a traceback.

**The scripts, easier to read** (behaviour, options and questions unchanged; the
real Luxembourg build, export and import pass):

- `build-region.sh` (977 lines, now ~900 with more comments): "what the build will
  do" at the top, every variable the steps share with its meaning; choices as
  `yes` / `no` / `ask` (one variable each: `--no-extra` was two flags); each step
  does one thing (`find_region_source`, `decide_download`, `check_space`,
  `check_docker_space`, `import_extra_data` split out of the steps that hid them);
  the long question steps split (`find_kept_extra_data`, `find_extra_offer`,
  `choose_extra_datasets`, `find_basemap_area`, `choose_basemap_detail`,
  `region_menu_line`).
- Shared helpers instead of copies: `choose_number` (every numbered menu),
  `room_for` (disk space), `banner` / `done_banner` / `duration`, `json_get` /
  `json_write` (manifests; 6 inline Python snippets gone), `pmtiles_header_byte`
  (3 copies), `run_schema` with each step's label (`SCHEMA_LABELS`).
- Building and importing share `fresh_database` (My layers and extra data saved,
  the wipe), `put_back_my_layers` and `restart_map_services` (`lib/db.sh`).
- Helpers moved out of `build-region.sh`: the Geofabrik index and lookups to
  `lib/geofabrik.sh`, the background map's download to `lib/basemap.sh`.
- Fixed on the way: a failing "Putting back the extra data" or "Numbering towers"
  stopped the build instead of warning (the warning was unreachable).
- Note: an extract download left unfinished by the old script (`.osm.pbf.part`)
  starts again; new ones resume from `.osm.pbf.new.part`.

## Code tidied (2026-11-06)

A pass over the fork's frontend for repeated logic and long files. Behaviour is
unchanged: today's exact values (arrow widths, path lengths, map scale, metres per
pixel, size snapping) were locked in `userlayers/locked-values.test.ts` first and
still pass.

- **Folders:** tactical graphics in `userlayers/graphics/`; shared state and
  registries (live updates, map mode, selection, supply colours, the print legend)
  in `fork/services/`, out of `ui/`. Folder rules in `structure.test.ts`.
- **One helper instead of copies** (`core/`): `geo.ts` (metres per pixel,
  degrees/radians, the Earth's circumference), `math.ts` (`clamp`), `colour.ts`
  (`parseHex`), `map-style.ts` (`geometryIs`), `storage.ts` (local storage read
  and written with the try/catch in one place; 8 files used their own). In My
  layers: `positionsOf` / `pointOf` (`model/shapes.ts`) for a geometry's positions,
  one distance-unit table, the mouse wheel's numbers named (`map/tools.constants.ts`),
  the arrows' flat-earth constants named (same formula: saved arrows depend on it).
- **Long files split:** `map/render.ts` (1187 lines) into `render.ts` (the
  Renderer), `layers.ts` (style layers), `geometry.ts` (pure geometry); the outliner
  into `ui/outliner/` and the card editor into `ui/editor/`, their longest
  functions (a 340-line `buildEditor`, a 203-line `layerRow`) broken into named
  parts.
- **Types and constants in small files** next to their code (`X.types.ts`,
  `X.constants.ts`): render, tools, fields, sidc, labels, graphics, palette,
  formats, api, measure ticks and features, supply, grid route.

## Printing reworked: the map fills the page (2026-11-05)

The map took about a third of an A4 page: it was the screen's picture (twice as wide
as tall) fitted in a much squarer box, under 10 mm margins, a header and a footer
for a line each, and a 62 mm legend column even for two entries.
- **The page** (`layout.ts`): the map fills it but quarter-inch (6.35 mm) margins,
  what nearly every printer can print to (lasers about 4 mm, inkjets 3-5), so at
  actual size nothing is cut off; the written scale holds only at actual size
  ("fit to page" shrinks it, the bar shrinks with the map), which the box says
  under the scale. A box over the map's bottom-right corner
  (about a fifth of the page wide, only as tall as it needs, at most 70 % of the
  map) has the title, when and by whom, the legend (what doesn't fit: "…and N
  more"), the scale and its bar, the centre and its MGRS, the credits (`parts.ts`
  `drawInfo`, laid out twice: measured, then drawn). North in the top-right corner.
  About 90 % of the page is map.
- **What's printed** (`printedArea`): the biggest area of the paper's map's shape that
  fits on the map on screen, a little in from its edges, at the screen's zoom.
  While the print window is open, a frame shows it and dims the rest (`frame.ts`);
  the window is no longer modal (`makePanel`, floating top left), so the map can be
  moved and zoomed under the frame. Paper and orientation change the frame.
- **Sharper**: drawn again at 300 dpi for the paper (`printRatio`: `setPixelRatio` up
  to what the graphics card can draw, 8192 px a side at most) and cropped to the
  frame (`images.ts` `capture`). A4 landscape: 3358 × 2330 px. The map's WebGL canvas
  is read with `toDataURL`, then cropped: `drawImage` straight from it swapped red
  and blue with some graphics drivers (friendly light blue symbols printed yellow).
- `makeModal` (`fork/ui/panel.ts`) is Settings' only.

## Unsaved changes in IndexedDB (2026-11-02)

My layers' unsaved changes (and their bases) were kept in localStorage, which
holds about 5 MB per site: a big imported file went past it, and the copy was
silently not kept. `userlayers/state/local.ts` now keeps them in IndexedDB
(database `oim-userlayers`, written 300 ms after the last edit and at once when
the page is hidden or closed); localStorage where there's no IndexedDB. The first
time, what localStorage had is moved over. They're read back at the store's first
`load()`, and nothing is written before: an edit made meanwhile would have
overwritten them (both are kept, the older first). When they can't be kept
(storage full or blocked), the My layers panel says so: Save now. Tested: a 3 MB
GPX-size import kept across a reload; an old localStorage copy moved over.

## The map mode (2026-11-02)

`fork/services/map-mode.ts`: one tool at a time takes the map over. `mapMode.enter({name,
cursor, doubleClickZoom, click, dblclick, contextmenu, mousemove, keydown, exit})`
gives it the map's events (right-click without the browser's menu), the cursor and
double-click; Escape ends it (unless its `keydown` uses the key); entering a mode
ends the one before (its `exit` runs). Meanwhile upstream's click router opens no
feature details: `mapMode.install` wraps its `handleClick` once (fork/index.ts),
replacing the wrappers measuring and My layers each had, and `claimClicks` lets a
module keep some clicks without a mode (My layers, on its own items). My layers'
drawing, placing and measuring tools are modes. Replaces `ui/map-clicks.ts`.

## My layers: kinds of item (refactor, 2026-11-02)

What each kind of item is (symbol, graphic, image, marker, drawing, copy) was
spread over a dozen `kind === ...` tests (the map, the list, the card, the history,
files). Now each kind is a file in `userlayers/kinds/` (`ItemKind`, `kinds/types.ts`)
saying how it's named, drawn (standard, graphic or copy), its icon and how that's
drawn (`images`: prefix and maker; `map/icons.ts` adds them to the map by prefix,
replacing `ensureImage`'s list in `symbols.ts`), its thumbnail, what the card
offers (size, colour, line width, military fields), whether it moves, its filter
chips. The rest asks `kindOf(properties)`. No change in behaviour; a new kind is a
file and two lines (recipe in `docs/ARCHITECTURE.md`). Left as they are: the
toolbar's tools (they make items) and the card's MIL-STD fields (they depend on the
symbol code, not the kind).

## My layers' list, polished (2026-11-05)

- **Fixes:** a folder's 🔒 only locks your own layers (only an owner may lock: the
  others were refused at Save) and is greyed out when there's none; while a
  situation is shown, a folder's + and ✎ are greyed out (they changed the live
  layers); counts in the singular ("1 layer"): `tn()` in `fork/core/i18n.ts` (i18next
  plurals, `key_one` / `key_other` in en.json; `scripts/fork-strings.mjs` collects
  both forms), used wherever "(s)" was.
- **Search** also finds layers and folders by name (then all their items).
- **Order:** drag a layer above or below another (the row shows where); the order is
  yours (`personal.ts` `order`; new layers first, newest first) and the map draws the
  layers in it, the top one on top (`Renderer.orderOf`, `layerOrder` in the outliner;
  map layers moved only when the order or the layers change).
- **Names typed in place:** double-click a layer's or folder's name, or Rename,
  ✎, a new layer or folder (named "New layer", "New folder 2"... ready to type); no
  more pop-up boxes.
- ⋯ → **Zoom to its items**; the place to drop a layer out of its folder shows only
  while one is dragged; a layer shows its first 200 items ("Show the other N"), so a
  big import doesn't make every change slow; rows are reached with Tab, Enter opens or
  selects, the focus survives the list being drawn again.

## My layers: drawing on the map, polished (2026-11-05)

- **While drawing** a line, an area or a graphic, a dashed line goes on to the cursor
  (an area: and back to its start), without a point at the cursor
  (`Renderer.draft(points, closed, cursor)`).
- **A graphic being drawn** (an arrow, a boundary...) shows as it will look once
  done, faint, through the points so far and the cursor, once it has enough points
  for a shape (an arrow: two): the same drawing as finished graphics
  (`Renderer.graphicDraft`, `graphicSpecs` with an opacity), at most once per frame.
- **Shift + scroll** while placing a marker, a symbol or a picture: its size (10 % a
  notch, within the resize handle's limits); while drawing an arrow: its width (a
  factor of the automatic one, a fifth of its length, so it keeps growing with it).
  The preview follows and the hint shows the size. Without Shift the map zooms as
  before. (`Tools.wheel`: a capturing wheel listener on the map's container, before
  MapLibre's own; Shift turns the wheel sideways in most browsers, so either axis.)
  The same on an item selected on the map (one, which you may change): a marker,
  symbol or picture's size, an arrow's width in metres; shown as it changes
  (`renderer.preview`), kept as one change 0.5 s after the last notch, or at once on
  a click, another selection or another tool (`Tools.resizeSelected`, `keepResize`).
- **Right-click** opens only the quick-actions menu: the item isn't selected and its
  card stays closed (Rename opens it; Delete deletes that item).
- **While placing** a marker, a symbol or a picture, it shows faint under the cursor
  (`Renderer.ghost`, an overlay kept with the draft); range rings show as a draft.
  Both go when the mouse leaves the map or the tool changes.
- **Hints:** every drawing tool says how to take a point back (Backspace) and start
  again (right-click); placing tools that right-click stops.
- **Names for people:** the kinds' labels (`ItemKind.what`, the list, the tooltip, the
  card) are "Marker", "Line" or "Area", "Picture", "Distance: …"; the lower-case
  words stay for sentences (`noun`).
- **The card** shows the item's own small picture in its header (not only symbols).
- **The right-click menu** has Lock / Unlock.
- **The selection shows the item itself.** A graphic glows under its own lines (a
  `_highlight` line layer first in each graphics source's layers, filtered on the
  selected `fid`s: `Renderer.highlightGraphics`), not a line through its control
  points; a picture, symbol or marker gets a thin box around its image
  (`Renderer.outline`, worked out on screen like the resize handle) instead of a
  circle; the box and the resize handle fit the image's visible pixels, its empty
  margins left out (`visibleBox`, cached per image: a hostile diamond's square
  image is mostly empty).
  Every handle (points, size, an arrow's width) is the same yellow.
- **Dragging moves the item**, not only its highlight: every drag (a point, an
  item's point, a size, a width) redraws it as it goes (`renderer.preview`); it's
  saved on mouseup as before.
- **A selected line, area or graphic moves whole** when dragged by its body (not a
  point handle), like a symbol; the cursor shows it (`dragging.move`, `translateGeometry`).

## The header and the about page (2026-11-03)

- **Removed from the header** (`fork/modules/layout/index.ts`, at start, so
  `index.html` keeps upstream's): "stats" (upstream's statistics of OpenStreetMap's
  completeness by country, for its contributors; a power plant's own page, linked
  from its details, stays) and "export (online)" (a paid online export; the map has
  its own, My layers' Export).
- **The about page** (`web-backend/src/fork/about.py`, replacing upstream's at
  `/about`, which described the public website): what this map is; its data
  (region, OpenStreetMap extract date, build date and source, version: the
  `oim_build_info` table; the outside datasets with items, import date, licence:
  `extra.source`; Wikidata entries kept offline); how to use it (search, the
  buttons, My layers' keys); credits and licences. Its template
  (`fork/templates/fork_about.html`) is found first, then upstream's for the layout
  (`_base.html`), with upstream's filters. Upstream's footer (with its export link)
  is left as is: it's in upstream's layout.

## Satellite imagery (offline)

Plan: `docs/plans/satellite-imagery.md`. Built by `scripts/satellite.py` (the command
line; its code is the `scripts/satimagery/` package, refactor step 16; standard
library; GDAL and pmtiles in Docker), chosen in `build-region.sh` after the
background map, or later with `scripts/satellite.sh` for the region already built
(no rebuild; both use `choose_satellite` / `download_satellite` in `lib/satellite.sh`),
shown by `web/src/fork/modules/satellite/`.

- **Areas and sources (October 2026):** Sentinel-2 can be for the region built,
  another Geofabrik region, or the whole world (`regional --world`: every land cell
  of the composite, found once in parallel and cached in
  `data/basemap/.worldcover-cells.json`, not cut; zoom 9–13, default 10). Aerial
  photos come from `DETAILED_SOURCES` in `satellite.py` (14 sources in 10 countries,
  each tested to answer tile requests; WMS sources get a GetMap per tile), cut to
  the area and to the source's Geofabrik region (`tile_blocks` over several
  outlines, in square blocks so 17 million tiles never sit in memory). Downloads
  resume (`MBTiles(resume=True)`, committed every 500 tiles; the world overview too) and drop a server's
  blank "no data" tiles (`drop_repeated`: a small tile met twice byte for byte).
  The questions are `satellite.py choose` (a JSON plan; presets for unattended
  runs) and `satellite.py steps` (one timed step each in `download_satellite`).
  Files: `<area>.sat-regional.pmtiles`, `<area>.sat-detailed-<source>.pmtiles`;
  `satellite_tiers_value` lists everything in `data/basemap/` (tile type from the
  PMTiles header), each with its credit line from `satellite.py`'s
  `attribution_for` (`URL MIN MAX|CREDIT;...` in `VITE_SATELLITE_TIERS`), the only
  list of credits; `start.sh` refreshes it every day (`select_satellite`).
- **Three tiers**, one PMTiles file each in `data/basemap/<region>.sat-<tier>.pmtiles`,
  served by the existing `basemap` service (no new service; Tegola only serves vector
  tiles):
  - *overview*, zoom 0–8: NASA Blue Marble Next Generation from NASA GIBS
    (`GoogleMapsCompatible_Level8`, checked in GIBS' capabilities): the whole world
    to zoom 8 (`overview --world`, 87,381 tiles, ~330 MB measured, about an hour) in
    one `data/basemap/world.sat-overview.pmtiles` shared by every region and
    downloaded once (`world_overview`, `overview_file` in `lib/satellite.sh`). Older
    builds made a per-region file (the world to zoom 5 and the region's bounding box
    to zoom 8); it's still used when there's no world file. Luxembourg (old per-region file): 1,369 tiles, 8 MB, 50 s.
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
- **Frontend:** `select_satellite` (`scripts/lib/satellite.sh`) writes
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

- **Only where there's imagery:** the satellite choices in Settings are greyed out
  when no imagery covers the map ("No satellite imagery here"). The bounds come from
  the background map server's TileJSON (`/<name>.json`), which needs its
  `--public-url` (`docker-compose.override.yml`).
- **A lost connection doesn't crash a download** (2026-11-06): see "Setup scripts
  tidied; safe downloads" below.

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
- **Search box in the top bar** (`web/src/fork/modules/layout/search-bar.ts`): upstream's
  search control is moved out of the left column to just right of the header
  (kept there on screens 720 px and wider; narrower, it stays on the left). It sets
  `--oim-top-bar-left` on the map container: My layers' toolbar and symbol picker
  stay centred on the map, moved right only as far as it takes to clear the search
  box (the panel measures the toolbar: `--oim-ul-toolbar-half`). No upstream file changed.
- **Settings** (`web/src/fork/ui/settings.ts`): a "settings" link in the header,
  after about / stats / export, opens a window with the map sources (background
  map tiles, Photon), which used to have their own map button. Escape, × or a click
  outside closes it.

---

## One look for what's on; selections and statuses (2026-11-05)

- **`oim-on`** (`fork/ui/panel.css`): the one look for anything chosen, switched on
  or selected, app-wide: a highlighted background (`--oim-on-background`, the map
  selection's yellow), the border, text and size unchanged (nothing moves). It
  replaces each module's own: My layers' chips (status, identity, filters,
  palette groups), identity frames, tool and toolbar buttons, the selected item in
  the list; the status board's counts; the grid route's chosen path. Not the map's
  buttons on the right: the open panel's keeps its dark ring (`oim-dock-active`), a
  coloured background would hide its icon. The layer you draw into keeps its blue
  row: it means something else ("drawing here").
- **Range rings and measurements** selected glow under their own lines and rings
  (`_m_highlight` in each measurement source, like graphics' `_g_highlight`;
  `Renderer.highlightItems`), not a circle at their centre.
- **Copies stay at every zoom** (`withoutMinZoom` in `copyLayers`): a copied
  plant, substation or line keeps the original's look, but the original's "only
  once zoomed in" conditions (small plants, low voltages) are left out of its
  filter; its other ones (a point while zoomed out, the area closer) are kept.
  Upstream's own layers still thin out when zoomed out.
- **A click on a status opens its feature** (`modules/status/click.ts`): zoomed
  out, a substation is drawn as a point while its status still outlines its area,
  and a click inside the outline hit nothing. The feature is found among what's
  drawn (same tile layer and id) and handed to the click router; the pointer is a
  hand there. Not drawn at all (its layer off in the layer switcher, e.g. Power):
  its layer is switched on, as when a search result is picked (`switcherLayersFor`),
  and it opens once drawn.
- **The coordinates** are next to the scale, bottom left.
- **Place names when zoomed in** (`modules/map-sources/labels.ts`): upstream shows
  town names up to zoom 12 and neighbourhood names at 13-14 only (online, the
  OpenStreetMap layer took over), so close in nothing said where you were. Town,
  village, hamlet and neighbourhood names now stay at every zoom (neighbourhoods
  from 13). Field names are never shown: OSM's place=locality (the cadastre's
  lieux-dits, "Holzweg", "Im Tal", dozens per village, very many in Alsace), which
  the background map files with towns as `kind_detail` "locality"
  (`LOCALITY_FILTER`, set on each style load).

## Tests

Unit tests cover the fork's own code where there's logic to get wrong; upstream's
code keeps upstream's tests. Glue code (adding layers to the map, building panels)
is checked in the browser instead.

| Where | Run | What |
|---|---|---|
| `web/src/fork/**/*.test.ts` (321) | `cd web && npm run test:fork` | Consistency (`consistency.test.ts`: every Tegola layer the fork adds is drawn and every style's tile layer is served, every fork layer is in the layer switcher, every aerial photo source is credited; every string is in `en.json`); My layers: symbol codes (identity, echelon, mobility), descriptive fields and date-time groups, the change store and moving items, history descriptions, the catalogue and its search, geometry editing; tactical graphics through the real C5ISR renderer; satellite tier parsing; search duplicates and descriptions; grid route link and route assembly; the key's feature hider; the dock |
| `web-backend/tests/fork/` (19) | `cd web-backend && uv run pytest` | Grid routes (station parsing, graph, distinct paths, route description), search helpers, My layers' id parsing and schema, search indexes |
| `scripts/tests/` (88, + 1 opt-in) | `uv run --with pytest --with httpx --with psycopg2-binary pytest scripts/tests` | `satellite.py` (tile maths, outlines, cells, estimates, MBTiles, downloads from a local test server), the symbol catalogue, extra data outlines and ICPE categories, the osmium filter, `scripts/lib/*.sh` helpers run in bash (including: every `schema/*.sql` is in `SCHEMA_FILES`, in `build-region.sh`'s order), and the setup scripts themselves (below) |

The frontend tests run in happy-dom (a simulated browser, new dev dependency) with
their own config (`web/vitest.fork.config.ts`, which stands in for the
`virtual:render-svg` module a Vite plugin builds: `src/fork/test-render-svg.ts`); upstream's `npm run test` (a real
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
  (`web/src/fork/ui/key/feature-hider.ts`). Filters rather than visibility, so it works
  alongside the layer switcher. The choice is remembered per browser; "Show all"
  undoes it. The checkbox column has a set width (`key.css`), so the boxes line up
  from one section to the next (the spare width used to be shared with it).
- **`npm start`**, not `npm run dev`: upstream renamed the command and every doc was
  out of date.
- **Docs** generally: README, `CLAUDE.md`, this file and `LOCAL_DEVELOPMENT.md`.

---

## Known limitations

- **Background map needs internet** unless you downloaded one for the region (or point
  `VITE_BASEMAP_URL` / Settings → Map sources at your own server). Planned: a local
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
| `search/search.ts` | `forkSearchSelected(result)`, `forkSearchProviders(language)` (Photon, grid references) and `dropDuplicates` (all from `fork/index.ts`); results carry the backend's result (`backend`) |
| `search/openinframap.ts` | `forkSearchDescription(result)`; `backend: result` |
| `index.ts` | `addForkTranslations()` |

**Folders by role** (`docs/plans/refactor.md`, step 4):

```
web/src/fork/
  index.ts, types.ts, config.ts   the only files upstream imports
  core/                           no UI: i18n.ts (the t() helper)
  ui/                             shared building blocks: dock, panel, settings, key/
  modules/<name>/                 one folder per feature, each a ForkModule
```

Rules, checked by `fork/structure.test.ts`:
- a module imports `core/`, `ui/`, the root files and its own files, never another
  module;
- `ui/` imports only `core/` and the root files;
- `core/` imports nothing else of the fork;
- upstream files import only `fork/index.ts`, `fork/types.ts` and `fork/config.ts`.

Modules:
- `extra` (data from outside OSM);
- `sites` (critical sites);
- `userlayers` (My layers: symbols, pictures, drawings, copies, saving, history);
- `search` (place and feature descriptions, switching a result's layer on, Photon);
- `details` (a clicked feature's details in the left panel, highlighted; a second
  click closes them; search results open the same way);
- `grid` (routes between stations, "Route from / to here" and where a power line
  goes, both added to the details with `addDetailsExtra`);
- `satellite` (imagery as the background);
- `map-sources` (its Settings section);
- `layout` (the dock for the layer list and key, the Settings link, the search box
  in the top bar).

Shared: `ui/left-column.ts` (the left-hand panels in a fixed order, whichever
module adds them: My layers' sidebar 10, the details panel 20, the grid route 30;
it also holds the one details panel and highlight), `ui/details.ts` (the details
panel; `onShow` listeners, e.g. the route folds itself; `addDetailsExtra` for what
modules add to a feature's details), `ui/highlight.ts`, `ui/dock.ts`, `ui/panel.ts`
and `panel.css` (one look for panels),
`ui/settings.ts` (modules add sections with `addSettingsSection`, placed by
`order`). The key's checkboxes (`ui/key/toggles.ts`) are added to upstream's rows
after they're built, working out what each row hides from its swatch, so upstream's
key code is unchanged.

**Adding a feature** = a new folder in `modules/` plus a line in `MODULES`.

**Translations.** The fork's English strings are in `web/src/fork/locales/en.json`,
added to upstream's at startup (`i18next.addResourceBundle`), which also lets the
fork override an upstream string. Upstream's `web/locales/` is untouched. Fork
code uses one helper, `t(key, English, values)` from `web/src/fork/core/i18n.ts`,
never HTML-escaped (the fork puts text on the page as text), so names with `&` or
quotes show as typed; `npm run fork-strings` adds new keys to `en.json`.

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
| `web-backend/src/main.py` | `pool_pre_ping`; the fork's routes first; the fork's middleware (login) after the database's; the database middleware skips the fork's streams (`streaming_paths`) |
| `web-backend/pyproject.toml`, `uv.lock` | `networkx` (grid routes), `types-networkx` |
| `web-backend/src/config.py`, `data.py`, `views/wikidata.py` | Offline Wikidata cache |
| `web/src/index.ts`, `openinframap.ts`, `style/style.ts`, `key/key.ts`, `key/svg.ts`, `popup/infopopup.ts`, `search/search.ts`, `search/openinframap.ts` | Fork hooks (above); backend and tile URLs configurable; background switch hidden |
| `openinframap.ts` (the `GeolocateControl` removed) | The "find my location" button removed (2026-11-06, asked for). On a merge, keep it out. |
| `web/src/edit-control.ts`, `edit-control.css` (deleted), `openinframap.ts` (its import and `addControl`) | The Edit button removed: it opened OpenStreetMap's online editors (iD, JOSM), which this offline map has no use for. On a merge, keep them deleted; `remote-control.ts` stays (the validation popup uses it). |
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
