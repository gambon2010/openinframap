# The fork's history: what changed, when and why

Dated notes, in the order features came, kept for the reasons behind them. Some
describe things since changed or removed (each says so where it happened); the
current state is in [FORK_ARCHITECTURE.md](./FORK_ARCHITECTURE.md), and how upstream's files
are changed in [FORK_CHANGES.md](./FORK_CHANGES.md). One-off changes from late
October to 7 November 2026, and topics closed since (statuses, login and sync, the
early refactors), are in [HISTORY-ARCHIVE.md](./HISTORY-ARCHIVE.md).

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
  on port 8090 (now the backend, below; the service is `satellite`). No database or rendering: it reads the file.
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

**Several areas, served by the backend** (2026-11-11, asked for: local tiles only):
the background map is no longer served by `pmtiles serve` one file at a time. The
backend's `/background/{z}/{x}/{y}.mvt` (`web-backend/src/fork/background/`, the
`pmtiles` package's parsing with each file's index cached, files read through mmap,
picked up again when they change) answers each tile from the first
`data/basemap/<area>.pmtiles` that has it: newest Protomaps edition first (from
`<area>.json`), `world` last. A border tile is in both neighbours' files, the same
tile from the same edition: sent once, nothing drawn twice. None has it: 204 (an
empty tile; `no-store`, so a browser never keeps it: an area downloaded later
would otherwise stay blank there for an hour, as happened while France's was
downloading). `pmtiles serve` can't do "first file that has it", and it's
Protomaps' program, so it isn't changed: the Compose service is renamed
`satellite` and serves the satellite imagery only (gate `/satellite/`).
`select_basemap` points `VITE_BASEMAP_URL` at the backend whenever any background
map is there (`background_areas`). The backend container mounts `data/basemap/`
read-only. Tests: `tests/fork/test_background.py`.

**Chosen in the offline maps menu** (2026-11-11): `build-region.sh` no longer asks
its own question (full / reduced / none); the menu's Add has a "Background map"
line for any area, the world included (Protomaps' file itself, downloaded
resumably with `netsafe.fetch_file`; elsewhere cut with `pmtiles extract`:
`satimagery/extract.py`, `satellite.py basemap`). **Full detail only**: a reduced
file (to zoom 13) would go blank past 13, the style's source going to 15, and
saves little for a country. Each file's edition (Protomaps' build, from
`<area>.json`) is shown, and the line is offered again only when Protomaps has a
newer one; an area inside one already there is "covered". `--basemap full` queues
it without a question (`--basemap reduced` is refused, saying why). The shell's
own download code (`download_basemap`, `basemap_size`, `choose_basemap_detail`)
is gone; `region_outline` writes the region's outline (Geofabrik's, or a local
file's bounding box) where the menu looks for it.

**Only local tiles** (2026-11-11, asked for): no online background map any more.
The frontend's default background map is the backend's `/background`
(`DEFAULT_BASEMAP_URL` in `fork/config.ts`); where nothing is downloaded the
background is empty. `VITE_TILE_BASE_URL` is no longer read (upstream's
`web/.env.example` still lists it, left as upstream's) nor written by
`launch.sh`; the backend's address defaults to `http://localhost:8001`, not
openinframap.org. `select_basemap` only removes an old `VITE_BASEMAP_URL` (the
one-file server, or the default's own address) and says which areas there are, or
that the background is empty. Settings → Map sources says "the background maps
downloaded on this computer". France's background map: 5.4 GB (by its outline;
the bounding box's 9.5 GB was an upper bound), 3 min at ~30 MB/s.

**Night lights** (NASA Black Marble: the Earth at night) was an alternative background
in upstream's layer menu. It only exists online (tiles from openinframap.org), so the
fork hid the whole Background switch (OpenStreetMap / Nighttime Lights), then
removed it (2026-11-11): its source (`style.ts`) and layers (`style_base.ts`).
The Osmose validation layer (OpenStreetMap's live error reports, online only) was
removed too, with its popup. The infrastructure layers no longer fall back to openinframap.org either
(`OIM_TILES` in `fork/config.ts`: the local Tegola, `http://localhost:7800` if
`VITE_TEGOLA_URL` isn't set).

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

**Satellite with roads, readable (2026-11-16):** it used to draw the background map's
own roads over the photos: wide white bands and pale grey dashed railways, made for a
light map, lost on bright fields and roofs. Now the satellite module draws its own
layers on the same tiles (`modules/satellite/hybrid.ts`), shown only in that mode,
right above the imagery: roads at the map's widths (thin lines were
considered, but on coarse imagery the roads would be hard to find), each with a dark
edge, motorways bright orange, main roads yellow (first pale, but pale orange was
hard to see on the photos), smaller roads white and slightly see-through, service
roads and paths from zoom 14; tunnels see-through with a dashed edge; railways black
with white dashes and a light edge; borders light red; all fading to about half from
zoom 16 to 18, where the photos show the roads. Street names are white on a dark halo
over any imagery. The map's own roads stay under the imagery, so the buildings no
longer need hiding in that mode.
Then: small roads, service roads and paths drawn at their size from zoom 14 (where
the background map has them all), a thin dark line before it (it has some from zoom
12); railways only those in use (the map files dismantled, abandoned and disused
lines, turntables and platforms as kind "rail" too); borders red on a dark edge.
The background map has no railways before zoom 11 and leaves most small roads out
before 14; some stretches of big roads are only in its zoom 15 tiles (a part of the
A35 at Strasbourg, given min_zoom 16 by Protomaps), so they're missing zoomed out.
Tunnels were first narrower (the map's tunnel widths) and at 45 %: the Maurice-Lemaire
tunnel couldn't be seen over the Vosges' forest. Then the road's own width and colour,
dashed, at 75 %: the dashes made them visible, the transparency didn't, so tunnels are
now dashed at full strength (railways: the black line dashed, no white dashes). Zoomed
out the map's widths go down to nothing, so roads were their dark edges only (black
lines) and dashes too small to see: every road now has a minimum width (motorways 3 px,
main roads 1.5, railways 2.5, links and small roads 1.5; main roads first 2.5, then
2, both a little thick), so tunnels are dashed at every zoom. Then main roads 1.25 px
and all roads three quarters of the map's widths: zoomed in, its widths are wide bands
over the photos.
Then every road but motorways at least 0.75 px.


**One set of roads for every mode (2026-11-16, plan `roads-and-railways.md`, step
1):** the plain map drew upstream's roads and railways, "satellite with roads" the
fork's, with other zooms and widths. Now the fork's (`modules/roads/`, moved from
`modules/satellite/hybrid.ts`) are drawn in every mode but "satellite", upstream's
road, railway and border layers hidden (its piers kept); which roads show at each
zoom and how wide is the same, only colours (and edges, and the fading zoomed in)
follow the background: over the map the high contrast palette's white roads with a
grey edge (all roads white, as before), grey railways with white dashes, borders a
pale red. The palette's road colours went (`map-sources/palette.ts`); "original
colours" now has these roads too. The imagery sits right above upstream's layers,
under the fork's roads (the lowest data layers, zorder -11).


**Roads zoomed out (2026-11-16, plan `roads-and-railways.md`, step 3):** below zoom 12
Protomaps merges each road into one line without its tunnel mark, leaves most small
roads for zoom 14 and paths for 14 or 15, and keeps a few stretches of big roads for
zoom 15 (a part of the A35 at Strasbourg). A dashed tunnel drawn over the merged road
would still look solid, so the companion now carries every road at zooms 8 to 13,
copied down from zoom 15 (small roads from 12, paths from 13), in a layer named
"roads": the backend drops the background map's own there (`mvt.py` reads a tile's
layers without decoding them), so the frontend needed no change. The companion was
renamed `<area>.zoomed-out.pmtiles` and its builder split: `zoomed_out.py` (a zoom 10
block per worker, each zoom 15 tile decoded once, only its buildings and roads),
`zoomed_buildings.py`, `zoomed_roads.py`, `tiles.py`; the menu's offer and command
`zoomed-out`. Measured on Strasbourg's zoom 8 tile first: 5.5 MB; the first prototype
took 9 minutes there, the build 16 s with 8 workers (geometry moved into and out of
tile units in one vectorised step, not point by point; unused features never made
into shapes; pieces joined after rounding to the centimetre, as two tiles' shared
ends differ in the last digits). France: 1,195 blocks, 227,635 tiles, 390 MB (the buildings' 56 MB included), 13 min
(the buildings alone took 6).
Then holes in the roads zoomed out (from zoom 8): pieces shorter than a pixel were
left out, and between two others (a junction, a bridge) that's a hole; they're kept.
Roads are grouped by the properties the styles read only (kind, kind_detail, tunnel,
link): a bridge or another min_zoom parted a road into several lines.


**Railways ranked; close lines as one (2026-11-17, plan step 2):** first built in the
database (an Imposm table ranked by SQL, served by Tegola), then dropped before
committing: a second source of map lines, and France would have had no railways
until rebuilt. Instead the offline maps step cuts the area's railways out of its
OpenStreetMap extract with osmium (`<area>.railways.osm.pbf`, France: 3.5 min, 20 MB,
from the build's extract still in `data/osm/`), and the zoomed out build ranks them
(main from zoom 6, branch 8, minor 11, service 14) into a `railways` layer at zooms
6 to 15 (`zoomed_railways.py`, reading the file with the `osmium` package). Two tracks
side by side looked white (their dashes out of step), and so did a motorway's two
carriageways (dashed in tunnels): up to zoom 14 (railways) or 13 (roads), a line
running alongside one kept before it is left out there (`close_lines.py`); only
stretches longer than four times the distance, so crossings and junctions stay whole.
Compared against what's kept rather than whole lines: a station's tracks each had
dozens before them (the first try ran over 12 minutes for France's railways; then
about a minute). The first France build took 63 minutes: buffering the lines near
each line together merged their areas (90 s for zoom 6 alone); each kept piece is
now buffered once, alone (4 s; France in 21 minutes, 401 MB). A railway's OpenStreetMap ways, with the same tags,
are joined end to end first (a zoom 6 tile had 5,457 lines). That build also showed
a fault from the roads' companion: where two layers share a zoom (roads and
buildings at 12 and 13, railways with both), each wrote its own tile and only one
was served; the tiles of one place are now merged into one. The small roads' thin line before zoom 14 went: they look the same
at every zoom, only thinner, their edge growing from a hairline (zoom 12) to full
(15); over imagery no longer dark.

**One map, one satellite; bold roads as data layers; trams (2026-11-17):** Settings
→ Background is *Map* or *Satellite*: *Map, original colours* and *Satellite with
roads* went (the high contrast palette is the map). The bold roads, railways and
trams are Data layers entries (*Roads and railways*, J, Y, X, off at first), each
switched alone or all at once from the group's heading (every group's heading has
that tick box now, but radio groups). Over the map the map's own light roads and
railways show again (its zooms; their white-with-grey-edge colours back in
`palette.ts`); a ticked entry hides the light ones of its kind (the map's rail
lines filtered by `kind_detail`, trams apart). Over imagery only the ticked ones
show; the fork's borders show there only (named `boundaries_`, under upstream's
Borders entry). Trams were drawn as railways: now a plain pink line (no power line's
colour), narrower, no white dashes. The bold look has one set of colours; only the
fading zoomed in over imagery follows the background.

The zoomed out build filled the memory at its end: the close lines' buffers of a
whole country's roads were all kept; each is now dropped once the last line near it
is done, and the workers are as many as the free memory allows (`worker_count`).
With the area-wide zooms run side by side in the workers, France took 11 minutes
(was 21), never under 16 GB of memory free.

**Roads by importance; trams and metro by line (2026-11-17):** the A35 through
Strasbourg showed yellow: it's the M 35 now, `highway=trunk`, which the background
map counts with main roads (orange before, from Protomaps' own zoomed out tiles,
still tagged motorway there). Trunk roads (voies express) are amber now, between
motorways and primary roads; secondary roads pale yellow, tertiary white; zoomed
out, secondary roads from zoom 10 and tertiary from 11 (Protomaps brings many in
at 9). Metro and light rail were drawn as railways: *Trams and metro* takes them,
the kinds listed once (`TRANSIT_KINDS`, checked across Python and TypeScript by
`test_one_source.py`) for the bold layers and for hiding the map's light ones.
Each line is read from OpenStreetMap's routes (the railways file now keeps the
tram, metro and light rail routes): its colour as tagged, else one from a palette
picked by its letter or number; from zoom 12 a strand per line, side by side
(`line-offset` by slot), one line for both tracks at every zoom. Trams missing in
Strasbourg past zoom 15: the tiles and the style drew them in a test page (headless
MapLibre, same tiles and layers, same screen); likely tiles kept by the browser
from an earlier build (an hour's cache). Tiles are now asked for again each time,
answered "not modified" (an ETag from the files' dates and sizes) until a file
changes.

**Kinds as key rows; light roads back; tracks joined (2026-11-17):** *Roads*,
*Railways* and *Trams and metro* unfold to their kinds, each with a tick box (key rows
hiding their layers): railways' layers split by rank, trams' by kind (main lines drawn
over the others by order, no sort key). Sidings, yards and depots start unticked: a
key row can be hidden at first (`hiddenAtFirst`), once; the user's tick stays. With
the entries unticked, the map's own roads had come back: wider, a faint edge, white
blobs at airports. The fork's layers draw both looks now (`{ light, bold }`): light
over the map while unticked (as this morning), bold once ticked, hidden over imagery
unless ticked; the map's own roads and rails always hidden, and the palette's road
colours for them removed. `layers.ts` split: `builder.ts`, `rail-layers.ts`,
`key.ts`. Twin tram tunnels near Strasbourg station showed two lines: trams' and
metros' tracks within 25 m on the ground are one at every zoom. Where a track (or
carriageway) was cut beside the one kept, the cut end now carries on to meet it
(`joined_back`): no gap at junctions, between motorway carriageways or tram lines.
Trams missing in Strasbourg at some zooms: not reproduced (same tiles and layers in
Chromium and Firefox draw them); asked for the browser's console.

**Roads drawn as Planetiler draws them (2026-11-17):** the motorways stayed choppy:
the close-lines step cut one carriageway beside the other and joined the ends back,
leaving steps and kinks at every junction; each fix added another. Looked up how
it's done: merging a dual carriageway into one line has no reliable method (centre
lines "jumble up complex junctions", OSM-dev 2019; Esri's tool excludes interchanges),
and Planetiler, which makes the background map, doesn't: it snaps each zoom's lines to
a sixteenth of a pixel, joins them end to end and drops loops and lines under a
quarter of a pixel (its LoopLineMerger, 2024). The roads now do the same (only the
simple loops: rings); the two carriageways overlap into one road zoomed out. Every
line has round ends and joins (no notch where pieces meet). Tunnels are dots of
their colour, without an edge (a dash of length 0 with round ends), no longer
dashed lines that clashed side by side. Near the German border, roads vanished from
zoom 8: the companion's roads, from France's zoom 15 tiles only, replaced the
background map's whole roads layer; in tiles across the area's edge the background
map's own roads beyond the area are kept now (`beyond_area.py`). Close tracks are
still drawn as one (railways' dashes, tram lines side by side). France: 17 minutes (the
border tiles read the background map's own roads too), 362 MB. Dotted tunnels read poorly:
tunnels are now the line in its colour, see-through (55%), without an edge. Trams
and metro wider. Railways over Paris turned white zoomed out (many lines side by
side, their dashes out of step): railways within 8 pixels (more than a line's drawn
width with its outline; was 3) are drawn as one, so each spot has one line and its
dashes show; the bold outline solid white; a little wider.

**Trams and metro drawn by LOOM (2026-11-17):** the lines' own side-by-side strands
(an offset per line on each track) jumped sideways where a line joined, stopped
short at junctions and doubled around stops. Looked up the known technique: metro
line ordering (crossing minimisation), as done by LOOM (University of Freiburg,
GPL-3.0, Bast, Brosi, Storandt 2018): `topo` merges the tracks into one network,
`loom` orders the lines on each stretch, `transitmap` draws each line in its lane,
joined through junctions, into vector tiles, a set per zoom (the lanes' offsets in
the geometry). Built in Docker from a pinned commit with the free solvers (its own
image fetches Gurobi, licensed). Lessons: LOOM keeps a line only up to its last
station, so stops and every dead end are stations; France at once took over ten
minutes in `topo` alone, a network at a time (46) four minutes; transitmap takes a
tenth of the widths given for tiles; its tiles carry the line's label, not its id.
88 of France's 91 lines come out (the build lists the others). The lanes' tiles go
to zoom 18 in a source of their own (`/background/transit`); within a zoom the map
grows the lanes' width with them (twice by the next zoom) so they keep touching.
Tunnels marked from the railways file's tunnel tracks. Zoomed out (below 12) one
plain line as before; the strands and their offsets removed.

**Lanes, railways and road clicks (2026-11-17):** junctions zoomed out showed each
join's outline across the lanes: a set's outlines were drawn lane by lane, the
joins' over the lanes; now every outline goes under every lane. Tunnels' lanes
drawn with the others (not under the roads), a full outline around a see-through
line. Railways and trams unticked show the background map's own (as the original map:
railways from zoom 11, trams from 14; its railway layers filtered to trains, trams
or both) instead of a light version. Clicking a road zoomed out showed nothing: the
zoomed-out roads kept only what the styles read; their name and numbers come along
now (a road's pieces still join, two roads stay apart, as Planetiler does). France's
zoomed-out file 449 MB (was 401). A clicked tram or metro line is highlighted whole:
a glow and the line's own lane on LOOM's tiles, filtered to the line, so it follows
every zoom and pan (not a copy of the pieces on screen at the click). First version
never showed: MapLibre takes a zoom curve only at the top of an expression (the
glow's width was "lane + 10"), and dropped the layer. Stops: from the routes' stop
members (a route listing none, its platforms), one per name within 200 m (a stop
position per direction), in the trams' tiles with the lines calling there by
letter (a route's kind can differ from its tracks'). Then: the highlight sat among the
roads layers, which the roads module moves over anything between them (its drawing
order), so the lanes covered the stops: now just above them all. Stop names drawn
on top of everything (the higher a label's layer, the sooner it gets its place: the
map's own labels pushed them out) on whichever side of the dot has room, with a
thin halo (the map labels' wide blurred one made a white box).

**Details panels by name, debug apart (2026-11-17):** a clicked lane's panel was
titled with its style layer (transit_tram_lanes_ground) and listed colour, kind and
reference; a road's its tile properties (kind_detail, network, shield_text). Now
roads, railways and trams are titled as a person names them (the number as signed,
then the name; the kind and letter) with only the copy button; the building's
"from the background map" note went. With debug on, every clicked feature's
details end with its layer, source and properties, headed "Debug info". Tunnels
zoomed out: they were marked by cutting LOOM's lanes within 15 m of a tunnel track,
but zoomed out LOOM spreads a bundle much wider, so only the middle lanes were
cut; the reach now grows with the spread at each zoom.

**Airport stand lead-ins (2026-11-17):** hooks over Entzheim's aprons, drawn by the
background map as taxiways. Upstream's map (openinframap.org) has none: its
background is a Protomaps build of March 2025, and these were mapped in August 2025
as `aeroway=taxiway` (meant: `aeroway=taxilane`). In the tiles they can't be told
from real taxiways (same properties, and the stand spokes are shorter); in
OpenStreetMap they're the untagged ones ending at a stand. Each area's taxiways are
cut from its extract (`<area>.taxiways.osm.pbf`, a second osmium pass; the extract
code shared with the railways in `osm_extract.py`); the build drops runs of
untagged taxiways under 150 m with a free end, at zooms 8 to 13 from its own roads
and at 14 and 15 by rewriting the airport tiles' roads layer (the companion's
replaces the background map's). Checked against upstream's tiles: 94 of 105 extra
pieces go, none of upstream's. Tried and dropped: keeping a short run only between
tagged taxiways (it dropped 4 of upstream's).

**The map's buttons (2026-11-17):** the map or satellite imagery became a button
(pressed: imagery; greyed where there's none, its tooltip says why), its Settings
section gone. Data layers showed the layer switcher's squares and My layers a stack
of sheets with a red dot added to tell them apart; now one line-icon set
(`ui/icons.ts`): a stack for Data layers, a pencil for My layers, a satellite. The
column in three groups: what's on the map, the view, then print, Settings, account.
Also: the details panel restyle had been served half-written by the development
server (edited in three quick writes): checked rendered since.

**Trams vanishing just below zoom 12 (2026-11-18):** MapLibre picks vector tiles by
the map's zoom rounded, so zoom 12's tiles show from 11.5, and it checks a layer's
zoom range against the tile's zoom too: the plain tram lines (to zoom 12) were left
out of zoom 12's tiles while the lanes (from map zoom 12) weren't on yet, so from
11.5 to 12 trams showed only where older zoom 11 tiles were still up. The hand-over
is now at 11.5 (`LANES_SHOWN_FROM`), and the lanes' width follows each zoom's tiles
from half a zoom before to half after (it assumed a whole zoom after). Checked
rendered at 11.4 to 12.6 after panning: trams drawn at every step.

**Critical sites: groups follow the key, gun shops gone (2026-11-18):** the groups
(made in the database, by category) counted every kind, so unticking fuel stations
left groups that zoomed into nothing. A group now carries its count per kind
(`kinds`, one string: Tegola has no per-kind fields to declare), and its layer says
which key icon each kind has; the key's hider swaps the group's count and size for
the shown kinds' sum and hides a group with none (`ui/key/counted-groups.ts`,
checked with MapLibre's expression engine). Only kinds with two or more in a place
are grouped: a lone one shows as itself. Gun shops removed (poor data); the
category is *Fuel*. Re-running `sites.sql` on a built database needs `search.sql`
after it (its view reads `site_feature`). "View on OpenStreetMap" moved to the
debug info.

**No gaps between zooms (2026-11-18):** after the trams, an audit of every layer
ending at the zoom another starts: the buildings had the same gap (the zoomed out
ones to 15, every building from 15: none from 14.5 to 15), now handing over at 14.5;
upstream's power line labels too (low zoom to 10, the rest from 10), moved on the
map by a fork module (upstream's file untouched). The rule is in
`core/tile-zooms.ts`; `handovers.test.ts` checks the whole style: no fork layer on
vector tiles ends at a whole zoom, and the upstream hand-overs are the ones moved.

**Data layers fade (2026-11-18):** the roads faded when ticked (their colours
change, and MapLibre animates paint) but every other layer appeared at once (the
layer switcher sets visibility). While the switcher sets visibilities, they now go
through a fader (`ui/fade.ts`): shown, a layer starts transparent and fades to its
own opacity; hidden, it fades out, then goes. The roads' layers opt out.

**Oil depots drawn once (2026-11-18):** Oil & Natural Gas (upstream's petroleum
sites: 3,508 pipeline substations, 376 gas sites, 301 oil sites, refineries...) and
Critical sites' fuel depots (1,401 tanks holding fuel, 7 oil storage areas) overlapped:
the 7 areas in both, 653 tanks inside an oil or gas site. Those are left to Oil &
Natural Gas (`site_feature`: 755 depots left); its facilities take the critical
sites' look (fuel colour on the map, recoloured at load, upstream's file untouched;
the depot icon at every zoom from a fork tile layer, one point per facility, the
substations aside); the key's upstream row replaced by one with the icon
(`KeySection.replaces`).

**Facility icons hidden by a key row (2026-11-18):** the oil and gas facilities had
the fuel depots' icon; the key hides by icon, and the owner had unticked fuel
depots (kept in the browser), so the new icons were hidden too ("clearing the
cache" brought them back: it reset the stored tick boxes). Each now has its own:
Critical sites' row is "Storage tank (fuel, gas)" (kind `storage_tank`, a tank drawn
for it), the facilities keep the factory. Depot areas aren't imported as sites any
more (Oil & Natural Gas's). The rule is in docs/STYLE.md and CLAUDE.md. Source notes
("Not from OpenStreetMap: open data from...") only in the debug info.

**Military in rows, icons reworked (2026-11-18):** the military category had one row;
its areas (landuse=military, 3,509 in France) weren't among its kinds, so they had no
row and fell back to the government icon. Now: military area (fence), barracks and
bases (star), offices and checkpoints (barrier), ammunition and depots (rocket),
ranges and training areas (danger), other (outlined star). Also: disused military a
fort (was a signboard), supermarkets a shopfront (two baskets before), courthouses
scales (drawn: Maki has none). New icon files need the dev server restarted (their
list is made when it starts). An entry with some key rows unticked shows partial (as
group headings do); a row ticked under an entry that's off turns the entry on.

**Police and gendarmerie (2026-11-18):** police stations sat in Health and emergency,
and half the military areas (1,764 of 3,509) held a gendarmerie station: the
gendarmerie's compounds, mapped as military areas. Now a category of its own, by
operator, else name (police=* is hardly used in France): gendarmerie (3,864),
national police (772), municipal police (1,403), other (282). A military area named
for the gendarmerie is one; an unnamed one under 5 ha with a gendarmerie station and
no army site inside is merged with the station into one item (the area, the
station's name and tags); named areas (army bases, "Quartier...") stay military, a
station inside them apart. Military areas: 1,710. Government ochre (its blue was the
police's navy), the gendarmerie a flaming grenade (drawn). "Brigade" and "Escadron" first counted as gendarmerie
everywhere: the air force's squadrons ("Escadron de chasse...") turned gendarmerie;
now they count only at a police station. Police sorted by `police:FR` first (France's tag: 3,276
gendarmerie, 1,287 municipal, 640 national), then operator, then name (CRS, Police
aux frontières, Préfecture de police national; cameras tagged police left out):
"other police" from 282 to 211, nearly all with no name or operator, now "Police
(force not given)". Customs offices (124, and 7 "douanes" mapped as police
stations) and border posts (118) joined that category, now "Police, gendarmerie,
customs". Icons: ammunition depots three cartridges (the rocket read badly), police
of no given force a plain badge (was a car).

**Disused military inside Military (2026-11-18):** bunkers mapped as military areas
(landuse=military + military=bunker: 231) showed as active. A military area or site
is disused when it's a fortification, tagged disused or abandoned, named "Ancien...",
or historic without signs of use (an in-use military type, a barracks' name, active
sites inside: some historic forts are still the army's); a bunker inside a larger
active military site stays military. Checked: the bunkers (WWII, Maginot), the
historic-only ones (ouvrages, bastions, WWI craters; Mont-Valérien kept). Disused is
now Military's last row, grey, unticked at first. The view's checks compare with the
active military sites only (comparing with every site took 12 minutes). Site areas
were near invisible over imagery (8% fill, 1 px outline): a 1.5 px outline in the
category's colour, 20% fill over imagery. Prefecture a flag over a pillared building,
social services a heart. 3D switching buildings on now switches them off again when
it ends. A group "2" seen close in came from a rebuild: zoom 14+ tiles failed while
site_feature was being remade, so the map stretched zoom 13's.

**Military sites by their names, and by the sites around them (2026-11-19):** most
military areas are tagged no more than landuse=military, so "Dépôt de munitions de
Neubourg", "Champ de tir 3" and "École Nationale de Police" were all "military
area", and a shooting club's "Stand de tir" tagged military=range a range. Names are
now read by rules, a row per kind and language (French, German, English;
`site-rules.sql`), the first matching by priority: police and gendarmerie (CRS, Garde
républicaine, police schools: to Police), clubs (left out), shooting stands, ranges
and training grounds ("Camp de ..."), schools, depots (munitions, fuel, pyrotechnie),
forts (fort, ouvrage, batterie, casemate), bases (caserne, quartier, régiment, BA 901, a
camp named for a person), radar and radio (radar, sémaphore, station hertzienne,
transmissions, écoute), offices (CIRFA, état-major, délégation). A name decides over
tags that say only "military"; police, clubs and shooting stands over any. New kinds:
forts in use, radar and radio stations, schools; "other military site"
(military=yes, 9) is a military area. Then the sites around and inside: an area (or a
disused one) with sites in use inside takes their commonest kind; an area, a disused
site or a stand inside a site in use takes the smallest one's that says more (the
Rozelier depot's areas, Hochwald's Maginot blocks inside the BA 901 ouvrage, now a
fort); a stand alone under 1 ha is a club's. Forts tagged historic but still used
(Nogent, Ivry, Portzic) are set by hand in `site-overrides.sql` (OSM id, name, kind,
why). From 1,880 military areas to 700 (580 unnamed); bases 247 → 662, depots 178 →
392, ranges 43 → 361, forts 131, radio 64, schools 28. The DGSE's and DGSI's
listening stations (Domme, and three named "Station d'écoute") are radio stations; their headquarters are
government offices (Government). Disused military is grouped apart zoomed out, in grey
discs (`site_group`).

**Twins merged, camps by size (2026-11-19):** one thing mapped twice (a building and
its grounds, a point inside its area: same name, same category, touching) showed
twice: 388 pairs ("Préfecture de l'Aube" as an office and as a prefecture, Super U
buildings, a hospital's area with a clinic point). Now the larger is drawn, with the
other's kind when its own is a catch-all (`site_kind_says_little`): 366 fewer sites.
The ambiguous names, looked up: "Camp de ..." was always a training ground, but the
small camps are garrisons (Camp des Loges: an army staff; des Matelots: headquarters
in Versailles; Sainte-Marthe: a health supply establishment; Voluceau: the Paris fire
brigade's technical services), the large ones training grounds (Mailly, Suippes,
Poteau's 9,366 ha, Vaugine in Canjuers). A camp is now a training ground from 90 ha,
else a base. Schools come before camps (Saint-Cyr Coëtquidan, the academy on its
64 km² camp); the DGA's test centres ("DGA Techniques...", "DGA Essais...") are
ranges; the English "office" rule no longer catches "Office National" (ONERA).
Camp de Cercottes, the DGSE's training centre (CPES, by press reports), a school by
hand. The three "École nationale de police" are three schools (Périgueux, Essonne,
Montbéliard), the one mapped as a police station now national police too.

**The remaining generic names, looked up (2026-11-19):** 174 named military sites were
still "Other military area". Rules added: clubs and museums left out; gendarmerie
units (EGM, pelotons, brigades de recherches/proximité), customs ("douanes": Customs),
misspellings ("Commisariat", "Gendarmie"); ranges ("tirs", aire de feu, place
d'armes, village de combat, cône de sécurité); "Terrain militaire de ..." as a camp (by
size); bases (escadre, brigade, arsenal, port militaire, appontements, mess, cercle,
military housing, sports grounds, helipads, regiments' abbreviations: 21 RIMa, 1er
REC...); depots (ateliers industriels de l'aéronautique, parcs, BSMAT, subsistances,
soutien opérationnel); radio (téléport, satellite, centre d'émission, CDC, the CROSS
rescue centres); offices (service de santé, archives, préfecture maritime, Balard);
schools (CFIM, aguerrissement; Spanish: escuela). By hand: Mont-Agel's EAR 943 (an
air-defence radar), the Navy's Cranou station (radio monitoring), BND Rheinhausen (the
German service's satellite intercept station), the Lignes de Quélern (the DGSE's
CPEOM), eu-LISA (an EU agency: Government). 74 named and 516 unnamed remain generic.

**Research, test and weapons establishments; the last names (2026-11-19):** a new kind
for the CEA's military sites (Valduc, Gramat, Le Ripault, CESTA, DAM Île-de-France,
Moronvilliers), the DGA's test centres (moved from ranges), ONERA, the Franco-German
institute of Saint-Louis, Naval Group, KNDS, the Navy's hydrographic service, the
technical sections: 111, a flask. A disused fortification inside an area in use that
says no more than "military area" now stays disused (20 casemates, Maginot blocks,
batteries showed as military areas); one inside a site that says more still takes
its kind. The rest, looked up: ELOCA (the Commissariat's logistics establishments) and
Etamat depots, the SEO's technical expertise centre research, Centre Marine de
Houilles a base; by hand Etamat Le Mans (closed 2018: disused), Terrain Billard (the 4e
RMAT's detachment: depot), Gare de Sainte-Rosaline (Canjuers' military rail access:
depot), the Lazaret at Saint-Mandrier (the Navy's schools); a gendarmerie operator
counts anywhere in its name (Cité Delpal: the armoured mobile gendarmerie); names
"Bunker", "Unterstand", "Abri de combat" disused. 30 named sites stay "Other military
area": place names nothing online explains (Piste de Vergière, Bois de Nice, Plateau
de Mesdoun, Anse Saupin, Penn an enez...), unexplained acronyms (ESCAT, E.S.C.A.G.N.,
CPA), the civil defence's bomb disposal centres, oddities ("Obus", "effondrement").

**Military airfields, naval bases; the generic areas classified (2026-11-20):** bases
split three ways: military airfields (air force, naval and army aviation: 49, a
green plane), naval bases (29, an anchor) and barracks (the army's and joint ones).
An aerodrome that is the army's alone (`military=airfield`, a military landuse) is
a military airfield, not an airport any more; its row is listed under Transport and
Military with one tick box, drawn by both categories' layers and never grouped, so
hiding Military doesn't lose the airfields from Transport (`shared_kinds` in
`modules/sites/style.ts`). A civilian airport with a military part stays an
airport, the part (Hyères's naval air base, Rennes's army aviation) a military
site. The airfield's unnamed pieces (guard posts, plots: about 60) aren't drawn; its kind
isn't passed on (a stand on Coëtquidan's airfield stays the school's, the Île du
Levant range with its heliport a range). Ex-BA Dreux-Senonches and Souge's
aerodrome (abandoned) are disused; BA 921 Taverny and 942 Mont Verdun (command
centres, no runway) offices, Hochwald (BA 901) a fort, by hand.
The generic areas, 493 to 316: a bug made `landuse=military` ignore its
`military=range/barracks...` (the importer keeps one key per object: 131 sites);
their names still come first (a "DGA Essais" tagged range is research). A radio,
radar or signal tower inside makes an area a radio station (the Navy's sémaphores,
mapped as its watchtowers; not mobile phone masts); touching a named site in use
makes it that site's annex; only disused sites in or around it, disused. Names
"ex-..." are disused. A gendarmerie compound mapped as barracks is one too.
Later that day, former military airfields (a grey plane) instead of disused
fortifications, which are unticked at first: a disused military site that was an
aerodrome (tagged so, or a disused or historic one, or named an air base). There are 6:
Dreux-Senonches, Souge, Vouziers-Séchault, Broyes-lès-Pesmes (the Graves radar
inside is drawn on its own), Grostenquin (`disused:aeroway`: no longer taken as in
use), Bapaume-Grévillers. Closed civil airfields (tagged disused or abandoned, or named
"Ancien aérodrome": 9) were shown as airports; now a grey plane too. Neither has a
key row of its own: the airfield rows (civil, military) show and hide them too (a
key row can hide several icons), so ticking both shows every airfield.
Clean-ups: the flying units' points inside an air base (Ochey's squadrons, 10) no
longer draw a second plane; gendarmerie barracks mapped as army bases (110) are
the gendarmerie's: a "Caserne ..." or "Quartier ..." under 10 ha with its station
inside and no named army site in it, under its own name (its unnamed housing blocks
not drawn); a site saying "gendarmerie" in its other name, description or
`military_service` ("Quartier Savary"); the military sites inside a gendarmerie
site (Melun academy's quarters), mostly over it (Caserne Vérines mapped twice), or
unnamed touching it aren't drawn; Quartier Richemont (Nantes's brigade) and Foix-
Lescun (Tarbes) by hand. The one left touching a gendarmerie caserne, Rennes's
Quartier Margueritte, is the army's defence zone staff. The compounds' check for a
named army site inside first scanned every site per compound (15 minutes instead
of 4): a flag on the military sites instead.

---

## Building outlines (2026-11-11)

*Data layers → Background map → Buildings* (`fork/modules/buildings/`, letter `K`,
off by default) draws every building's outline from zoom 15, over the map and over
satellite imagery, from the background map already downloaded (Protomaps'
`buildings` layer): nothing new to fetch. Only zoom 15 tiles hold every building:
lower zooms keep a few landmarks (central Paris: 5 at zoom 11, 46 at 14, 730 at 15),
so they aren't shown below 15 by themselves (large buildings at lower zooms: below, since removed).
The outlines aren't clickable (a click in a town would always land on one): the
module removes their details handler.

My layers' copy tool copies a clicked building (the layer switched on) as an
**ordinary area** (`kind: 'drawing'`, the colour for new items, named "Building",
its height kept; editable), not a fixed copy. A building cut at tile edges comes in
pieces (one per tile, overlapping a little): `fork/core/buildings.ts` joins them
(`polygon-clipping`, a new dependency) from the loaded tiles. Copied once per layer
(Protomaps' building id). Protomaps' ids aren't OpenStreetMap's numbers (checked), so
no link to OpenStreetMap is kept. Tests: `core/buildings.test.ts`, the copy tool's
in `map/tools.test.ts`.

**Refined the same day** (asked for): the outlines are **clickable anywhere inside**
(an invisible fill under them) and open the building's details (height, where it
starts if it's raised, its area on the ground worked out from the joined outline,
holes taken out; a "part of a building" for `building_part`). The outline is **white
over satellite imagery** and dark over the map (`followBackground` in
`services/background.ts`, which now also tells its listeners when imagery becomes
known). Every map feature's details have a **"Copy into “<layer>”"** button (the
layer you draw into), sharing the copy tool's code (`copyFeature`, which says
whether it copied or found it already there).

**One way to make things clickable** (`core/map-style.ts`): `clickableArea(id, …)`
(an invisible fill `<id>_hit` and the outline `<id>`) and `hitLine(id, …)` (an
invisible wide line `<id>_hit`). The extra data's thin power lines and gas pipes,
made clickable by hand before, use `hitLine` now; buildings use `clickableArea`.
`groundArea` and `formatArea` moved from My layers' measuring to `core/geo.ts`
(buildings need them too; measuring re-exports them).

**Large buildings zoomed out** (asked for): from zoom 12 to 14, each zoom the
buildings about 4 pixels across or more (≥ 10,000 m² at 12, 2,500 at 13, 600 at 14);
every building from 15 as before. A build step,
`web-backend/src/fork/background/large_buildings.py` (in the backend's image: the
`pmtiles` and `mapbox-vector-tile` packages, 8 processes), reads every zoom 15 tile
of the background maps with buildings (not the world to zoom 8), keeps the
buildings of 600 m² or more and the pieces cut at tile edges, joins pieces by id
in PostGIS, measures them on the ground (`oim_ground_area`) and replaces
`basemap_building_large` (EPSG:3857; `schema/buildings.sql` makes it empty in every
build, so Tegola always has it). Tegola's new `buildings` map serves it
(`tegola/layers.fork.yml`, `buildings_large`, the size per zoom in its SQL). France
and Luxembourg: 1,025,024 buildings, 382 MB, ~10 minutes (1.1 million tiles). It runs
after a build (`large_buildings` in `lib/db.sh`, from `offline_background`) and
after a background map with buildings is added or removed in the menu (a
"Large buildings" job; `satellite.py large-buildings`), then Tegola is recreated
(it caches tiles). The frontend draws them with the same `clickableArea` and
colours (`modules/buildings`: a `buildings_large` source, zooms 12–15); their
details use the area measured whole. Tests: `tests/fork/test_large_buildings.py`.

**Exact copies at every zoom** (2026-11-12): zoomed out, a building's shape is
Tegola's, simplified for the zoom; a copy now asks the backend for the exact outline
(`/background/building/{id}?lon=&lat=`, `background/buildings.py`: the building's
pieces in the background map's zoom 15 tiles around the point, joined; `exactOutline`
in `core/buildings.ts`). Making the zoomed-out tiles from the zoom 15 ones on
request was tried and measured (13 s for one zoom 12 tile over Paris): not done.

**Large buildings removed** (2026-11-16, asked for: one source, not two): buildings
show from zoom 15 only, from the background map. Gone: the build step
(`large_buildings.py`, `schema/buildings.sql`, `large_buildings` in `lib/db.sh`, the
menu's "Large buildings" job, `satellite.py large-buildings`), Tegola's `buildings`
map and the frontend's `buildings_large` layer. Every building in the database
instead (Tegola the one source) was measured first and not done: France holds ~54
million building pieces in Protomaps' zoom 15 tiles, 279 bytes each in PostGIS
(Paris) → 12–15 GB, a 30–60 min build step; size-filtered tiles at zoom 12–14 took
36–55 ms over central Paris, every building 0.6–1.7 s (zoom 13, 12), and zoom 15
113 ms against a few for the file. Protomaps' own tiles below 15 have no buildings
(its tile build leaves them out), so the background map can't show them without
remaking its tiles. The exact-outline endpoint stays: a copy also gets the pieces in
tiles the browser hasn't loaded.

**Buildings zoomed out, inside the background map** (2026-11-16, asked for; the plan:
`docs/plans/archive/zoomed-out-buildings.md`): zooms 12 to 14 show the buildings
big enough to see (≥ 10,000 m² at 12, 2,500 at 13, 600 at 14) from the background
map itself, no database or Tegola. Protomaps' tiles below 15 hold no single
buildings: its build merges them into blocks (central Paris at zoom 13: 15 shapes,
the largest 1.7 km² from 2,998 buildings), the background map's pale city texture,
kept as it is. `web-backend/src/fork/background/zoomed_buildings.py` reads an
area's zoom 15 tiles one zoom 12 block (64 tiles) at a time, 8 processes, joins each
building's pieces by id, measures it, and writes the block's zoom 12–14 tiles (one
layer, `buildings_large`: kind, height, area_m2, Protomaps' id) into
`<area>.buildings.pmtiles`, written under a hidden name then renamed. France: 6 min,
17,793 blocks, 155,311 tiles, 56 MB, 0.9 GB of memory; Luxembourg 4 s. The backend
appends the area's companion tile to the background map's own at zooms 12–14 (a
tile is a list of layers: two laid end to end are one; its own layer name, as the
vector tile format forbids two layers of one name): 9 ms for a joined tile over
central Paris (unzip, join, zip again), 1–2 ms elsewhere, 0.2 ms untouched. Made
right after each background map download (`extract.py`, in the backend's image,
data/basemap/ mounted writable at /work); for one downloaded before, the menu
offers *Buildings zoomed out* (`satellite.py zoomed-buildings --area`); removing an
area removes it. Frontend: a second `clickableArea` on the same `basemap` source,
zooms 12–15; details take `area_m2` from the tile. `Archive.tile_ids` (the file's
tile ids from its directories) is shared by the build step. Tests:
`tests/fork/test_zoomed_buildings.py`, `test_background.py` (appending),
`scripts/tests/test_maps.py` (offer, removal), `test_one_source.py` (the companion's
name and zoom agree between the scripts and the backend).

**A click selects the whole building** (2026-11-16, asked for: no "part of a
building"). Parts (towers, wings, a dome: `building_part`) are drawn in their own
layer (`buildings_parts`) under whole buildings (`buildings_outline`, now only
`building`), so a click or a copy inside a building finds the building, whichever
part it lands on. Parts with no building mapped around them (checked around the
Panthéon: 12% of 4,350) are still clicked on their own, shown as "Building". Test:
`modules/buildings/index.test.ts` (the order clicks rely on).

**A click on nothing deselects** (2026-11-16, asked for): a click on the map that
does nothing else closes the details (`modules/details/deselect.ts`). Kept: dragging
(MapLibre sends no click), a double-click (it zooms: the first click waits 300 ms),
a click that only closed a right-click menu (`menuJustDismissed`), a click a tool
or My layers takes (`mapMode.takes`), a click on a feature or near a line
(`nothingClickableAt`, near-click.ts). Clicks in panels never reach the map.

**CI's scripts job fixed** (2026-11-16): ruff run from the repo root (as CI does)
took the scripts' own modules (`netsafe`, `satimagery`, ...) for outside packages and
wanted their imports sorted otherwise; `scripts/ruff.toml` (`src = ["."]`) tells it.

**The world zoomed out** (asked for): every country's borders, names and coasts
were missing on low-zoom imagery, the background map covering only the areas
downloaded. The menu offers the whole world's background map to zoom 8 (560 MB;
zoom 7: 190 MB, 6: 45 MB), cut with `--bbox` and `--maxzoom`
(`satellite.py basemap --area world --maxzoom 8`), next to the whole world at every
zoom (~140 GB). The backend tries it last, so detailed areas win where they have a
tile. Downloaded here. It comes **by default**, once: with any download from the
menu (`with_world_background`, like Blue Marble with imagery) and in every build
(`prepare_background_map` queues it; `--basemap none` leaves it out). Building
outlines a little thicker (asked for).

**Roofs over imagery (2026-11-16):** white outlines alone floated over blurry
imagery and read like roads. Over imagery the whole buildings (and the zoomed out
ones) are now filled like roofs (a muted tile colour at 30 %, first 70 then 45 %; their clickable inside
doing it) with a small shadow 2 px down and right on screen; outlines dark
everywhere. Parts get no fill (they lie inside buildings: it would darken them), so
their outlines show faintly through the roof.

**3D view (2026-11-16):** a **3D** button among the map's buttons (`modules/view3d/`,
the state in `services/view3d.ts`, kept per browser). On: the map tilts to 55°, right
or Ctrl drag (two fingers) tilt and turn it (upstream turns that off; the fork turns
it on only in 3D), the Buildings layer is switched on, and whole buildings (and the
big ones zoomed out) rise to their height (8 m when the map has none), in the roofs'
colour; their flat roofs, shadows and outlines are hidden then. The raised layers
follow the layer switcher's Buildings entry for visibility, so they're hidden outside
3D by a filter that matches nothing. Then parts: the outer building of one mapped with
parts usually carries the tallest height, hiding its parts in a box, and the map's
data doesn't say which buildings have parts. So they're found in the browser
(`modules/buildings/parts.ts`): each time the map settles in 3D, the parts not seen
yet are looked up inside the loaded buildings (the middle of the part's box, inside
the building's shape: `@turf/boolean-point-in-polygon`); those buildings are left out
of the raised layer by a filter on their ids, and every part rises from where it
starts to its own height. Printing
straightens the map first (scale and grid reference hold only seen from above).
Parts are drawn only in 3D (flat, the building's outline is enough). The 3D button
pressed looks like the other map buttons (one helper, `showPressed` in
`ui/map-button.ts`, the class `oim-pressed`, was `oim-dock-active`). Off, the map is
flattened and locked flat (`maxPitch` 0, two-finger tilt included); a 3D view kept
from before broke the button at load (the layer switcher was called before the style
existed), so it never flattened. Buildings' drawing moved into
`modules/buildings/look.ts`. A clicked building's
highlight is its pieces from every loaded tile joined (it was the clicked tile's piece,
cut at the tile's edges); the copy still asks the backend (it can reach tiles not
loaded).

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

## Terrain (docs/plans/terrain.md)

- **Downloaded with the background map (2026-11-20):** the area's elevations cut
  out of Mapterhorn's terrain tiles (IGN's RGE ALTI and LiDAR HD in France,
  Copernicus elsewhere; lossless, so good for computing too) to zoom 13 into
  `<area>.terrain.pmtiles` (`offline_maps/terrain.py`). Not a choice: it comes with
  every background map; the menu offers it for one made before. Merging the parts
  needs go-pmtiles 1.31 (`merge`). The dry runs' size reading moved to `pmtiles.py`
  (`dry_run_size`), which also reads a file's tile count. France: 5.6 GB.
- **Hill shading (2026-11-20):** the backend serves every area's terrain together
  (`/terrain/{z}/{x}/{y}.webp`, `web-backend/src/fork/terrain/`; through the gate);
  `modules/terrain` draws MapLibre's hill shading from it (four light directions
  blended, the main one north-west), under the background map's roads and
  buildings over the map, right above the photos and fainter over imagery; Data
  layers → Terrain → Hill shading, on at first.
- **3D relief (2026-11-20):** the 3D button raises the ground from the same
  elevations (true heights, a second source as MapLibre draws relief and shading
  better from two), under a sky with haze at the horizon; tilting up to 75° (was
  60°) to look along valleys. Source names shared in `core/terrain.ts`.
- **Contour lines (2026-11-20):** made by the backend as tiles are asked for
  (`/terrain/contours`, `terrain/contours.py`, contourpy), as on US military maps
  (index lines every fifth, labelled; 100/50/20/10 m by zoom); Data layers →
  Terrain → Contour lines, off at first. Generalised like a paper map's: the heights
  smoothed first (a Gaussian of 3 pixels: at 1.5 the LiDAR's ditches and
  embankments left flat ground's lines ragged), lines under 8 pixels dropped,
  points within half a pixel simplified away (tiles a quarter of the size). About
  60 ms a tile once its heights are read. Pillow and contourpy declared in the
  backend (bokeh had brought them).
- **Supplementary and depression contours, the height under the cursor
  (2026-11-20):** supplementary contours (half the interval, dashed) on level ground
  from zoom 12, where the regular lines would be more than an inch (96 px) apart;
  depression contours (closed round lower ground) ticked on their downhill side, the
  ticks a wide dashed line pushed off the contour (no icon: it takes the
  background's colours); the browns are the USGS US Topo specifications'. The
  smoothing is now SciPy's `gaussian_filter` (was a convolution by hand: the new
  "Reuse before writing" rule, CLAUDE.md; OpenTopography's method). The coordinates
  box shows the ground's height (`/terrain/elevation`, asked when the cursor rests
  120 ms; Mont Blanc 4806 m), and now uses the standard's tokens. A clicked thing's
  details get its height too (a point's; an area's at its middle when that's inside
  it; not a line's), through `services/elevation.ts`, shared by both.
- **Contour lines on top (2026-11-20):** in towns they came out in short pieces.
  Tracing from a coarser zoom (maplibre-contour's `overzoom`) and a longer minimum
  length were tried and changed nothing: the background map's buildings, drawn over
  the lines, were cutting them. The lines now go on top of everything (the owner's
  choice); the hill shading stays on the ground. Each part of them (index lines,
  heights, intermediate, supplementary, depression ticks) has its tick box.
- **The coordinates box (2026-11-20):** also the ground's slope (Horn's method, as
  GDAL's `gdaldem slope`, from `/terrain/elevation`), the magnetic declination
  (WMM2025, `magvar`) and the distance and bearing from the last click (in the north
  chosen for measuring). For that the measuring helpers moved out of My layers: the
  Earth's geometry and the norths to `core/earth.ts` and `core/north.ts`, the
  measuring preferences to `services/measure-prefs.ts`.
- **Where data comes from, in the debug info only (2026-11-20):** the extra data's
  note (its source and licence) was already moved there, but kept its orange box;
  it's now written like the debug info's hints, and its "Source updated" row joined
  it (the owner: notes about a data source only in the debug part). Nothing else in
  the details names a data source (upstream's "Source" is a plant's energy).
- **Line of sight (2026-11-20):** a My layers measurement of two points (👁, key I):
  the backend (`/terrain/sight`, `terrain/sight.py`) samples the ground every 6 m
  and counts the Earth's curvature less refraction as GDAL's viewshed does (6/7 for
  light; radio is 0.75, for the radio mode later). The line is green where the
  ground is seen, red where it's hidden (each answer asked once per points and
  heights, `map/render.ts`); its card says seen or hidden and where, draws the
  profile (a plain SVG: a chart library would only wrap one polygon) and takes the
  observer's and target's heights. The line tool got a point limit (two). Height
  and slope are now read pixel by pixel from the cached tiles (a 3 × 3 tile mosaic
  per point was too slow for thousands of samples). Checked: Mont Blanc seen from
  Fourvière.
- **Turf for the Earth's geometry (2026-11-20):** `core/earth.ts` and `core/geo.ts`
  (bearings, destinations, great circles, circles, lengths, distances, areas) now
  call Turf's modules instead of formulas by hand ("Reuse before writing"); the
  tests passed unchanged. Terra Draw for My layers' drawing went to the backlog.

## Refactors (2026-11-20)

- **One PMTiles reader for the backend** (`src/fork/pmtiles_files.py`): `Archive` and
  `ArchiveFolder` (the files of one kind, reopened when they change) for the
  background maps, the trams' lanes and the terrain (three copies of the folder
  cache before).
- **`sites.sql` in three:** `site-kinds.sql` (what a site is), `sites.sql`
  (`site_feature`), `site-points.sql` (the grouping); rebuilt, every kind's count
  the same.
- **My layers' renderer** (580 → 398 lines): `render-measures.ts`,
  `render-graphics.ts`, `drafts.ts`; the store (`yoursOn` to `reconcile.ts`, the
  measuring preferences' syncing to `personal.ts`) and the layers' definitions
  (`overlay-layers.ts`) trimmed.
- **`docs/HISTORY.md`** 3,167 → 1,914 lines: the one-off sections from late October
  to 7 November in `HISTORY-ARCHIVE.md`, word for word.
- **The scripts' Python environment** (`scripts/pyproject.toml`, uv, now required):
  `scripts_python` (`lib/python.sh`) runs offline-maps.py and the build's Python;
  mercantile, the `pmtiles` package and `filelock` replaced our tile maths, header
  reader and lock (the lock file is the same, so a download started before is still
  seen); `netsafe`'s retries stay (they wrap any call, not only HTTP). The 38 type
  errors in the scripts fixed and mypy added to CI. The setup scripts' tests get a
  fake `uv` that runs the scripts' own Python. The "is uv installed?" branches
  (extra data, the Wikidata cache) removed.
- **The imagery found at runtime:** the scripts write the imagery list as a file
  (`data/offline-maps/imagery.json`, after each download or removal and at start);
  the backend serves it (`/imagery`) and the map reads it when it opens, instead of
  `VITE_SATELLITE_TIERS` baked into `web/.env` (imagery downloaded while the app
  runs shows on a page reload, no restart). The list names files, not servers: the
  map builds the tiles' address (`IMAGERY_URL`). Credits no longer need to avoid
  `;` and `|`.
- **One way to declare the scripts' packages:** `extra_data.py` and `fetch_images.py`
  lost their inline metadata; their packages (httpx, psycopg2) are in
  `scripts/pyproject.toml` and they run through `scripts_python` too.
- **The background map's build steps apart from its serving:** what's made once after a
  download (the zoomed-out companion, LOOM's tram lanes, their tile geometry) moved
  from `background/` to `background_build/`; `background/` keeps what answers
  requests (the tiles, the tram lanes, building outlines). They still run in the
  backend's image (shapely, osmium), now as `python -m src.fork.background_build.<module>`.
- **The satellite imagery served by the backend; the `satellite` service removed:**
  go-pmtiles' `pmtiles serve` (its own container, port 8810, a gate route) replaced
  by `/satellite/<file>/{z}/{x}/{y}.<format>` in the backend (`imagery.py`), on the
  same reader as the background map and terrain (`pmtiles_files.py`: Protomaps'
  `pmtiles` package decoding, our directory cache). Measured on 300 tiles (IGN zoom
  15, Sentinel-2 zoom 11), warm: 0.42–0.53 ms a tile against go-pmtiles' 0.41–1.12 ms,
  the same bytes. The four tile routes (background, trams' lanes, terrain,
  imagery) share one way of answering (`tile_answers.py`). The scripts keep the
  go-pmtiles image for cutting and converting files; an export no longer carries it
  (nothing offline runs it).
- **`data/` in three parts** (docs/plans/portable-drive.md, step 1): `data/map/` (what
  the app needs: offline maps, Wikidata cache, exports; the backend mounts it
  read-only), `data/local/` (this installation's: gate certificate, My layers' copy
  during an import, checks, logs), `data/downloads/` (downloaded again when needed:
  OSM extracts, extra data, EEZ). The names once per language (`lib/common.sh`, the
  new `scripts/data_folders.py`, the backend's `paths.py`), a test checking they
  agree. Moved on disk the same day. A bug found doing it: the offline maps' queue
  saved full paths, so Resume downloaded into the old folder; it now saves paths
  inside the maps folder relative to it (`{maps}`), with a test.
- **Installers for computers without the internet** (`scripts/fetch_installers.py`,
  `data/installers/`): Docker for every supported Ubuntu, Debian, Fedora and RHEL
  family version on Intel/AMD and ARM (Docker's documented "install from a package":
  the newest of each package in its repository's listing), its standalone programs
  (Docker's "install from binaries") with Compose, Buildx and Docker's own systemd
  units for any other Linux, Docker Desktop (from its update feed) and WSL's offline
  installer for Windows, and Node.js, uv, uv's Python builds (where
  `UV_PYTHON_INSTALL_MIRROR` reads them) and 7-Zip for Linux and Windows. Each from
  its project's own site; nothing invented but the choice of files.
  `install-docker.sh` picks the packages from os-release (Rocky, Alma, CentOS on
  RHEL's), else the standalone programs. The setup scripts point there when a tool
  is missing; `start.sh` and `import-db.sh` now tell "not installed" from "not
  running" (`require_docker`).
- **The frontend built into the gate's image** (docs/plans/portable-drive.md, step 2):
  the gate's Dockerfile has two targets, `gate` (the page from Vite's dev server, as
  before) and `built` (a `node:26` stage runs `vite build`, nginx serves the files:
  no Node.js needed), as two Compose services (`gate`, and `gate-built` in profile
  `built`); `GATE_FRONTEND` picks the page config through nginx's templates. Two
  images rather than one because `up_services` rebuilds at every start: one image
  would have run `vite build` at each `start.sh` after a frontend change. The export
  now builds and saves both gates (it didn't build the gate before). Checked: both
  configs valid, the built page rendered with no errors (a throwaway copy on another
  port, the login check off).
- **The map's service worker kept away from the gate:** the built page installed
  upstream's service worker (vite-plugin-pwa), which answers every page visit from
  its own copy: `/login` got the map (Log out, or an ended session, looped between
  the map and itself) and an old build kept showing after going back to Vite's dev
  server. The gate now answers `/registerSW.js` with nothing (never installed) and
  `/sw.js` with a worker that removes itself (`gate/service-worker/sw.js`,
  vite-plugin-pwa's `selfDestroying` pattern), in both of its ways; no upstream file
  changed. Checked in Chrome: the old image's worker, then the new gate on the same
  address: within a second the worker was gone, its copy deleted, the tab reloaded
  from the gate, `/login` reaching the gate; the page's settings kept.
- **The built gate on Compose's network** (docs/plans/portable-drive.md, step 3):
  Docker Desktop (Windows) has no host network by default. `gate-built` publishes
  8800 and reaches the services by name (`backend:80`, `tegola:80`, through Docker's
  DNS with nginx's `resolve`, so a recreated container is found again). The
  development gate stays on the host's network, not as planned: reaching Vite from
  Compose's network (`host.docker.internal`, tried: Fedora's firewall lets it
  through) would need Vite listening beyond localhost, a way around the login for
  anyone who can reach that address. The gate's files are now per mode
  (`gate/modes/<mode>/page.conf`, `services.conf`, chosen by `GATE_MODE`, which
  replaces `GATE_FRONTEND`). Checked: both configs valid; the built gate on
  Compose's network beside the running one, `/login` answered by the backend by
  name, the protected routes asking for a login.
- **The gate serves only the built page** (2026-11-21, asked: "keep only the built
  version on docker"): one gate image, on Compose's network; the dev mode, its
  `modes/` and `templates/` removed. Development is back to opening Vite's dev server
  (http://localhost:5173, `start.sh` opens it), which now passes on the gate's paths
  (`/tegola/`, the backend's routes, login) with the Host kept, so the page's
  addresses (`config.ts`, the page's own origin) work there as through the gate; a
  test checks the two lists agree. Checked: through Vite, the login page, Tegola,
  and the backend asking for a session; the gate the same on 8800.
- **"Place d'armes" no longer a range:** in France it's a barracks' parade ground
  (three in France were drawn as ranges, two now with their barracks); "Place d'armes
  de ..." stays one (Switzerland's training grounds, Bure). A test runs the name rules
  on names.
- **3D turns the hill shading on over the map** (2026-11-21, asked: the relief was
  hard to see on the map's flat colours), as it does the buildings, and off again
  when 3D ends if it switched it on; not over imagery (photos have their own
  shadows). The Hill shading entry's id moved to `core/terrain.ts` (modules don't
  import each other).
- **The Data layers panel follows every change of the entries** (bug: 3D switched the
  buildings on and off without the panel's tick box following; search and the roads
  the same): `followChanges` (`ui/data-layers.ts`) redraws it after every
  `setVisibility` and every reading of the address, whoever made them. A test runs it
  on the real layer switcher.
- **A hidden key row hides the sites' areas too** (bug: unticking "Range" hid the
  ranges' icons but left their areas): the areas are in other tile data
  (`sites_area`) than the icons (`sites_point`); a layer can now say whose features
  it draws (`SAME_FEATURES_AS`, `ui/key/feature-hider.ts`), and the sites' area
  layers say they're the icons'. Ranges' icon: a pistol instead of the skull and
  bones (asked).
- **A click on a building zoomed out took in a whole block** (bug: hundreds of
  houses highlighted, "13.7 ha"): below zoom 15, Protomaps' tiles hold blocks of
  buildings merged into one feature carrying one building's id, and MapLibre still
  drew the whole-buildings layer from the zoom-14 tile. Its layers and the gathering
  of a building's pieces now keep only tiles from zoom 15
  (`FROM_TILES_WITH_EVERY_BUILDING`, `core/buildings.ts`: MapLibre checks a filter's
  zoom against the tile's). Checked in the app: the factory at Mertzwiller, 3.8 ha
  alone.
- **Hill shading over imagery** (asked: it "looks a bit weird"): shadows only, lit
  from the south-south-east, where the sun is in the photos; it laid a milky veil
  (white highlights, warm grey shadows) and lit from the north-west, against the
  photos' own shadows. Four looks compared on the same view (none, before, shadows
  only, shadows from the sun); the map's look unchanged.
- **A military base's parts** (asked: sub-parts drawn like their base overwhelmed
  the screen, and the same depot's bunkers were buildings in one place, sites
  with icons in another): `schema/fork/site-parts.sql` gives each military site
  inside a larger one its base (the smallest around it) and what it is as a part.
  Of another kind than its base: drawn as any site (its own marking kept). A
  building (tagged one, or a bunker, casemate, cupola, embrasure, barracks, office,
  checkpoint, hangar mapped as military only): drawn as a building from zoom 15, no
  icon, titled with what it is ("Bunker") and whose part it is. The rest: a thin
  dashed outline from zoom 15. Zoomed out, a base's building and zone parts aren't
  drawn nor counted in the numbered discs; the base's details count them ("120 ×
  Bunker"). France: 1,319 building parts, 149 zones, 319 of their own kind. The
  build finds them from the sites' own outlines (the background map's buildings
  are OpenStreetMap's, drawn under ours: no matching needed). Checked in the app:
  Rozelier (one icon zoomed out instead of ~20 discs; its 120 bunkers as buildings;
  a bunker's and the base's details), Neubourg over imagery, Camp de Souge.
- **The radio rule read only a tower's main tag** (`man_made=tower`/`mast`), not
  what it's for (`tower:type=communication`: 41,000 masts): military areas around a
  radio tower stayed "Other military area" (Issoudun's transmitter: 12 of its 13
  fenced plots now "Radar, radio, signal station").
- **The backend made the images' folder at start** (bug, from the data folders'
  split: `data/map/` is read-only in its container): a new installation's build
  stopped at "Creating search indexes" (the real Luxembourg build test caught it).
  It no longer writes there: `ImagesFolder` (`wikidata_offline.py`) serves the
  pictures, not found until the scripts make the folder; a test pins that
  Starlette's StaticFiles fails every request while its folder is missing.
- **The base parts, second round** (the owner's screenshots): a camp's barracks and
  office blocks (Mourmelon: tagged military=office/barracks, their kind other than
  the camp's) were drawn as bases with icons: an unnamed building part is now a
  building whatever its kind, raised in 3D (it stayed flat); a part of another kind
  keeps its marking only when it isn't an unnamed building. A forest's ammunition
  magazines with no military area mapped around them (Forêt de Laigue: 137 areas
  tagged military=ammunition) showed as numbered discs: groups of in-use buildings of
  one kind, 5 or more within 150 m (PostGIS's ST_ClusterDBSCAN on real metres), get
  a base made for them (their hull); not the disused bunkers (423 groups along the
  Atlantic Wall and the Maginot line: the owner's call). The parts step had taken
  hours (a join on a view without index): a materialized view with one, 2 seconds.
  The sites' imagery looks (areas, parts' roofs) never applied: the module waited for
  the map's load event, already past. Contour heights over imagery as over the map
  (asked: the dark halo was "changed so much").
- **Classification:** a communication mast counts for a radio station only with its
  operator named (an anonymous one is most often a phone mast: about 13 areas back
  to "Other military area"); offices named "Centre des Finances Publiques" are tax
  offices, "Mairie" town halls, the CSNJ military offices; a lunette is a fort.
- **The sea flattened in the terrain** (ships measured by the Copernicus DEM stood as
  hills over 100 m in Toulon's roadstead): `background_build/terrain_sea.py` masks
  each terrain tile with the background map's land (Protomaps' earth layer), heights
  above 0 outside it set to 0, after every terrain download (`offline-maps.py
  terrain-sea` for one made before); clipping a DEM with land polygons as OpenTopoMap
  does.
- **Third round:** Montmacq's magazines one base (`site_made_base_whole`: a place
  where the buildings standing alone are one base however far apart; the owner's
  exception, the 5-in-150-m rule otherwise). Disused bunker groups get made bases
  too, grey as disused sites are (423: Atlantic Wall and Maginot strongpoints, about
  8 bunkers each). The unclear named military sites researched on the web, fixed by
  hand where a source says what they are (`site-overrides.sql`, each with its
  source): the gendarmerie's ECASGN at Le Blanc, the army commissariat's ESCAT at
  Châtres, the Navy's Pencran radio station and Anse Saupin laundry, the Burettes
  bomb enclosure (Champ des Bombes), the Penn an Enez battery, a fire station, the
  Sécurité civile's bomb disposal centre. Left for checking: CPA (the air force
  commandos' former site at Saint-Cyr, base closed 1988), Bois de Nice (walkers
  cross military land, status unsettled), "zone militaire" near Hyères, ZAC Les
  Seguins (a land-cover import to fix in OSM), Espace Roger Pierre Seassal (Nice's
  war memorial square, not military). Why the sites' imagery looks were lost: a
  fade (`ui/fade.ts`) restored the opacity it had read before, over the one the
  background set meanwhile; it now keeps a value changed during the fade (the
  `map.once('load')` setups suspected first run fine: modules start before the
  map loads).
- **The line of sight redone** (docs/plans/archive/line-of-sight.md): its chart drew the ground
  as measured while the answer lowered it for the Earth's curvature (570 m at 92
  km), so a clear-looking line came with "Hidden 6.38 km away". The backend now
  gives every sample's surface as seen from the eye, the chart draws those; it
  counts buildings (OSM's height, else 8 m) and woods (20 m) from the background
  map's zoom 15 tiles (`terrain/obstacles.py`, a spatial index per tile, 0.4 s for
  5 km), says what first hides the target and how far the eye's line passes over
  (or under) the highest thing between. On the map a mark where it's hidden; the
  card simplified ("Hidden by trees 475 m away, 142 m above the line"), "Open the
  profile" splitting the screen (the chart large on the right with axes, the line
  on the left fitted clear of the left column; pointing at the chart marks the
  place on the map). One answer per line, shared by the card, the map and the
  profile. Checked in the app as the debug account (Lièpvre, Vosges).
- **Line of sight, second round** (asked): the line green where it passes over
  everything and red where something rises above it (on the map and the chart; the
  ground's seen or hidden left out); trees and buildings without a height adjustable
  on the card (15 m and 8 m at first: the map has no tree heights, most buildings
  none; IGN's forest inventory publishes no national average height), said in the
  verdict when what hides the target has a height taken; added only in France,
  where the terrain is IGN's bare ground (`terrain/bare_ground.py`; elsewhere
  Copernicus' surface model already holds them: counted twice before). Bois de Nice
  (the army's Courbessac ground since 1878) and the plot at Port Pothuau (the Navy at
  Les Salins d'Hyères) fixed by hand: no named generic site left.
- **The strings check compares texts** (`scripts/fork-strings.mjs`): a text changed in
  the code but not in en.json (which i18next shows first) failed nothing ("m to
  spare" would have stayed); now `--check` fails and the normal run updates it, and
  one key with two texts is a clash. It found one at once: "Move to layer" shown with
  a stray "…" in the map's menu (two uses of one key, now two keys).
- **Line of sight, third round** (asked): the profile a rounded bubble on the right,
  clear of the toolbar and the map's buttons; the chart turned so the line of sight
  is level (the ground kept as seen from the eye: on a long line it bent down off the
  chart, 570 m at 92 km, and what rose above the line was hard to see); the card only
  the answer and the button, the four heights in the panel; the panel draws its own
  line on the map (the owner's layer was hidden: the line seemed missing). With debug
  on, the panel lists the answer's numbers checked against themselves: each sample's
  lowering from the curvature formula (the backend now gives its coefficient and
  radius), the margin and where the target is first hidden worked out again from
  the profile; the debug switch moved to `services/debug-mode.ts` so modules can read
  it. **Bug:** moving a point didn't recalculate: the map asked the backend on every
  frame of the drag (1.7 s each for a 92 km line), and the last answer came long after;
  now asked only when the point is dropped (test in `render-measures.test.ts`).
- **A hidden layer hides all of it** (the owner): the panel drawing its own line in a
  hidden layer was wrong, taken out; the selection's handles (and highlight) aren't
  drawn for an item in a hidden layer either, and come back when it's shown
  (`map/render.ts`). The open profile follows its line through My layers' changes
  (moved, heights changed or undone: asked again, the last chart faded under a
  spinner; deleted: closed), and its contents moved to `sight-panel-content.ts`.
  CLAUDE.md gained "Push back on what doesn't make sense".
- **A line of sight moves only by its points** (asked): a kind can say only its
  points drag (`pointsOnly`, `kinds/types.ts`); grabbing the line itself pans the map,
  and the cursor no longer offers to move it.
- **Line of sight: trees as a maybe, accuracy reviewed** (asked). Trees no longer
  count as a sure stop: hidden only by trees, the answer says "Through trees…: may be
  seen" (`through_trees`), the line yellow there (`--oim-caution`); otherwise the
  ground or a building is named, the margin measuring it (the trees' height was
  given for a ground block before). Accuracy: the heights are above sea level
  (Copernicus DEM: EGM2008 geoid; IGN RGE ALTI: NGF-IGN69), the right base for
  GDAL's curvature correction (6/7 × d² / 2R); the code is our own (GDAL isn't a
  dependency), now pinned by the textbook horizon (2 m eyes: 5.45 km with standard
  refraction; seen at 5.3 km, hidden at 5.6 km). Limits: real refraction varies
  (inversions over plains), lines over ~24 km are sampled more sparsely than the
  terrain's 6 m pixels (4000 samples at most), the mean radius is used (±0.3 %).
- **The system disk filled up** (internal server errors): its btrfs metadata ran
  out (every chunk allocated), the database crash-looped on "No space left on
  device". Docker's leftovers from rebuilding images at each export (165 unused
  images, 69 GB; a 77 GB build cache) deleted with the owner's agreement: running
  again. A `btrfs balance` (root) is still needed to give the disk unallocated room.

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
  coordinates and addresses get a short panel and a ring at the location. (The Osmose validation popups were unchanged then; the layer was removed on 2026-11-11.)
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
- **Sources as files** (2026-11-11, `docs/plans/offline-maps.md` step 1): each
  source is one file in `scripts/satimagery/sources/` with a `SOURCE`
  (`sources/source.py`: short name, credit, layer, how it's fetched, first and last
  zoom, metres per pixel, coverage, units, measured sizes): Blue Marble,
  Sentinel-2, the 14 aerial sources and the background map (Protomaps). `SOURCES`
  reads the folder; `DETAILED_SOURCES`, `TIERS` and the size constants are made
  from it, so the older code is unchanged. IGN's sizes moved from `bdortho.py` to
  `sources/fr_ign.py`. `tests/test_sources.py` checks every source keeps the
  contract (a source never made past the zoom where its pixels only stretch:
  `finest_zoom`); a shell test checks `REDUCED_MAXZOOM` and `PROTOMAPS_BASE` match
  `protomaps.py`. A country's photos are now one new file.
- **The inventory and coverage rules** (2026-11-11, step 2):
  `satimagery/inventory.py` makes `data/basemap/inventory.json` again from the files
  on every start (files are the truth: a file is known by its name and PMTiles
  header, an entry whose file is gone is dropped; the notes only the downloader
  knows, a file's edition, are kept), with the jobs stopped half-way from their
  work folders (`.bdortho-33`: bytes so far, of about how many, why it stopped).
  `settings.json` (speed cap, zoom) and a lock (`.offline-maps.lock`, `flock`):
  one download at a time, `bdortho` takes it and says what holds it otherwise.
  `bdortho` now writes the edition and why a job stopped (`server blocked`, `no
  connection`, `interrupted`, `disk full`) into its work folder and notes the
  edition when a département is done; a source fetched by units has a converter
  with `units_in`, `unit_name`, `unit_of`, `jobs` (bdortho's). `satimagery/coverage.py`:
  how far a source is worth making for an area (Sentinel-2 to 11 where aerial
  photos cover all of it: "IGN from 12"), whether an area inside one already there
  adds anything, and what could be freed (a file inside a bigger one of the same
  source; Sentinel-2's zooms once the photos are downloaded over the whole area),
  never deleted by itself. Tests: `tests/test_inventory.py`.
- **The menu** (2026-11-11, step 3): `satellite.py maps` (`satimagery/maps.py`),
  every question through `satimagery/ui.py` (`table`, `choose`, `pick_row`,
  `codes`, `confirm`). Home: what's there by area and source, jobs stopped or
  running, free space; Resume · Add · Remove · Settings. Add: an area (the region
  built, those already there, World, a search) → what it can have (have / add;
  Sentinel-2 to its most after the coverage rules, no zoom question; "covered by
  France") → for aerial photos the zoom (default from Settings, 17; sizes kept
  per zoom) and, for IGN, the départements (Enter: all; `?` lists them in columns,
  ✓ there, ◐ stopped) → the plan (kept, download, time at the speed cap, room
  needed while converting; Start? defaults to No when the disk is too small) →
  the downloads one after the other as `satellite.py`'s own commands, under the
  lock (`OIM_MAPS_LOCK` lets them through), the rest kept in `queue.json` for
  Resume. Blue Marble comes with any imagery. Remove shows what could be freed.
  The background map is cut in Python now too (`satimagery/extract.py`,
  `satellite.py basemap`). Unattended: `--source fr_ign --units 33 40 --zoom 17
  --yes`, `--resume --yes`. A work folder written to in the last 2 minutes counts
  as running (a download started before the lock existed), so it isn't resumed
  twice. Progress is each command's own output, not yet the plan's one-line bar.
  Tests: `tests/test_maps.py` (typed answers; the commands recorded).
- **The scripts use the menu** (2026-11-11, step 4): `satellite.sh` without
  options opens it (it downloads itself; then the map is pointed at what's there);
  `build-region.sh` opens it with `--queue-only` (`choose_satellite`): what's
  chosen goes in `queue.json` and is downloaded after the build (`run_maps_queue`
  in `download_satellite`, `satellite.py maps --queued --yes`), so every question
  still comes first. The older options (`--satellite`, `--satellite-detailed`,
  `--area`, `--zoom`, `--sources`) keep the older plan (`satellite.py choose` /
  `steps`). The build's own background map question is still there too.

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
- **An IGN edition listed but not served (2026-11-19).** IGN's listing gave Vienne's
  2023 photos, but their archive's listing was a 404, and the queue stopped there.
  `bdortho.latest_edition` now takes the newest edition whose archive IGN serves (the
  2020 one for Vienne); a missing listing counts as empty (`entries`).

## Clean-up (2026-11-12 to 2026-11-16)

Batches 1 to 11 of `docs/plans/archive/cleanup.md` (its log says what each did and
measured; findings in `archive/cleanup-audit.md`). The last ones, 2026-11-16:

- **Names (batch 8):** `data/basemap/` → `data/offline-maps/` (it holds imagery
  and the buildings zoomed out too), `BASEMAP_DIR` → `OFFLINE_MAPS_DIR`,
  `--basemap-dir` → `--maps-dir`; `scripts/satellite.sh` / `satellite.py` /
  `satimagery/` → `offline-maps.sh` / `offline-maps.py` / `offline_maps/`, the
  shell's `choose_satellite` / `download_satellite` → `choose_offline_maps` /
  `download_offline_maps`, `lib/satellite.sh` → `lib/offline-maps.sh`. The package's
  re-export of everything "for the tests" went: the tests import the modules. The
  fork's SQL in `schema/fork/` (found by name: `schema_file`), upstream's left in
  `schema/`. Kept: `VITE_BASEMAP_URL`, `--basemap full|none`, `lib/basemap.sh`
  ("basemap" there is the background map). The folder was moved with the IGN
  download stopped, its queue's paths rewritten, then the download restarted
  (`offline-maps.py maps --resume --yes`).
- **One Docker helper per language:** `lib/docker.sh` (`up_services`,
  `compose_run`, `backend_python`) and `offline_maps/docker.py` (`run`,
  `run_service`; `as_root`: run as root, then everything under the mount given back
  to the user, the program's status kept). Every call moved onto them; osmium runs
  without naming its Compose profile (Compose enables it for a service named).
- **Removed options say nothing any more:** `--satellite...` in `build-region.sh`
  and `satellite.sh` were answered with what replaced them; now simply unknown.
- **Clean code rules** in `CLAUDE.md`, with reporting what should be cleaned at the
  end of each feature.

---
