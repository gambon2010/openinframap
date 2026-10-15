# Local Development

This guide gets you from a fresh clone to Open Infrastructure Map running on your
own computer: your own database, tile servers and backend, built from OpenStreetMap
data for the region you choose. Once set up, everything can work without internet,
including searching for places; only street-address search needs an optional Photon
server.

For *what* the fork changed and *why*, see [FORK_CHANGES.md](./FORK_CHANGES.md).

---

## Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Docker + Compose v2 | Docker 24+ | `docker compose` (not `docker-compose`). Runs the database, Tegola and the backend |
| Node.js + npm | Node 20+ | Runs the frontend |
| curl, python3, unzip | any | Used by the setup scripts |
| [uv](https://docs.astral.sh/uv/) | any recent | **Optional:** for the Wikidata cache script, and to run the backend outside Docker |
| Free disk space | depends on region | The raw extract (46 MB for Luxembourg, 33 GB for Europe, ~95 GB for the world) plus the database (roughly 1 GB for Russia). The script checks before starting |

`launch.sh` checks these and tells you what's missing; it never installs anything.

---

## Quick start

```bash
git clone <your-fork-url>
cd openinframap
bash scripts/launch.sh
```

`launch.sh`:

1. Checks the prerequisites.
2. If there's no map database yet, runs `build-region.sh` (below) so you can pick a
   region, or import a ready-made one.
3. Creates `web/.env` and `web-backend/.env` if they don't exist.
4. Starts the Tegola tile server.
5. Asks **"Start the app now?"**: it starts the backend (Docker), opens the frontend
   in a new terminal window, and opens http://localhost:5173 in your browser once
   it's up.
6. Offers to fill the Wikidata cache for offline popups (with a time estimate).

For a quick test, pick **Luxembourg**: it builds in under a minute.

**Every time after that:**

```bash
bash scripts/start.sh
```

It asks nothing: it starts the database, Tegola and the backend, opens the frontend
window and the browser. Anything already running is left alone.

**To stop:** Ctrl+C in the frontend window (or close it), then `docker compose stop`.

---

## Building the map database

```bash
bash scripts/build-region.sh
```

It starts by listing what's already on this computer (downloads, exports, EEZ
boundaries, Wikidata cache, recent builds), then shows a menu:

```
      1) Africa                     7.4GB
      ...
      8) Russian Federation         3.9GB  ✓ downloaded 2026-10-14
      9) South America              3.9GB
     10) Whole world (planet)        89GB  slow — takes hours, see the warning
     11) Luxembourg                  23MB  ✓ ready-made export (OSM data as of 2026-10-13) — imports in minutes
     12) Search for a country, state or province...
     13) Use an .osm.pbf file I already have
```

All questions come first; after that it runs unattended:

1. **Download** from Geofabrik (or planet.openstreetmap.org for the world) to
   `data/osm/`. Resumable and checksum-verified. If you already have the region and
   Geofabrik has a newer extract, it asks; the default is to keep yours.
2. **Filter** it down to infrastructure with osmium. The filter is generated from
   the imposm mapping, so the imported data is the same, just much faster
   (Russia: 3.9 GB → 53 MB).
3. **Wipe** the local database and **import** with imposm.
4. **Views, stats tables, places for the search box and search indexes.**
5. **EEZ country boundaries** (see [below](#eez-country-boundaries)) and a
   per-country stats snapshot.
6. **Restart Tegola** so it doesn't serve tiles from the old data.
7. **Background map** (optional, see [below](#offline-background-map)): download it
   for offline use, in full or reduced detail.

If a region has a ready-made export, choosing it asks
**"Import it? (No = download and rebuild from scratch)"**.

Unattended, e.g. on a server or for batch builds:

```bash
bash scripts/build-region.sh --region europe --yes
bash scripts/build-region.sh --region planet --yes          # whole world
bash scripts/build-region.sh --pbf ~/my-extract.osm.pbf --yes
bash scripts/build-region.sh --region russia --rebuild --yes   # ignore an export
bash scripts/build-region.sh --help                          # all options
```

**Build history:** `data/osm/build-history.log` records every build, export and
import, and whether it finished, failed (and at which step) or was interrupted.

### Typical times

Measured on this project's dev machine; your download speed dominates.

| Region | Download | Filtered | Build |
|--------|----------|----------|-------|
| Luxembourg | 46 MB | 0.3 MB | ~30 s |
| Russia | 3.9 GB | 53 MB | ~1.5 min (after download) |
| Whole world | ~95 GB | est. a few GB | est. a few hours, mostly download and filtering |

---

## Offline background map

The background map (streets, buildings, place names) comes from openinframap.org
unless you download it. `build-region.sh` asks, showing the real sizes for the
region:

```
      1) Full detail         67MB  streets and individual buildings at every zoom
      2) Reduced detail      24MB  streets and places; blurry when zoomed in close
      3) Skip                 —  keep using the online background map
```

Sizes grow quickly with area. Roughly: France 9.5 GB full / 2.3 GB reduced,
Russia 26 / 7.4 GB, Europe 49 / 13 GB, the whole world ~139 GB at full detail.

It's cut from [Protomaps](https://protomaps.com)' daily world map and saved as
`data/basemap/<region>.pmtiles`. A small server (`docker compose up -d basemap`,
port 8090) serves it, and `web/.env` gets
`VITE_BASEMAP_URL=http://localhost:8090/<region>/{z}/{x}/{y}.mvt`. Restart the
frontend after that changes. Re-running the build offers to refresh it with newer
map data. Unattended: `--basemap full`, `--basemap reduced` or `--basemap none`.

## Sharing a built database (export / import)

Building a big region, and especially the world, takes time. Save it once:

```bash
bash scripts/export-db.sh
```

This writes:
- `data/exports/<region>.oimdb`: the database, compressed (Luxembourg: 23 MB).
- `data/exports/<region>.json`: region, OSM data date, checksum.
- Optionally `data/exports/docker-images.tar.gz` (~460 MB, shared by all exports):
  the project's Docker images, so a computer **without internet** can run it.

On another computer, copy the project folder (e.g. to a USB drive) and run
`bash scripts/launch.sh`. The region menu offers the export; importing takes
seconds to minutes instead of rebuilding. You can import directly too:

```bash
bash scripts/import-db.sh data/exports/russia.oimdb
```

The import checks the file isn't damaged and warns if the export was made with a
different version of the import mapping or views.

**What to copy:**

| Folder | Copy it? |
|--------|----------|
| `data/exports/` | Yes: the databases and Docker images |
| `data/images/`, `data/wikidata_json/` | Yes, for offline popups |
| `data/basemap/` | Yes, if you downloaded an offline background map |
| `data/EEZ_*` | Yes, so future rebuilds don't need the manual download |
| `web/node_modules/` | Yes, so the frontend starts offline |
| `data/osm/` | No: the raw downloads (4 GB for Russia, ~95 GB for the world), only needed to rebuild |

---

## EEZ country boundaries

EEZ = Exclusive Economic Zone. This marineregions.org dataset has one shape per
country covering its land and sea, and the backend uses it to assign features to
countries, including offshore ones. **Search and the `/stats` country pages need
it**; the map works without it.

It's free (CC-BY 4.0) but behind a short form, so it's the one manual download.
`build-region.sh` explains it, prints the link and opens the page:

1. Open https://marineregions.org/download_file.php?name=EEZ_land_union_v4_202410.zip
2. Fill in the form and download `EEZ_land_union_v4_202410.zip` (~19 MB).
3. Leave it in `~/Downloads`, or save it in `data/`.

Type `skip` to build without it. Once the zip is there, every later build imports
it automatically.

---

## The backend

The backend (stats pages, search, Wikidata popups) runs in Docker as the `backend`
service on port 8001. `start.sh` and `launch.sh` start it.

```bash
docker compose up -d backend
docker compose logs -f backend    # its log
```

**Developing the backend?** Run it on the host instead, with auto-reload:

```bash
docker compose stop backend
cd web-backend
cp .env.example .env              # launch.sh creates it for you
uv run uvicorn src.main:app --reload --port 8001
```

---

## Environment files

`launch.sh` creates both if they're missing.

### `web/.env`

```
# Night-lights tiles, and the background map unless VITE_BASEMAP_URL is set.
VITE_TILE_BASE_URL=https://openinframap.org
# Infrastructure tiles from the local Tegola.
VITE_TEGOLA_URL=http://localhost:7800
# The local backend.
VITE_BACKEND_BASE_URL=http://localhost:8001
# Background map server (Protomaps schema), full {z}/{x}/{y} URL. build-region.sh
# sets it when you download an offline background map.
VITE_BASEMAP_URL=http://localhost:8090/luxembourg/{z}/{x}/{y}.mvt
# Optional Photon server for street-address search (not set up by the scripts).
# VITE_PHOTON_URL=http://localhost:2322
```

### Changing the background map without editing `.env`

The **Map sources** button (the server icon under the key, top right) shows which
background-map URL is in use and where it comes from (built-in default, `web/.env`,
or this tab). You can paste another `{z}/{x}/{y}` URL there and it switches
immediately; **"How do I change the default?"** explains the `web/.env` setting.
Changes made in the panel only last until you close the browser tab.

### `web-backend/.env`

Only used when running the backend on the host (the Docker service sets its own).

```
DATABASE_URL=postgresql+asyncpg://osm:osm@localhost:5432/osm
# DEBUG=true    # disables HTTP cache headers
```

---

## What works offline

| Feature | Offline? |
|---------|----------|
| Infrastructure map (power, telecoms, pipelines, water) | Yes, from local Tegola |
| Background map (roads, buildings, labels) | Yes if you downloaded it for the region; otherwise from openinframap.org |
| Night-lights background | Not available: online only, and its switch is hidden |
| Search for places (countries, cities, towns, villages, hamlets, suburbs, islands) | Yes, for the built region. Cities and towns are listed before infrastructure with the same name |
| Search for power plants and substations | Yes. Names that start with what you type come first, then names with a word that does ("vianden" also finds "Centrale de Vianden") |
| Search for coordinates | Yes |
| Search for street addresses | Only with a [Photon](#optional-photon-address-search) server |
| `/stats` and country pages | Yes (need the EEZ boundaries) |
| Wikidata popups | Yes, for what's in the cache; otherwise fetched online |

The map only has data for the region you built; elsewhere the infrastructure layers
are empty. There are no live updates: rebuild to refresh.

---

## Optional: Photon address search

Places in your region are found without any extra setup. For street addresses (and
places outside your region) the app can also ask a
[Photon](https://github.com/komoot/photon) server. Setting one up isn't handled by
the scripts: pre-built indexes are large (Europe 32 GB, world 63 GB). Once you have
one, set it in `web/.env` and restart the frontend:

```
VITE_PHOTON_URL=http://localhost:2322
```

or try it for the current tab in the **Map sources** panel ("Address search
(Photon, optional)"), which also checks that the server answers.

## Grid connections between two stations (prototype)

Click a substation or power plant and choose **Route from here**, then another and
choose **Route to here**. A panel lists up to three distinct paths over lines of
110 kV and more, each broken down into the stretches between the substations and
plants it passes through (distance and voltage each), with the total at the end, and the map draws them in
different colours; click a path to show only that one, × to clear. A station that
is only on a lower voltage (e.g. a wind farm on a 65 kV line) is connected over
those lines to the nearest station on the 110 kV+ grid; those stretches show
their lower voltage in the breakdown. The route is kept
in the map link, so you can share it.

Clicking anything on the map shows its details in a **panel on the left** (not a
popup over the map) and highlights it: icons get a glowing circle, areas an
outline, lines a glow. A **power line** is highlighted up to the stations at its
ends; the panel names them and the length, and **Show whole line** zooms to it.
**–** minimises a panel (the highlight stays), **×** closes it (the highlight goes). Needs a database built with this feature
(`build-region.sh` builds the network automatically).

## Wikidata image cache

When you click a feature with a `wikidata` tag, the popup asks the backend for
`/wikidata/{id}`. The backend serves `data/wikidata_json/{id}.json` and
`data/images/{id}.*` if they're cached, and only otherwise calls Wikimedia.

```bash
uv run scripts/fetch_images.py --json-only   # text only, seconds
uv run scripts/fetch_images.py               # text and photos, 1 photo/second
uv run scripts/fetch_images.py --count       # how many are missing
```

It follows [Wikimedia's API etiquette](https://www.mediawiki.org/wiki/API:Etiquette)
(one request per second, batched, descriptive User-Agent), so a continent can take
hours. Re-running skips what's cached; stop and resume any time. The cache is keyed
by Wikidata ID, so it's shared across regions.

---

## Updating the data

Re-run `bash scripts/build-region.sh` and pick the region. It reuses your download
unless you choose the newer extract (or pass `--refresh`). Then
`uv run scripts/fetch_images.py` picks up new Wikidata IDs.

---

## Troubleshooting

**A step seems stuck.** Long steps show a timer. The longest are downloading, the
osmium filter (it reads the whole file) and the imposm import. If the per-country
stats step takes more than a minute, check you're on the current
`schema/local-stats.sql`: the production query took 14+ minutes on Russia.

**"The app already seems to be running", but it isn't working.** Something else is
on port 8001 or 5173, e.g. a backend you started by hand. Stop it, or use it.

**Search finds nothing / the country pages return 500.** The EEZ boundaries weren't
imported. Re-run `build-region.sh` with the zip in `data/`.

**Place search doesn't find towns.** Places come from the database built after this
feature was added; rebuild the region (or import a newer export) once. Only places
in the built region are found.

**The backend returns errors right after a rebuild.** A backend running on the host
reconnects on its own now; if you're on an old checkout, restart it. The Docker
backend is restarted by `start.sh`.

**The new terminal window can't find `npm` or `uv`.** The script passes its own
`PATH` to the window; make sure the tools are on the `PATH` of the shell you run the
script from.

**Fedora / SELinux "permission denied" in containers.** Mounts use the `:z` label.
If you add your own mounts, add `:z` too.

**"Docker is installed but not running".** Start Docker
(`sudo systemctl start docker`) and make sure your user can run `docker ps`.

**Not enough disk space.** Docker keeps its data in `/var/lib/docker` by default,
often on the system disk. The script shows the estimate before starting. Downloads
and filtered files in `data/osm/` are reused, so after freeing space just re-run.
