# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Infrastructure Map is a web geospatial application displaying world infrastructure (power grids, telecom, water, petroleum) from OpenStreetMap. It has five main services: a TypeScript/MapLibre frontend, a Python/Starlette backend, a Go/Tegola tile server, a PostgreSQL/PostGIS database, and an Imposm-based OSM importer.

**This is a fork** whose goal is running everything locally (and offline, from an exported database) for a chosen region. How the fork's code is organised, its folder rules and recipes for adding things: `docs/ARCHITECTURE.md` (keep it current when the structure changes). What changed and why is recorded in `docs/FORK_CHANGES.md`; keep it up to date when making fork-specific changes. The user-facing guide is `docs/LOCAL_DEVELOPMENT.md`.

**Specifications:** every requirement the project owner has asked for is in `docs/SPECIFICATIONS.md`, with its status. Add each new request there when it's made and update the status when it's done. Plans for bigger features are in `docs/plans/`.

**Keep fork code out of upstream files.** Upstream won't take the fork's changes, so merges must stay easy: new frontend features go in a module under `web/src/fork/modules/` (added to `MODULES` in `fork/index.ts`; upstream files only call its hooks and import only `fork/index.ts`, `types.ts`, `config.ts`; modules never import each other, shared pieces go in `fork/ui/` or `fork/core/`: `fork/structure.test.ts`), backend routes in `web-backend/src/fork/`, tile layers in `tegola/layers.fork.yml`, Compose changes in `docker-compose.override.yml`, English strings in `web/src/fork/locales/en.json`. Put a file's types in `X.types.ts` and its constants in `X.constants.ts` beside it, and helpers more than one place needs in `fork/core/` (never copied). Change an upstream file only with a one-line hook, and list it in `docs/FORK_CHANGES.md` ("Fork structure", "Merging from upstream").

## Development Setup

Prerequisites: `docker`, `node`, `npm`, `curl`, `python3`, `unzip` (`uv` optional: Wikidata cache script, running the backend on the host).

```bash
bash scripts/launch.sh   # first time: build/import a region, .env files, start the app
bash scripts/start.sh    # every day: db + tegola + backend (Docker), frontend in a new terminal, browser
```

Services (the fork's ports and services are in `docker-compose.override.yml`): `gate` (nginx, https on port 8800 with its own self-signed certificate made on first start in `data/gate/`: **the app is opened there**; the one way in from the network, every request needs a logged-in session, `gate/nginx.conf`), `db` (PostGIS, 5432), `tegola` (7800), `backend` (8001; also the offline background map, `/background`, from every `data/basemap/<area>.pmtiles`: `src/fork/background/`), `satellite` (satellite imagery, `pmtiles serve` of `data/basemap/*.sat-*.pmtiles`, 8090), all four on 127.0.0.1 only, and the frontend (`cd web && npm start`, port 5173, reached through the gate). Stop: Ctrl+C in the frontend window, then `docker compose stop`.

## Commands

### Frontend (`web/`)
```bash
npm start         # Dev server on port 5173 (upstream renamed it from `npm run dev`)
npm run build     # Production build
npm run lint      # ESLint + Prettier
npm run test      # Vitest (+ Puppeteer integration tests): upstream's
npm run test:fork # The fork's unit tests (src/fork/**/*.test.ts, happy-dom; vitest.fork.config.ts)
npm run fork-strings # Add the fork's new English strings (t('key', 'text'), from src/fork/core/i18n.ts) to src/fork/locales/en.json
npm run extract   # Extract i18n translation strings
```

### Backend (`web-backend/`)
```bash
docker compose up -d backend                       # Normal: runs in Docker
uv run uvicorn src.main:app --reload --port 8001   # Developing it: `docker compose stop backend` first
uv run ruff check                  # Lint
uv run ruff format                 # Format
uv run mypy .                      # Type check
uv run pytest                      # Tests (the fork's: tests/fork/)
```

### Setup scripts (`scripts/`)
```bash
uv run --with pytest --with httpx --with psycopg2-binary pytest scripts/tests   # From the repo root
OIM_TEST_REAL_BUILD=1 uv run --with pytest ... pytest scripts/tests -k real_build   # Real Luxembourg build/export/import in a separate Docker project (the real DB is untouched)
```
Script tests run the scripts from a temporary copy with fake `docker`/`curl`/terminals (`scripts/tests/fakes/`); keep scripts testable that way (paths from `REPO_ROOT`, external programs called by name).

**Tests for fork code:** add unit tests next to new fork code where they make sense
(pure logic, parsing, geometry, state; not glue or layout): frontend `src/fork/**/*.test.ts`,
backend `web-backend/tests/fork/`, scripts `scripts/tests/` (shell helpers are tested by
running them in bash). Upstream's code isn't covered by the fork's tests.

### Tile server (`tegola/`)
```bash
# Regenerate Tegola config from YAML sources:
python3 ./generate_tegola_config.py ./tegola.yml ./layers.yml ./layers.fork.yml > ./config.toml
```

### Data (`scripts/`)
```bash
bash scripts/build-region.sh                              # Interactive: pick a region, wipe DB, download + import
bash scripts/build-region.sh --region luxembourg --yes    # Unattended (tiny test region, ~30 s)
bash scripts/build-region.sh --region russia --rebuild --yes   # Ignore a ready-made export
bash scripts/export-db.sh                                 # Save the DB to data/exports/<region>.oimdb (+ Docker images)
bash scripts/import-db.sh data/exports/<region>.oimdb     # Restore one; build-region.sh offers this in its menu
bash scripts/number-towers.sh                             # Number the towers along their lines again
uv run scripts/fetch_images.py [--json-only|--count]      # Offline Wikidata cache in data/
docker compose down -v                                    # Wipe the DB and all project volumes
```

## Architecture

### Data flow
OSM PBF → osmium pre-filter (`scripts/osm_filter.py`) → **Imposm** (`/imposm`) → PostGIS DB (`/schema`) → **Tegola** (`/tegola`) → vector tiles → **MapLibre frontend** (`/web`). The **web-backend** (`/web-backend`) serves stats pages, search and Wikidata popups.

### Setup scripts (`/scripts/`, fork-only)
- `lib/common.sh`: the paths and colours; it sources the helpers in `lib/*.sh` by theme (`ui.sh` prompts, `choose_number` menus, `room_for`, `run_with_timer`, `run_parallel`, `banner`; `net.sh` `download` / `safely`; `json.sh`; `db.sh` `db_psql`/`db_query`, `SCHEMA_FILES`, `run_schema`, `fresh_database`; `eez.sh`, `extra.sh`, `userdata.sh`, `exports.sh`, `app.sh` `start_app` and `.env`, `basemap.sh`, `geofabrik.sh`, `satellite.sh`). Scripts source `common.sh`; don't run it.
- **Downloads:** every download goes through `download` / `safely` (`lib/net.sh`) or, in Python, `netsafe.py` (`safely`, `fetch`, `run_until_connected`): retried, a lost connection waited for (up to 15 min), a hung download stopped, exit status 75 when the connection doesn't come back, 76 (`ServerStopped`) at once when only that server stops answering while the internet works (an anti-bot block). Never call curl/urllib/httpx for a download without them.
- `build-region.sh` ("what the build will do" at the top: the variables the steps share): region menu → download to `data/osm/` → osmium filter → `docker compose down -v` → imposm import → `views.sql`, `stats.sql`, `places.sql` → `sites.sql`, `grid.sql` (power grid network) → `tower-numbers.sql` + `number_towers` (towers numbered along their lines, `web-backend/src/fork/tower_numbers/`) → search indexes → EEZ (`schema/eez.sql`) → stats snapshot (`schema/local-stats.sql`) → `oim_build_info` table → Tegola → offline maps queued in the menu (background map: `pmtiles extract` of an area's outline from Protomaps' daily build into `data/basemap/<area>.pmtiles`, full detail; `select_basemap` points `VITE_BASEMAP_URL` at the backend's `/background`). All prompts happen before the first long step.
- `export-db.sh` / `import-db.sh`: `pg_dump` of the `public`, `countries`, `stats`, `extra` and `userdata` schemas plus a JSON manifest. The restore skips objects a fresh DB already has (PostGIS, `spatial_ref_sys`, functions from `functions.sql`) but must keep functions from `views.sql` (Tegola needs them).
- `satellite.sh`: the offline maps menu (`satellite.py maps`) for the region already built (no rebuild); `build-region.sh` opens it with `--queue-only` and downloads the queue after the build (`choose_satellite`, `download_satellite`, `run_maps_queue` in `lib/satellite.sh`); the older `--satellite` options keep the older plan.
- `satellite.py` (the command line; the code is in the `satimagery/` package: `sources/` (one file per source, `SOURCE`; read into `SOURCES`, and the older `DETAILED_SOURCES`), `tiles.py`, `estimate.py`, `download.py`, `gdal.py`, `bdortho.py` with `departements.py`, `inventory.py` (what's in `data/basemap/`, made from the files; the lock), `coverage.py` (what's worth offering), `maps.py` (the offline maps menu, `satellite.py maps`; screens through `ui.py`), `extract.py` (background map), `menu.py`, `cli.py`): offline satellite imagery (NASA Blue Marble for the world, Sentinel-2 10 m for an area or the world, aerial photos from `DETAILED_SOURCES` by country, France's as IGN's BD ORTHO files one département at a time, never IGN's tile server, which blocks bulk downloads) into `data/basemap/<area>.sat-*.pmtiles`; `choose` / `steps` are the scripts' questions and downloads; `select_satellite` writes `VITE_SATELLITE_TIERS` (everything in `data/basemap/`, each with its credit from `attribution_for`; `start.sh` refreshes it).
- `launch.sh`, `start.sh`: start everything; the frontend runs in a new terminal window via `open_in_terminal`.
- `osm_filter.py`: generates the osmium `tags-filter` expressions from the imposm mapping.
- `fetch_images.py`: Wikidata entity JSON + Commons thumbnails into `data/`.

### Database schema (`/schema/`)
- `dev-init.sql` / `prod-init.sql`: run once at DB creation to install extensions and set up roles
- `functions.sql`: PL/pgSQL helper functions (must be loaded before `views.sql`)
- `views.sql`: views/materialized views and functions that Tegola queries for tile rendering
- `stats.sql`: the `stats` schema; `jobs/update-stats.sql` is upstream's production job
- `grid.sql` (fork-only): `grid_node` / `grid_edge`, the network of lines with a known voltage used by `/grid/route` and `/grid/line` (`web-backend/src/fork/grid.py`, networkx) and `web/src/fork/modules/grid/`
- `eez.sql`, `local-stats.sql`, `places.sql` (fork-only): EEZ views; fast per-country stats snapshot; one point per place in `osm_place` for search
- `web-backend/src/fork/userdata/migrations/NNN_*.sql` (fork-only, run in order by the backend, once each, recorded in `userdata.schema_version`; a schema change is a new numbered file, never an edit of one already run; the package also has `users.py`, where login and access control go): the `userdata` schema of My layers (layers, features, a change log for playback, images); saved and restored around rebuilds/imports by `scripts/lib/common.sh`
- `sites.sql`, `extra.sql`, `search.sql` (fork-only): critical sites (`site_feature`, `site_points` for grouped tiles); the `extra` schema (data from outside OSM); `search_feature`, everything else with a name for the search box (rebuilt after extra data changes)

### Tile server (`/tegola/`)
The `config.toml` Tegola reads is **generated**; never edit it directly. Edit `tegola.yml` (server config) and `layers.yml` (upstream's layer definitions) or `layers.fork.yml` (the fork's), then regenerate with `generate_tegola_config.py`. A second Docker image (`Dockerfile.expiry`) handles cache invalidation via the imposm expiry list. Tegola caches tiles inside its container, so recreate it after replacing the data.

### Frontend (`/web/`)
MapLibre GL JS map with i18next for internationalisation. The Background layer group (OpenStreetMap; the night lights were removed: online only) is commented out in `src/openinframap.ts`; re-enabling it breaks saved links whose layer list has no `A`. URLs come from `web/src/fork/config.ts` (`VITE_*` variables). UI (fork): Data layers (upstream's layer list and key in one panel, `fork/ui/data-layers.ts`: each entry's tick box calls the layer switcher, its key sections fold under it) and My layers open on click in the right-hand dock (`fork/ui/dock.ts`: any panel element with class `visible` is open, one at a time); feature details open in the left details panel (`fork/modules/details/`, via the `forkPopup.open` hook; the panel, highlight and left-column order are shared in `fork/ui/left-column.ts`, `details.ts`, `highlight.ts`; modules add to a feature's details with `addDetailsExtra`) with the Grid connection panel below; There's no header: Settings (`fork/ui/settings.ts`, the app's settings: background, map sources, accounts), print and your account (Log out) are buttons at the bottom of the top-right column (`fork/ui/map-button.ts`), About this map is in the credits (bottom right); My layers' own settings (colour, labels, bearings) are in their own window, opened from its ⚙. All panels share `fork/ui/panel.css`; build new ones with `makePanel()` (`fork/ui/panel.ts`) and dock them with `dock.add(button, panel)`. Anything chosen, switched on or selected gets the class `oim-on` (highlighted background, border unchanged), not a look of its own. Tooltips: a `title` (shown by `fork/ui/tooltip.ts`, never the browser's). Search (`src/search/`) combines coordinates, the backend (substations, plants, places and everything else with a name via `search_feature`; picking a result switches on its layer) and an optional Photon server (`VITE_PHOTON_URL` / Settings), via `Promise.allSettled`, merging same-name results within ~5 km. OpenCage was removed. Tests use Vitest with Puppeteer for browser-level integration tests.

### Backend (`/web-backend/`)
Starlette ASGI app (code under `src/`, entry point `src.main:app`) using SQLAlchemy async + asyncpg (`pool_pre_ping` so it survives DB rebuilds). Bokeh + Pandas generate stats charts. Runs as the `backend` Compose service (port 8001, built from `web-backend/Dockerfile`, entrypoint `/app/.venv/bin/uvicorn` to avoid `uv run` syncing at startup), mounting `data/images` and `data/wikidata_json`. Requires `DATABASE_URL` with the `postgresql+asyncpg://` scheme. Every route but logging in needs a logged-in session (`src/fork/auth/`: accounts, sessions, the login page, `LoginMiddleware`; `current_user()` in `userdata/users.py`); the frontend reaches local services through the gate (`throughGate` in `web/src/fork/config.ts`). The fork's routes (`src/fork/`) come before upstream's: its search (`src/fork/search/`) replaces upstream's `src/views/search.py` at the same URL. Search name indexes (btree + `pg_trgm`) are created by `create_indexes.py` plus `src/fork/indexes.py`; keep them in sync with `src/fork/search/`.

### Imposm (`/imposm/`)
Python files (`main.py`, `power.py`, …) generate the imposm mapping JSON that defines which OSM tags are imported into which tables. `places.py` (fork) adds `osm_place` for the search box; `sites.py` (fork) adds `osm_site` (critical sites), classified by `schema/sites.sql` into the `site_feature` materialized view. Changing it changes the osmium filter (generated) and the schema fingerprint stored in builds and exports.

## Environment Variables

`launch.sh` creates both files if missing:
- `web/.env`: `VITE_TILE_BASE_URL` (the background map's default, openinframap.org; to be removed: local tiles only), `VITE_TEGOLA_URL` (local Tegola, `http://localhost:7800`), `VITE_BACKEND_BASE_URL` (`http://localhost:8001`), `VITE_BASEMAP_URL` (background map; set by `build-region.sh` to the local `basemap` service when one is downloaded), optional `VITE_PHOTON_URL` (Photon geocoder; never set by the scripts), `VITE_SATELLITE_TIERS` (satellite imagery tiers, set by `select_satellite`). The map style needs Protomaps-schema background tiles. The map sources in Settings (`web/src/fork/modules/map-sources/`, `fork/ui/settings.ts`) overrides it per tab via `sessionStorage`.
- `web-backend/.env`: `DATABASE_URL` for running the backend on the host (the Docker service sets its own)

## Gotchas

- Bash reads scripts as it runs them: don't edit `scripts/*.sh` while one is running.
- Docker mounts need `:z` (Fedora/SELinux).
- `data/` is gitignored: downloads (`osm/`), exports (`exports/`), EEZ zip, Wikidata cache.
- The PostGIS alpine image's `shp2pgsql` needs `libintl` installed at run time (`import_eez` does it).
- Upstream files changed by the fork are listed in `docs/FORK_CHANGES.md` ("Merging from upstream").
- Build SQL must scale to a country like France (millions of rows): `ANALYZE` temp tables after creating them, join instead of `IN`/`NOT IN (subquery)`, never join on `ST_Equals`, and give `ST_DWithin` a constant distance (a per-row one can't use the spatial index). Distances and areas are written in real metres and converted with `schema/distances.sql` (`ST_DWithin(a, b, D * oim_max_stretch()) AND ST_DWithin(a, b, oim_units(D, b))`; `oim_metres`, `oim_ground_area`): map units stretch with latitude (a test fails on a bare number). Test new build steps on more than Luxembourg.

## CI/CD

GitHub Actions workflows (`.github/workflows/`) run lint + type-check + tests on PRs, then build and push Docker images on pushes to `main`. Each service has its own workflow file (`web.yml`, `web-backend.yml`, `tileserver.yml`, `imposm.yml`, `web-router.yml`).
