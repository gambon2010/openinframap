# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Open Infrastructure Map is a web geospatial application displaying world infrastructure (power grids, telecom, water, petroleum) from OpenStreetMap. It has five main services: a TypeScript/MapLibre frontend, a Python/Starlette backend, a Go/Tegola tile server, a PostgreSQL/PostGIS database, and an Imposm-based OSM importer.

**This is a fork** whose goal is running everything locally (and offline, from an exported database) for a chosen region. What changed and why is recorded in `docs/FORK_CHANGES.md`; keep it up to date when making fork-specific changes. The user-facing guide is `docs/LOCAL_DEVELOPMENT.md`.

**Keep fork code out of upstream files.** Upstream won't take the fork's changes, so merges must stay easy: new frontend features go in a module under `web/src/fork/` (added to `MODULES` in `fork/index.ts`; upstream files only call its hooks), backend routes in `web-backend/src/fork/`, tile layers in `tegola/layers.fork.yml`, Compose changes in `docker-compose.override.yml`, English strings in `web/src/fork/locales/en.json`. Change an upstream file only with a one-line hook, and list it in `docs/FORK_CHANGES.md` ("Fork structure", "Merging from upstream").

## Development Setup

Prerequisites: `docker`, `node`, `npm`, `curl`, `python3`, `unzip` (`uv` optional: Wikidata cache script, running the backend on the host).

```bash
bash scripts/launch.sh   # first time: build/import a region, .env files, start the app
bash scripts/start.sh    # every day: db + tegola + backend (Docker), frontend in a new terminal, browser
```

Services (the fork's ports and services are in `docker-compose.override.yml`): `db` (PostGIS, port 5432), `tegola` (port 7800), `backend` (port 8001), `basemap` (offline background map, `pmtiles serve` of `data/basemap/`, port 8090), frontend (`cd web && npm start`, port 5173). Stop: Ctrl+C in the frontend window, then `docker compose stop`.

## Commands

### Frontend (`web/`)
```bash
npm start         # Dev server on port 5173 (upstream renamed it from `npm run dev`)
npm run build     # Production build
npm run lint      # ESLint + Prettier
npm run test      # Vitest (+ Puppeteer integration tests)
npm run extract   # Extract i18n translation strings
```

### Backend (`web-backend/`)
```bash
docker compose up -d backend                       # Normal: runs in Docker
uv run uvicorn src.main:app --reload --port 8001   # Developing it: `docker compose stop backend` first
uv run ruff check                  # Lint
uv run ruff format                 # Format
uv run mypy .                      # Type check
uv run pytest                      # Tests
```

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
uv run scripts/fetch_images.py [--json-only|--count]      # Offline Wikidata cache in data/
docker compose down -v                                    # Wipe the DB and all project volumes
```

## Architecture

### Data flow
OSM PBF → osmium pre-filter (`scripts/osm_filter.py`) → **Imposm** (`/imposm`) → PostGIS DB (`/schema`) → **Tegola** (`/tegola`) → vector tiles → **MapLibre frontend** (`/web`). The **web-backend** (`/web-backend`) serves stats pages, search and Wikidata popups.

### Setup scripts (`/scripts/`, fork-only)
- `lib/common.sh`: shared helpers (paths, prompts, `run_with_timer`, `db_psql`/`db_query`, EEZ import, `start_app`, `create_search_indexes`, export manifest helpers). Source it; don't run it.
- `build-region.sh`: region menu → download to `data/osm/` → osmium filter → `docker compose down -v` → imposm import → `views.sql`, `stats.sql`, `places.sql` → `sites.sql`, `grid.sql` (power grid network) → search indexes → EEZ (`schema/eez.sql`) → stats snapshot (`schema/local-stats.sql`) → `oim_build_info` table → Tegola → optional offline background map (`pmtiles extract` of the region's Geofabrik outline from Protomaps' daily build into `data/basemap/`, then `select_basemap` sets `VITE_BASEMAP_URL` in `web/.env`). All prompts happen before the first long step.
- `export-db.sh` / `import-db.sh`: `pg_dump` of the `public`, `countries`, `stats`, `extra` and `userdata` schemas plus a JSON manifest. The restore skips objects a fresh DB already has (PostGIS, `spatial_ref_sys`, functions from `functions.sql`) but must keep functions from `views.sql` (Tegola needs them).
- `launch.sh`, `start.sh`: start everything; the frontend runs in a new terminal window via `open_in_terminal`.
- `osm_filter.py`: generates the osmium `tags-filter` expressions from the imposm mapping.
- `fetch_images.py`: Wikidata entity JSON + Commons thumbnails into `data/`.

### Database schema (`/schema/`)
- `dev-init.sql` / `prod-init.sql`: run once at DB creation to install extensions and set up roles
- `functions.sql`: PL/pgSQL helper functions (must be loaded before `views.sql`)
- `views.sql`: views/materialized views and functions that Tegola queries for tile rendering
- `stats.sql`: the `stats` schema; `jobs/update-stats.sql` is upstream's production job
- `grid.sql` (fork-only): `grid_node` / `grid_edge`, the network of lines with a known voltage used by `/grid/route` and `/grid/line` (`web-backend/src/fork/grid.py`, networkx) and `web/src/fork/grid/`
- `eez.sql`, `local-stats.sql`, `places.sql` (fork-only): EEZ views; fast per-country stats snapshot; one point per place in `osm_place` for search
- `web-backend/src/fork/userdata.sql` (fork-only, made by the backend on first use): the `userdata` schema of My layers (layers, features, a change log for playback, images); saved and restored around rebuilds/imports by `scripts/lib/common.sh`
- `sites.sql`, `extra.sql`, `search.sql` (fork-only): critical sites (`site_feature`, `site_points` for grouped tiles); the `extra` schema (data from outside OSM); `search_feature`, everything else with a name for the search box (rebuilt after extra data changes)

### Tile server (`/tegola/`)
The `config.toml` Tegola reads is **generated**; never edit it directly. Edit `tegola.yml` (server config) and `layers.yml` (upstream's layer definitions) or `layers.fork.yml` (the fork's), then regenerate with `generate_tegola_config.py`. A second Docker image (`Dockerfile.expiry`) handles cache invalidation via the imposm expiry list. Tegola caches tiles inside its container, so recreate it after replacing the data.

### Frontend (`/web/`)
MapLibre GL JS map with i18next for internationalisation. The Background layer group (OpenStreetMap / night lights) is commented out in `src/openinframap.ts`; re-enabling it breaks saved links whose layer list has no `A`. URLs come from `web/src/fork/config.ts` (`VITE_*` variables). UI (fork): Layers, Key and My layers open on click in the right-hand dock (`fork/ui/dock.ts`: any panel element with class `visible` is open, one at a time; upstream's key and layer list are moved into it unchanged); feature details open in a left side panel (`fork/grid/`, via the `forkPopup.open` hook) with the Grid connection panel below; Settings (header link, `fork/ui/settings.ts`) holds the map sources. All panels share `fork/ui/panel.css`; build new ones with `makePanel()` (`fork/ui/panel.ts`) and dock them with `dock.add(button, panel)`. Search (`src/search/`) combines coordinates, the backend (substations, plants, places and everything else with a name via `search_feature`; picking a result switches on its layer) and an optional Photon server (`VITE_PHOTON_URL` / Settings), via `Promise.allSettled`, merging same-name results within ~5 km. OpenCage was removed. Tests use Vitest with Puppeteer for browser-level integration tests.

### Backend (`/web-backend/`)
Starlette ASGI app (code under `src/`, entry point `src.main:app`) using SQLAlchemy async + asyncpg (`pool_pre_ping` so it survives DB rebuilds). Bokeh + Pandas generate stats charts. Runs as the `backend` Compose service (port 8001, built from `web-backend/Dockerfile`, entrypoint `/app/.venv/bin/uvicorn` to avoid `uv run` syncing at startup), mounting `data/images` and `data/wikidata_json`. Requires `DATABASE_URL` with the `postgresql+asyncpg://` scheme. The fork's routes (`src/fork/`) come before upstream's: its search (`src/fork/search.py`) replaces upstream's `src/views/search.py` at the same URL. Search name indexes (btree + `pg_trgm`) are created by `create_indexes.py` plus `src/fork/indexes.py`; keep them in sync with `src/fork/search.py`.

### Imposm (`/imposm/`)
Python files (`main.py`, `power.py`, …) generate the imposm mapping JSON that defines which OSM tags are imported into which tables. `places.py` (fork) adds `osm_place` for the search box; `sites.py` (fork) adds `osm_site` (critical sites), classified by `schema/sites.sql` into the `site_feature` materialized view. Changing it changes the osmium filter (generated) and the schema fingerprint stored in builds and exports.

## Environment Variables

`launch.sh` creates both files if missing:
- `web/.env`: `VITE_TILE_BASE_URL` (night lights, and background map default: openinframap.org), `VITE_TEGOLA_URL` (local Tegola, `http://localhost:7800`), `VITE_BACKEND_BASE_URL` (`http://localhost:8001`), `VITE_BASEMAP_URL` (background map; set by `build-region.sh` to the local `basemap` service when one is downloaded), optional `VITE_PHOTON_URL` (Photon geocoder; never set by the scripts). The map style needs Protomaps-schema background tiles. The map sources in Settings (`web/src/fork/map-sources/`, `fork/ui/settings.ts`) overrides it per tab via `sessionStorage`.
- `web-backend/.env`: `DATABASE_URL` for running the backend on the host (the Docker service sets its own)

## Gotchas

- Bash reads scripts as it runs them: don't edit `scripts/*.sh` while one is running.
- Docker mounts need `:z` (Fedora/SELinux).
- `data/` is gitignored: downloads (`osm/`), exports (`exports/`), EEZ zip, Wikidata cache.
- The PostGIS alpine image's `shp2pgsql` needs `libintl` installed at run time (`import_eez` does it).
- Upstream files changed by the fork are listed in `docs/FORK_CHANGES.md` ("Merging from upstream").
- Build SQL must scale to a country like France (millions of rows): `ANALYZE` temp tables after creating them, join instead of `IN`/`NOT IN (subquery)`, never join on `ST_Equals`, and give `ST_DWithin` a constant distance (a per-row one can't use the spatial index). Test new build steps on more than Luxembourg.

## CI/CD

GitHub Actions workflows (`.github/workflows/`) run lint + type-check + tests on PRs, then build and push Docker images on pushes to `main`. Each service has its own workflow file (`web.yml`, `web-backend.yml`, `tileserver.yml`, `imposm.yml`, `web-router.yml`).
