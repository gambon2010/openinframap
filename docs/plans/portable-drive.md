# The app on an external drive (2026-11-20)

Asked for: the whole project on an external drive; on a Linux or Windows computer,
install Docker, plug the drive in, run one script, and the app runs 100% offline,
reading the maps from the drive, with nothing large copied to the computer except
what Docker must hold. Pulling the drive out must not damage anything.

Decided along the way (the options weighed are at the end):

- **The map database stays in Docker** (a volume on the computer), filled from the
  export on the drive. Postgres can't run from a read-only folder (it always writes
  its log and checkpoints), and on Windows it can't run from a Windows drive at all
  (Docker's virtual machine can't give the files a Linux owner; Postgres' own image
  documentation says to use a volume there).
- **Export and import stay**, made automatic: `run.sh` imports the export when the
  computer has none or an older one. The import already keeps each computer's My
  layers and accounts: no separate users' database.
- **The drive is only read** while the app runs (the maps, the export, the images):
  pulling it out can't damage anything; the database and My layers are on the
  computer.

## What changes, in short

| | Today | After |
|---|---|---|
| `data/` | everything mixed: the map, downloads, logs, this computer's certificate | `data/map/` (what the app needs), `data/local/` (this installation's), `data/downloads/` (deletable) — option A |
| Moving the app | copy the repo, `data/exports/`, `data/offline-maps/`, `data/images/`, `data/wikidata_json/` by hand, then import | `scripts/prepare-drive.sh /path/to/drive`: the code and `data/map/`, updates sending only what changed — option B |
| The maps (87 GB for France) | copied to each computer | read from the drive |
| The map database | imported by hand | imported by `run.sh` the first time and after an update |
| The frontend | Vite's dev server (Node.js, `npm install`) | built into the gate's image; development keeps `npm start` — option C |
| Starting | `start.sh` (needs uv, Node) | `run.sh` (bash and Docker only); `start.sh` stays the developer's |
| What the computer needs | Docker, Node.js, npm, uv, python3, curl | Docker and bash (on Windows: Docker Desktop, which brings WSL's bash) |

## The folders (option A)

```
data/
  map/            what the app needs: copied to the drive, only read when running
    offline-maps/     background maps, terrain, imagery, imagery.json
    images/           Wikidata pictures
    wikidata_json/    Wikidata text
    exports/          <region>.oimdb (the map database), docker-images.tar.gz
  local/          this installation's own: never overwritten by an update
    gate/             its https certificate (made on first start)
    userdata/         My layers' copy made during an import (put back after it)
    checks/, test-answers/, grid-check.csv
  downloads/      can be deleted any time: downloaded again when needed
    osm/, extra/, EEZ files, logs
```

The drive is a copy of the project folder: the code as committed, `data/map/`,
`data/installers/` (Docker and the development tools for computers without the
internet, `scripts/fetch_installers.py`), and its own `data/local/`. Never on the drive: `data/downloads/`, `node_modules/`, the
`.venv`s, `.git`, `.env` files.

**Two kinds of computer.** A development computer prepares the data (builds regions,
downloads maps: it keeps uv, Node.js, the internet); a computer that only runs the
app needs Docker and bash. Every script stays and keeps working on a development
computer. The drive gets the whole code, the data scripts included: with an
internet connection and uv installed, a computer running from the drive can add
data too (decided 2026-11-20).

## Steps

Each step ends with every test suite passing, committed; the app works between steps.

### 1. The data folders (A) — ✅ done (2026-11-20)

- Tests first: the scripts' tests use the new paths; a test lists what each folder
  may hold.
- `scripts/lib/common.sh` (`DATA_DIR`'s sub-folders), the Compose mounts
  (`data/map/...` read-only for the backend: checked first that it never writes there),
  the backend's paths, the docs.
- One-time move of the folders on this computer (the same disk: instant), asked
  before it runs.

### 2. The frontend in the gate's image (C)

- The gate's Dockerfile gets a build stage: `npm ci` and `vite build` (on this
  computer, online), the built files copied into the nginx image (Docker's documented
  multi-stage build; Vite's documented static deployment).
- The gate runs one of two ways, chosen by a setting in Compose (nginx's image reads
  its config from a template, its documented way of doing that):
  - development (`start.sh`): passes the page to Vite's dev server, as now;
  - built (`run.sh`): serves the built files.
- One build fits every drive: the map sources and the imagery list are read when the
  page opens (`config.ts` builds addresses from the page's own).
- The gate image is rebuilt by the export (`export-db.sh --docker-images`) whenever
  the frontend changed, so the export always carries a frontend matching its code.

### 3. The gate on Docker's own network

Nothing leaves the computer and the address stays https://<this computer>:8800; only
how the gate's container is connected changes.

- Today the gate runs on the host's network (`network_mode: host`) and reaches the
  services on 127.0.0.1. Docker Desktop (Windows) only has that behind an opt-in
  setting. The gate moves onto Compose's own network: it publishes 8800, reaches the
  services by name (`backend:8001`, `tegola:7800`), and in development Vite's dev
  server on the host by `host.docker.internal` (Docker's documented `host-gateway`).
- The services keep listening on 127.0.0.1 only; the gate stays the one way in.

### 4. `run.sh`: Docker and bash only (B, C)

At the project's root, for the drive (and any computer without the developer's tools):

1. Docker running? If not, says how to start it.
2. Loads the images from `data/map/exports/docker-images.tar.gz` if Docker hasn't
   them or has older ones (a list of the images' IDs saved beside the file).
3. Imports the map database if the computer has none or an older one than the
   export (the export's `<region>.json` against the database's build info). My
   layers kept, as the import does now.
4. Starts every service from the loaded images (`docker compose up --no-build`: the
   same Compose files, nothing built), the gate serving the built frontend.
5. Opens the browser (`xdg-open` on Linux, `explorer.exe` from WSL).

`run.sh stop` stops everything (before unplugging, if you want the map to close
cleanly; nothing is damaged without it).

The import's path made free of Python and uv: today `import-db.sh` writes the
imagery list with uv's Python and the database helpers read Compose's settings with
`python3`. The list is already in `data/map/offline-maps/` (written whenever the maps
change); the helpers read Compose's settings with `docker compose config` options
instead. A test runs `run.sh` with a `PATH` holding only bash, coreutils and Docker.

If the drive is pulled out while the app runs: the maps stop showing; the backend,
reading them through memory-mapped files, may crash and is restarted by Docker
(`restart: unless-stopped`), picking the files up again when the drive is back.

### 5. `scripts/prepare-drive.sh /path/to/drive` (B)

On the development computer:

1. Re-exports first if the database or the images changed since the last export.
2. Checks the drive: room enough (it prints the sizes), any file system (ext4, NTFS,
   exFAT: only read, nothing there needs Linux owners).
3. Warns about uncommitted changes (only committed code goes: `git ls-files`).
4. Copies with `rsync`: the code, `data/map/` (deleting on the drive what was
   deleted here: a removed map), `data/installers/`, never `data/local/` nor
   `data/downloads/`.
5. Prints what was sent and how to start: `bash run.sh`.

An update is the same command: `rsync` sends only what changed (the export after a
rebuild, new maps, code). On the next `run.sh` the computer imports the newer
export, keeping its My layers.

### 6. Windows, checked on a real computer (I can't test it here)

A checklist in LOCAL_DEVELOPMENT for the first try:

- Docker Desktop with WSL 2; the drive seen in WSL as `/mnt/<letter>`; `bash run.sh`
  from there.
- **Map speed:** the background map and imagery read through Docker's virtual machine
  from the Windows drive (our reader maps the files into memory, which that layer may
  make slow). If too slow: those files copied to the computer on Windows, a
  `run.sh` option.
- The gate reached at https://localhost:8800 from the Windows browser.

### 7. Tests, docs

- The real build test: Luxembourg built, exported, a "drive" prepared into a
  temporary folder, `run.sh` started from it with only bash and Docker, the map's
  routes answering; then an update prepared over it and started again, its My layers
  still there.
- Docs: LOCAL_DEVELOPMENT (the drive: preparing, running, updating, Windows),
  FORK_ARCHITECTURE (the folders, `run.sh`, `prepare-drive.sh`, the gate's two ways),
  CLAUDE.md (services, commands, `data/` gotchas), README (what you need), HISTORY.

## Sizes

| France (measured November 2026) | On the drive | On each computer |
|---|---|---|
| Offline maps | 87 GB | — |
| Map database | 2.3 GB (export) | 7.7 GB (Docker volume) |
| Docker images | 0.9 GB | about 2.5 GB loaded |
| Wikidata pictures and text | 0.5 GB | — |
| Code | under 0.1 GB | — |

Europe: about 16 GB of export on the drive, 53 GB of database on each computer.

## Weighed and left out

- **The map database as files on the drive:** Postgres can't use a read-only folder
  and can't run from a Windows drive; an unplug while it writes could damage it.
- **My layers and accounts in a database of their own:** not needed while the
  database stays in Docker (the import keeps them). Comes back if the map ever
  leaves Postgres.
- **A separate bundle folder made by the export** (B as first proposed): the drive
  is the project folder itself, which is simpler and updates with `rsync`.
- **The imagery list made by the backend** (C as first proposed): not needed, the
  list travels with the maps.
- **A `deploy/` folder** (C as first proposed): only `gate/` would move (upstream's
  folders can't, `docker-compose.override.yml` must stay at the root): little gain.
- **Everything as read-only files (PMTiles for the infrastructure, SQLite for search
  and details), no Postgres for the map:** the only design with nothing large
  copied to the computer, at the cost of rewriting the backend's data side (weeks).
  Later, if loading Europe's database on each computer becomes the problem.

## Reuse

Docker's `save`/`load` and multi-stage builds, nginx's config templates, Vite's static
build, `rsync`, Docker's `host-gateway`: each the tool's documented use.

## Effort

About two to three days for steps 1 to 5 and 7; step 6 needs a Windows computer.
