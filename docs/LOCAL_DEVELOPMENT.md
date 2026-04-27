# Local Development

This guide gets you from a fresh clone to a fully offline working stack
(frontend + backend + database). No requests to openinframap.org at runtime,
except tile requests which default to production and can be overridden via
environment variable.

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Docker + Compose v2 | Docker 24 | `docker compose` (not `docker-compose`) |
| [uv](https://docs.astral.sh/uv/) | any recent | Python package manager for the backend |
| Node.js + npm | Node 20 | Used by the frontend |
| shp2pgsql | any | Only needed for the optional EEZ import; part of PostGIS client tools (`postgis-client` / `postgis` package) |
| Free disk space | ~5 GB | PBF ~200 MB, Docker volumes ~2 GB, node_modules ~1 GB |

---

## Step-by-step setup

### 1. Clone the repository

```bash
git clone <your-fork-url>
cd openinframap
```

### 2. Download a regional PBF

The import script expects a PBF at `data/region.osm.pbf`. Any Geofabrik
extract works; Netherlands is a good size for testing (~200 MB):

```bash
mkdir -p data
curl -L https://download.geofabrik.de/europe/netherlands-latest.osm.pbf \
     -o data/region.osm.pbf
```

Any other region from https://download.geofabrik.de works — just rename the
file to `region.osm.pbf`. The map will be empty outside the imported region.

### 3. Bootstrap the database

```bash
bash scripts/setup-local-db.sh
```

This script:
- Starts the `db` Docker Compose service (PostGIS)
- Waits for Postgres to be ready
- Runs imposm to import the PBF (skipped if already imported)
- Applies `schema/views.sql` (skipped if already applied)
- Prints instructions for the optional EEZ import (see below)

Re-running the script after a successful import is safe — it detects existing
data and skips the heavy steps.

> **Port exposure:** `docker-compose.override.yml` maps port 5432 to the host
> so the backend (running outside Docker) can reach the database. Docker Compose
> picks this up automatically — no extra steps needed.

### 4. Configure and start the backend

```bash
cd web-backend
cp .env.example .env
uv run uvicorn main:app --reload
```

The backend listens on `http://localhost:8000`. Leave this terminal running.

### 5. Configure and start the frontend

In a separate terminal:

```bash
cd web
cp .env.example .env
```

Edit `web/.env` and set:

```
VITE_BACKEND_BASE_URL=http://localhost:8000
```

`VITE_TILE_BASE_URL` can be left at the production default unless you are
running a local tile server (see [Tile server](#tile-server) below).

Then start the dev server:

```bash
npm run dev
```

Open http://localhost:5173.

---

## Environment files

### `web/.env`

```
# Tile server — defaults to https://openinframap.org (production tiles).
# Override if running a local Tegola instance.
VITE_TILE_BASE_URL=https://openinframap.org

# Web-backend — point at your local uvicorn process.
VITE_BACKEND_BASE_URL=http://localhost:8000
```

### `web-backend/.env`

```
DATABASE_URL=postgresql://osm:osm@localhost:5432/osm

# Uncomment to disable HTTP cache headers (useful in dev):
# DEBUG=true
```

---

## What works, what doesn't

### Works out of the box

- **Map loads** — tiles are fetched from production openinframap.org by default
  (or your configured tile server)
- **Wikidata info popups** — the `/wikidata/{id}` proxy endpoint fetches from
  Wikidata API; works without EEZ data
- **All non-data routes** — `/about`, `/copyright`, static assets

### Works after EEZ import (optional)

- **Search (`/search/typeahead`)** — requires the `countries.country_eez_sub`
  materialized view; returns 500 without it
- **Area/stats pages (`/stats/area/*`)** — same dependency; returns 404/500
  without it

See the setup script output for step-by-step EEZ import instructions.

### Doesn't work regardless

- **Map data outside the imported region** — tiles will be blank; only the
  area covered by your PBF is in the local database
- **Live OSM diff updates** — imposm is run once for the initial import; the
  database does not update automatically
- **Production stats charts** — these query the full global dataset; local
  data will produce incomplete results

---

## Tile server

By default `VITE_TILE_BASE_URL` is unset and falls back to
`https://openinframap.org`, so the map renders using production tiles even
when running the backend locally. This is intentional — it keeps the
out-of-the-box experience working without any additional services.

To run tiles locally (requires a completed database import):

```bash
docker compose up tegola
```

Then set in `web/.env`:

```
VITE_TILE_BASE_URL=http://localhost:8080
```

---

## Updating the data

There is no continuous diff update. To refresh with a newer PBF:

```bash
# Wipe the Postgres volume and reimport
docker compose down -v
curl -L https://download.geofabrik.de/europe/netherlands-latest.osm.pbf \
     -o data/region.osm.pbf
bash scripts/setup-local-db.sh
```

The imposm cache volumes (`imposm_cache`, `imposm_diff`, `imposm_expiry`) are
also removed by `docker compose down -v`. If you want to preserve them for
faster incremental imports, remove only the `postgres_data` volume manually.

---

## Troubleshooting

_This section is intentionally empty — fill it in as you encounter issues._
