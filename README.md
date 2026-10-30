# Open Infrastructure Map — Offline Local Dev Fork

This is a fork of [openinframap/openinframap](https://github.com/openinframap/openinframap)
that runs Open Infrastructure Map **entirely on your own computer**: your own database,
tile server and backend, built from OpenStreetMap data for the region you choose, from
one country up to the whole world. A built database can be exported and copied (e.g. on
a USB drive) to a computer without internet access.

On top of upstream's power, telecoms, oil and gas, and water layers, it adds:

- **Critical sites** from OpenStreetMap: hospitals, fire stations and police; town halls,
  prefectures, tax offices and other public services; places of worship (an icon per
  religion); fuel stations, depots and gun shops; airports, ports and border controls;
  military sites (and disused bunkers and trenches, separately); supermarkets,
  wholesalers, silos and food distribution; dams, landfills and weather stations.
  Shown at every zoom: zoomed out, nearby sites are grouped into a numbered bubble.
- **Open data from outside OpenStreetMap**, drawn like the OSM data and labelled with its
  source, kept apart and never duplicating it. So far for France: every low- and
  medium-voltage power line and street substation (~15 million features), the gas
  distribution network (4.3 million pipes), biomethane injection points (Agence ORE), and
  the regulated industrial sites including Seveso sites (Géorisques ICPE, 40,000).
- **A key that hides things**: untick any line, icon or area type to take it off the map.

The background map can be downloaded per region (full or reduced detail) and served
locally too; otherwise it comes from openinframap.org. The search box finds places
(cities down to hamlets) and every named feature on the map offline; street
addresses need an optional Photon server.

## Getting started

Needs Docker (with Compose v2), Node.js/npm, curl, python3 and unzip; plus
[uv](https://docs.astral.sh/uv/) for the open data from outside OpenStreetMap (and the
offline Wikidata photo cache).

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
| **Satellite imagery** | Optional in `build-region.sh`, offline: NASA Blue Marble (zoom 0–8), Sentinel-2 10 m for the region (to 12/13), IGN 20 cm aerial photos in France; Settings → Background |
| **Background map** | Optional offline copy per region (Protomaps extract, `basemap` service); Settings window to see and change the URL for the current tab |
| **Grid connections** (prototype) | Pick two substations or plants; the map shows up to three paths between them over lines of 110 kV and more, stretch by stretch. Clicking a power line highlights where it goes |
| **Backend** | Runs in Docker (Compose service `backend`), so it needs no Python setup and works offline |
| **Search** | Offline place search (cities to hamlets) from the local database instead of OpenCage; everything else with a name too (critical sites, lines, telecoms, pipelines, water, ICPE...: `schema/search.sql`), with its kind and town, accents optional, name + town ("mairie duppigheim"), and picking a result switches its layer on; words inside names match ("vianden" → "Centrale de Vianden"); optional Photon server for addresses (`VITE_PHOTON_URL` or Settings) |
| **Stats pages** | Per-country stats computed at build time, with a query that's fast for countries like Russia |
| **Critical sites** | `imposm/sites.py` + `schema/sites.sql`: ~210,000 sites in France in 41 kinds, shown at every zoom from 4 (nearby ones grouped into a numbered bubble below zoom 14), a "Critical sites" layer-switcher group with one entry per category, icons from Maki |
| **Extra data** | `scripts/extra_data.py`: imports open data that covers the built region (French electricity and gas networks, biomethane, ICPE) into an `extra` schema; the build offers each dataset with its size; what OSM already has is left out; raw downloads and imported data are kept across rebuilds |
| **Key** | Every row has a checkbox to hide those features; remembered per browser |
| **My layers** | Your own layers on the map: military and emergency symbols (MIL-STD-2525C, as in ODIN), pictures, markers, lines, areas and copies of map features (which stay visible when the grid is hidden); saved in the database, with a history you can play back step by step |
| **Wikidata popups** | `scripts/fetch_images.py` caches entity data and photos in `data/`; the backend serves them offline |
| **URLs** | Backend, Tegola and background-map URLs configurable in `web/.env` (`VITE_BACKEND_BASE_URL`, `VITE_TEGOLA_URL`, `VITE_BASEMAP_URL`, `VITE_TILE_BASE_URL`) |
| **UI** | Layers, key and My layers open on click beside the buttons, one at a time, all panels with one look; Settings window (map sources) in the header; background switch (OpenStreetMap / online-only night lights) hidden |

## Upstream project

The upstream project is [Open Infrastructure Map](https://openinframap.org), a map of the
world's infrastructure from [OpenStreetMap](https://www.openstreetmap.org).

[![IRC](https://img.shields.io/badge/IRC-%23osm--infrastructure-brightgreen)](https://webchat.oftc.net/?channels=osm-infrastructure)
[![Matrix](https://img.shields.io/matrix/osm-infrastructure:matrix.org?server_fqdn=matrix.org&logo=matrix)](https://matrix.to/#/#osm-infrastructure:matrix.org)

For architecture details see [docs/architecture.md](./docs/architecture.md).
For contributing to upstream see [openinframap/openinframap](https://github.com/openinframap/openinframap).
