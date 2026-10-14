# Open Infrastructure Map — Offline Local Dev Fork

This is a fork of [openinframap/openinframap](https://github.com/openinframap/openinframap)
that runs Open Infrastructure Map **entirely on your own computer**: your own database,
tile server and backend, built from OpenStreetMap data for the region you choose, from
one country up to the whole world. A built database can be exported and copied (e.g. on
a USB drive) to a computer without internet access.

The background map can be downloaded per region (full or reduced detail) and served
locally too; otherwise it comes from openinframap.org. Place search (towns, addresses)
still needs the internet.

## Getting started

Needs Docker, Node.js/npm, curl, python3 and unzip.

```bash
# First time: pick a region, build (or import) the database, create .env files,
# then start the app and open it in your browser
bash scripts/launch.sh

# Every time after that: start everything and open the map
bash scripts/start.sh
```

Full guide: **[docs/LOCAL_DEVELOPMENT.md](./docs/LOCAL_DEVELOPMENT.md)**.
What the fork changed and why: **[docs/FORK_CHANGES.md](./docs/FORK_CHANGES.md)**.

## What's different from upstream

| Area | Change |
|------|--------|
| **Setup** | `scripts/launch.sh` (first time) and `scripts/start.sh` (every day): start everything, open the frontend in a terminal window and the map in the browser |
| **Data** | `scripts/build-region.sh`: pick any Geofabrik region or the whole world, download (kept and reused), filter to infrastructure with osmium, import, views, search indexes, EEZ boundaries and per-country stats, all unattended after a few questions |
| **Sharing** | `scripts/export-db.sh` / `scripts/import-db.sh`: save a built database (plus the Docker images) and restore it elsewhere in minutes, offline too |
| **Background map** | Optional offline copy per region (Protomaps extract, `basemap` service); Map sources panel to see and change the URL for the current tab |
| **Backend** | Runs in Docker (Compose service `backend`), so it needs no Python setup and works offline |
| **Search** | Local power plant and substation search also matches words inside names ("vianden" → "Centrale de Vianden"), with indexes; coordinates; OpenCage place search when online; one failing source no longer hides the others |
| **Stats pages** | Per-country stats computed at build time, with a query that's fast for countries like Russia |
| **Wikidata popups** | `scripts/fetch_images.py` caches entity data and photos in `data/`; the backend serves them offline |
| **URLs** | Backend, Tegola and background-map URLs configurable in `web/.env` (`VITE_BACKEND_BASE_URL`, `VITE_TEGOLA_URL`, `VITE_BASEMAP_URL`, `VITE_TILE_BASE_URL`) |
| **UI** | Map sources panel; background switch (OpenStreetMap / online-only night lights) hidden |

## Upstream project

The upstream project is [Open Infrastructure Map](https://openinframap.org), a map of the
world's infrastructure from [OpenStreetMap](https://www.openstreetmap.org).

[![IRC](https://img.shields.io/badge/IRC-%23osm--infrastructure-brightgreen)](https://webchat.oftc.net/?channels=osm-infrastructure)
[![Matrix](https://img.shields.io/matrix/osm-infrastructure:matrix.org?server_fqdn=matrix.org&logo=matrix)](https://matrix.to/#/#osm-infrastructure:matrix.org)

For architecture details see [docs/architecture.md](./docs/architecture.md).
For contributing to upstream see [openinframap/openinframap](https://github.com/openinframap/openinframap).
