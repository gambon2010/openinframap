# The app on an external drive (2026-11-20)

Asked for: the whole project on an external hard drive; on any computer, install
Docker, plug the drive in, and the app runs from it, 100% offline, serving every map
from the drive, with nothing large copied to the computer. The Docker images may be
loaded into Docker from the drive (a one-time step, under 1 GB). The map database
lives as files on the drive (no restore), and the users' own data (My layers,
accounts) is a database apart, so an update of the map never touches it.

## What changes, in short

| | Today | After |
|---|---|---|
| The map database | a Docker volume on the computer; moved by export, then restore | files in `data/map/database/`, served where they are |
| My layers, accounts | in the map database (`userdata` schema), kept across imports by a dump and restore | their own database, `data/local/userdata/`, never replaced by an update |
| Tower number register | `userdata` (kept on each computer, numbers made again after an import) | in the map database: numbered once, where it's built, the same on every computer |
| The frontend | Vite's dev server (Node.js on the computer) | built, inside the gate's image (development keeps `npm start`) |
| What the computer needs | Docker, Node.js, npm, uv, python3, curl | Docker and bash |
| Moving the app | export, copy four things, import | copy the project folder (`scripts/prepare-drive.sh`) |

## Requirements on the drive and the computer

- **The computer: Linux**, with Docker Engine. On Windows or macOS, Docker runs in a
  virtual machine and a database on an external drive through it is slow and
  unreliable: not supported (Open question 1).
- **The drive: formatted ext4** (or another Linux file system). Postgres needs file
  owners and permissions and a reliable `fsync`: exFAT and NTFS can't hold the
  database. `prepare-drive.sh` checks the file system and refuses others.
- **An SSD over USB 3 recommended.** A hard disk works; the first view of each area
  is slower (Tegola reads Postgres, then keeps tiles to zoom 13 in its container).
- **Stopped before unplugged:** `run.sh stop` shuts Postgres down cleanly. Pulling the
  drive out while it runs can damage the database, as with any database.

## The folders

```
data/
  map/            the map: copied to the drive, replaced as a whole on update
    database/       the map database's files (Postgres, owned by its container's user)
    offline-maps/   background maps, terrain, imagery, imagery.json
    images/         Wikidata pictures
    wikidata_json/  Wikidata text
    docker-images.tar.gz
  local/          this installation's own: never overwritten by an update
    userdata/       My layers and accounts (their own Postgres)
    gate/           the https certificate (made on first start)
    checks/, test-answers/, grid-check.csv
  downloads/      can be deleted any time: downloaded again when needed
    osm/, extra/, EEZ files, logs
```

The same layout on the development computer and on the drive: the drive is a copy of
the project folder without `data/downloads/`, `node_modules/`, the `.venv`s and git's
history.

## Steps

Each step ends with every test suite passing, committed; the app works between
steps.

### 1. Tests first: what touches the users' data

- List every query that reads or writes `userdata.*` (backend, schema, scripts) and
  check none joins it to the map's tables (first look: none does; joins stay inside
  `userdata`). Any that does gets rewritten as two queries before the split.
- Tests that pin today's behaviour: My layers survive a map update; the tower
  register keeps a tower's number across a rebuild; accounts and sessions work.

### 2. The users' database apart

- A second Postgres service, `userdb` (the same PostGIS image: My layers hold
  geometries), its files in `data/local/userdata/`, listening on 127.0.0.1 only.
- The backend gets `USERDATA_URL` beside `DATABASE_URL`: `userdata/`, `auth/` and the
  sessions use it; the numbered migrations run there (never edited: they run on a
  new database as on the old one).
- **The tower register moves to the map database** (`schema/fork/`): numbering is a
  build step, done where the map is built, so every computer shows the same numbers
  and an update needs no numbering. `number-towers.sh` and the build use it there.
- One-time move on this computer: `userdata` dumped from the map database and
  restored into `userdb` (accounts, layers, history, situations); the register
  copied into the map database; then the `userdata` schema dropped from the map
  database. Asked before it runs; the dump kept in `data/local/` until you delete it.
- `put_back_my_layers` and the userdata dump around builds go: a rebuild no longer
  touches the users' database.

### 3. The map database as files

- The `db` service stores its files in `data/map/database/` (a bind mount) instead of
  the `postgres_data` volume.
- One-time move on this computer: the database stopped, its files copied from the
  volume into the folder through a container (they belong to Postgres' user, uid
  999: no `sudo`), checked by starting it there; the old volume kept until you
  delete it.
- `build-region.sh` builds straight into it, as now.
- **Export and import go** (one way to move the app: the folder). `export-db.sh` and
  `import-db.sh`, the `.oimdb` format and their tests are removed (Open question 2).

### 4. The data folders as above

- `data/map/`, `data/local/`, `data/downloads/`: the paths in `scripts/lib/common.sh`,
  the Compose mounts, the backend's paths, the docs.
- One-time move of the folders on disk (same disk: instant), asked before.

### 5. Runs with Docker and bash only

- **The frontend built into the gate's image:** a build stage runs `vite build`, nginx
  serves the files. The gate has two ways of running: in development it passes the
  page to `npm start` (instant reload, as now); on the drive it serves the built
  files. The imagery list and every map source are read at runtime already, so one
  build fits any data.
- **`run.sh` at the project's root**, for the drive: loads the Docker images from
  `data/map/docker-images.tar.gz` if Docker hasn't them (or has older ones), starts
  every service, opens the browser; `run.sh stop` stops them all. It needs only bash
  and Docker: no Python, uv, Node or curl (the imagery list is already on the drive,
  written whenever the maps change). `scripts/start.sh` stays the developer's start.
- The images to load: db (also `userdb`'s), tegola, backend, gate. The build tools'
  images (imposm, osmium, LOOM, go-pmtiles) stay off the drive: nothing builds there.

### 6. Preparing and updating a drive

`scripts/prepare-drive.sh /path/to/drive`, on the development computer:

1. checks the drive: ext4, room enough (it prints the sizes);
2. stops the map database cleanly (files consistent);
3. saves the Docker images to `data/map/docker-images.tar.gz` if they changed;
4. copies the project with `rsync`: the code (without `node_modules`, `.venv`s,
   `.git`), `data/map/` (the database's files through a container, keeping their
   owner), never `data/local/` nor `data/downloads/`;
5. starts the database again here.

The first time, the drive gets an empty users' database and asks for its first admin
account at first start (as a new install does now). An update is the same command:
`rsync` sends only what changed (the database's files after a rebuild, new maps,
the code), the drive's My layers and accounts untouched.

### 7. Tests, docs

- The real build test: Luxembourg built, a drive prepared into a temporary folder,
  `run.sh` started from it with a `PATH` holding only bash and Docker, the map's
  routes answering; then an update over it, its My layers still there.
- Docs: LOCAL_DEVELOPMENT (the drive: preparing, running, updating, unplugging),
  FORK_ARCHITECTURE (the two databases, the folders, `run.sh`), CLAUDE.md (services
  table, commands), README (what you need on the computer), HISTORY.

## Sizes on the drive (France, measured November 2026)

| | |
|---|---|
| Map database files | about 7.7 GB |
| Offline maps (background, terrain, imagery, IGN photos as downloaded) | 87 GB |
| Wikidata pictures and text | 0.5 GB |
| Docker images | about 0.9 GB |
| Code | under 0.1 GB |

Europe: about 53 GB of database files, plus its maps (README's table).

## Open questions

1. **Linux only on the target computers?** (Windows or macOS would need the database
   copied off the drive, or a different design.)
2. **Remove export/import entirely**, or keep the `.oimdb` file as a backup format
   (a compressed copy of the map database, 2.3 GB for France against 7.7 GB of files)?
   The rules say one way; a backup is a different job, if you want one.
3. **Several drives or computers sharing My layers** is not part of this plan (each
   drive has its own users' database); live sharing is in the battle-tracking
   backlog.

## Reuse

Nothing invented: Postgres' own data folder in a bind mount (the official image's
documented `PGDATA` use), `rsync` for copies and updates, Docker's `save`/`load`
for images, nginx serving Vite's build (Vite's documented static deployment), a
multi-stage Dockerfile for the gate (Docker's documented pattern).
