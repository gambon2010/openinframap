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
- [Grid connections between two stations (prototype)](#grid-connections-between-two-stations-prototype)
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

## Grid connections between two stations (prototype)

*Branch `grid-routing`.* Pick a substation or power plant as the start and another
as the end; the map shows how they're connected over lines of **110 kV and more**
(smaller lines aren't interesting at this scale), with up to three distinct paths.

- **Network** (`schema/grid.sql`, a build step after `views.sql`): OpenStreetMap
  stores lines as drawings, not connections, so the build turns in-service lines of
  110 kV and more into nodes and edges. Lines connect only where they share a vertex
  (the same pylon); lines that merely cross in the air don't. Line ends and shared
  pylons inside or near a substation (within 100 map units of its outline, 250 of a
  point; ~65 m / ~160 m in central Europe) become that station's node; power plants
  count where no substation does. Tables `grid_node` and `grid_edge`.
- **Paths** (`web-backend/src/views/grid.py`, `GET /grid/route?from=substation/<id>&to=plant/<id>&paths=3`):
  loads the network around both ends, then uses networkx's shortest simple paths
  and keeps up to three that share at most 70% of their length (so a route that only
  swaps one parallel circuit isn't listed twice). Parallel circuits between the same
  two stations are drawn together. A station without a ≥110 kV line uses the nearest
  station on that grid within a few km, with a notice.
- **Map** (`web/src/grid-route/`): "Route from here" / "Route to here" buttons in
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
- **Details in a side panel** (`web/src/info-panel/`): clicking a feature shows its
  details in a panel on the left, under the search box and above the Grid
  connection panel, instead of a popup over the map (which hid what you clicked).
  Both panels have minimise (keeps the highlight / routes on the map, shrinks to the
  title) and close (removes them). Clicking another feature replaces the details;
  Escape closes them. (The Osmose validation popups are unchanged.)
- **Highlight of the selected feature** (`web/src/grid-route/highlight.ts`): areas
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
- **Where a line goes** (`web/src/grid-route/highlight.ts`,
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
- A station mapped twice in OpenStreetMap (e.g. a substation's outline and its site
  relation, different IDs) is matched silently if within 300 m.
- New dependency: `networkx` (backend), `types-networkx` (dev).
- **Fixes found while testing with real clicks:** substation and line popups failed
  to open at all when the backend was unreachable (the circuits lookup read from an
  empty response); they now open without circuit details. And `build-region.sh` /
  `import-db.sh` stopped the backend (rebuilding removes all containers) without
  starting it again; they now restart it if it was running.

---

## Smaller fixes

- **Upstream merge.** The upstream changes since June were merged (backend moved to
  `web-backend/src/`, SQLAlchemy + asyncpg, PWA, new languages). The fork's code was
  adapted: `src.main:app`, `postgresql+asyncpg://` URLs (`launch.sh` migrates existing
  `.env` files), and the image cache path (the repo-root `data/`).
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
| `web/src/openinframap.ts` | Map sources and grid route controls; background switch hidden |
| `web/src/popup/infopopup.ts` | Details shown in the side panel instead of a popup; feature highlight; "Route from here / to here" buttons |
| `web-backend/src/views/__init__.py`, `pyproject.toml`, `uv.lock` | Grid route view; networkx |
| `web/src/elements/external-links.ts` | Popup crash fix |
| `web/vite.config.ts` | Proxies backend routes, PWA exclusions |
| `web/index.html` | "export (online)" label |

Everything under `scripts/`, `tools/`, `web/src/map-sources/`, `web/src/info-panel/`, `web/src/grid-route/`, `web/src/search/photon.ts`,
`web-backend/src/views/grid.py`, `schema/grid.sql`,
`imposm/places.py`, `schema/places.sql`, `schema/eez.sql`, `schema/local-stats.sql`,
`docker-compose.override.yml` and the docs is fork-only.

After merging, check: `bash scripts/build-region.sh --region luxembourg --rebuild
--yes`, then `bash scripts/start.sh`, and try a search and a country stats page.
If the import mapping or views changed, old exports will warn that they don't match.
