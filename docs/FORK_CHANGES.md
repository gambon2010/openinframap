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
- [Extra data (not from OpenStreetMap)](#extra-data-not-from-openstreetmap)
- [Smaller fixes](#smaller-fixes)
- [Known limitations](#known-limitations)
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
- `web/src/search/photon.ts` queries `<url>/api` on every search; tested against
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

**Map sources panel** (`web/src/map-sources/`, a button under the key): shows the
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
  almost everywhere) so `style_extra.ts` draws it with the OSM power expressions:
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
  (`web/src/key/feature-hider.ts`). Filters rather than visibility, so it works
  alongside the layer switcher. The choice is remembered per browser; "Show all"
  undoes it.
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

## Merging from upstream

Upstream files changed by the fork, and how much (so conflicts are expected here):

| File | Change |
|------|--------|
| `imposm/main.py` | Imports `places.py`; keeps the `place` tag |
| `docker-compose.yml` | Added `backend`, `basemap` and `osmium` services; `:z` SELinux labels on mounts |
| `schema/dev-init.sql` | Database from `template_postgis`, pre-installs `intarray` / `hstore` |
| `schema/functions.sql` | Function order fixed for fresh installs |
| `web-backend/create_indexes.py` | `pg_trgm` extension, trigram indexes, `osm_place` |
| `web-backend/src/main.py` | `pool_pre_ping`; `/local-images` mount |
| `web-backend/src/views/search.py` | Word-start matching, ranking, local place search |
| `web-backend/src/config.py`, `data.py`, `views/wikidata.py` | Offline Wikidata cache |
| `web/src/search/search.ts` | `Promise.allSettled`; OpenCage replaced by Photon; duplicate merging |
| `web/src/search/opencage.ts` | Deleted |
| `web/src/search/openinframap.ts` | Backend URL configurable; place descriptions |
| `web/src/api.ts`, `popup/infopopup.ts`, `openinframap.ts` | Backend URL configurable |
| `web/src/style/style.ts`, `style_base.ts`, `config.ts` | Tile URLs configurable (`VITE_*`, session override) |
| `web/src/openinframap.ts` | Map sources control; background switch hidden |
| `web/src/elements/external-links.ts` | Popup crash fix |
| `web/vite.config.ts` | Proxies backend routes, PWA exclusions |
| `web/index.html` | "export (online)" label |

Everything under `scripts/`, `tools/`, `web/src/map-sources/`, `web/src/search/photon.ts`,
`imposm/places.py`, `schema/places.sql`, `schema/eez.sql`, `schema/local-stats.sql`,
`docker-compose.override.yml` and the docs is fork-only.

After merging, check: `bash scripts/build-region.sh --region luxembourg --rebuild
--yes`, then `bash scripts/start.sh`, and try a search and a country stats page.
If the import mapping or views changed, old exports will warn that they don't match.
