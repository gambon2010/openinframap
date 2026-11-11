# Clean-up audit (2026-11-11)

Status: **findings, nothing changed yet**. A read-only survey of the whole project
for a global clean-up: by searches, counts and tools (ruff, mypy, shellcheck, tsc),
not by reading every file. Type G (simplifying logic) needs reading the code: only
candidates by size are listed there. Choose from the list; each item is then done
on its own, tests passing before and after.

## The rule that settles the conflict

Staying close to upstream (N) pulls against splitting, renaming and restructuring
(F, H, I). So: **F, H and I only on the fork's own files** (`web/src/fork/`,
`web-backend/src/fork/`, `scripts/`, the fork's `schema/*.sql`, `gate/`, docs).
Upstream's files are only ever touched to make the fork's edits smaller.

## Order

Tests first (K) → deletions (A, C, B, E) → duplicates (D) → structure (F, H, I) →
docs last (L). Deleting first avoids refactoring code about to go.

## Overall state

Better than expected: the fork's code has almost no debris.

| Part | Size | Lint / types | Debris |
|---|---|---|---|
| Frontend `web/src/fork/` | 18,300 lines + 5,150 of tests (56 files) | eslint clean; tsc: only upstream's 31 errors | 1 `console.info`, 0 TODO, 2 `any`, 19 `as unknown as`, 0 `@ts-ignore` |
| Backend `web-backend/src/fork/` | 4,540 lines, 16 test files | ruff, mypy clean | 0 TODO, 10 `type: ignore`, 2 broad `except Exception` |
| Scripts | 2,900 lines of shell, 6,570 of Python, 12 test files | ruff: 4 small; shellcheck: 7 warnings | 0 TODO; every script has `set -euo pipefail` |

Upstream is fully merged (0 commits behind `upstream/main`).

## Findings

### 1. Secrets and git history: nothing to fix
- No keys, passwords or `.env` files in tracked files or in the history.
- `web/src/geocoder.ts` holds an OpenCage key: it is **upstream's own**, public in
  their repository, and the file is unused here (see A).
- `web-backend/.env.bak` (untracked, a `DATABASE_URL`, same keys as `.env`): delete
  it, and add `*.bak` to `.gitignore` so it can't be committed by accident.

### 2. Leftovers on disk: where the space is (about 110 GB reclaimable)
| What | Size | Note |
|---|---|---|
| `data/region.osm.pbf` | **34 GB** | From April, the old one-file download; nothing uses it (only an old doc line names it) |
| Docker build cache | **39.8 GB** | All projects on this computer, not only this one |
| Docker images | **38 GB** reclaimable | 103 images, 89 of them untagged leftovers of rebuilds |
| `data/osm/russia-latest.osm.pbf` | 4.2 GB | A region no longer built (France is); `saarland` too |
| `data/osm/france-latest.osm.pbf` | 5.1 GB | Kept on purpose (rebuilds without downloading) |
| `web/dist` | 85 MB | A production build, made by today's checks |
| Logs in `data/` | 5 MB | `bdortho-france.log` and the downloads' logs |

Deleting is yours to decide; nothing here is removed without asking.

### A. Dead code
- **Upstream files nothing imports:** `web/src/geocoder.ts`, `web/src/search/opencage.ts`,
  `web/src/elements/tab-pane.ts`. (Removing upstream files costs a line each in the
  merge notes; the first two were already replaced.)
- **Packages never imported:** `@ts-stack/markdown`, `lodash.invert`, `lodash.sortby`
  (upstream's `package.json`; check upstream before removing).
- **Fork:** `tiles_in_outline` (`scripts/satimagery/tiles.py`, only its test uses
  it); one unused string (`layers.buildings`); the `console.info` of every clicked
  feature (`modules/details/index.ts:48`); shell variables never used (`DIM`,
  `CURRENT_STEP`, `DOCKER_IMAGES_TAR`); the Osmose icons (`validation_error*`).
- **Exports nobody else uses:** 37 names exported from fork files but used only
  inside their own file, and 57 exported only for tests. Harmless, but they make
  each file's real interface harder to see.
- **Upstream's about page** still credits OpenCage (`web-backend/src/templates/about.html`);
  the fork replaces that page.

### B. Superseded paths (the biggest single item)
The old satellite questions live on beside the new offline maps menu:
- `scripts/satimagery/menu.py` (676 lines): `Planner`, `choose_bdortho`,
  `command_choose`, `command_steps`. The new menu only takes five small things
  from it (`Index`, `detailed_file`, `detailed_job`, `job_estimate`, a speed).
- In the shell: `choose_satellite`'s presets, `download_satellite`'s plan steps,
  `satellite_step`, `.satellite-plan.json`, and `run_parallel` (used only there).
- The options `--satellite`, `--satellite-detailed`, `--area`, `--zoom`, `--sources`
  on both scripts, and their tests.
Removing it: about 900 lines of code and tests. It needs the new menu's unattended
mode to cover what those options did (it covers IGN, Sentinel-2, Blue Marble and
background maps; **not yet the tile-server aerial sources**).

### C. One-time migration code
- `catch_up_lower_zooms` / `satellite.py lower-zooms`: adds lower zooms to imagery
  files made before aerial photos started at zoom 12. Your files are all current.
- The old file name `<area>.sat-detailed.pmtiles` (before several sources) and the
  per-region Blue Marble file (`luxembourg.sat-overview`, superseded by the world's).
- `select_basemap` removing the old 8090 address and `VITE_TILE_BASE_URL`.

### D. Duplicates
- `human()`, `duration()`, `say()`, asking helpers: in both `menu.py` and `ui.py`
  (goes away with B).
- Reading a PMTiles header: `gdal.py` (Python, twice), `lib/basemap.sh` (Python
  inside shell, twice), the backend. One reader for the scripts would do.
- A background map's edition read from its `.json`: `inventory.py`, `maps.py`, the
  backend (the backend's copy is a separate program: it stays).
- "Run a backend command in Docker": three times in `lib/db.sh`, once in `extract.py`.
- The département code normaliser: three copies (`menu.py`, `maps.py` twice).
- Four different client names for downloads (`netsafe.py`, `sources/__init__.py`,
  `extradata/base.py`, `fetch_images.py`).
- Tests: a "fake PMTiles file" helper written in six test files.
- Frontend: the details table built by hand in `extra` and `buildings`; the map
  credit line in `sites` and upstream's `style.ts`.

### E. Compatibility layers
- `DETAILED_SOURCES`, `DETAILED_DEFAULTS`, `TIERS`, `AVERAGE_TILE_BYTES` and the size
  constants rebuilt from the source files for the older code
  (`sources/__init__.py`). Most go with B; `cli.py`, `estimate.py`, `bdortho.py`
  then read the sources directly.
- `measure/geo.ts` re-exporting `area` / `formatArea` from `core/geo.ts`.

### F. Large files (fork's own only)
| File | Lines | What's in it |
|---|---|---|
| `scripts/build-region.sh` | 884 | Options, every question, every build step |
| `scripts/satimagery/maps.py` | 879 | One class: every screen and every source's jobs |
| `scripts/satimagery/bdortho.py` | 517 | Listing, download, extraction, tiles, the command |
| `scripts/satimagery/cli.py` | 507 | Every command and all their options |
| `web/src/fork/modules/userlayers/map/render.ts` | 564 | Drawing My layers |
| `web/src/fork/modules/userlayers/state/store.ts` | 463 | My layers' state |
| `web/src/fork/modules/userlayers/map/layers.ts` | 408 | My layers' map layers |
| `web/src/fork/modules/grid/grid-route.ts` | 386 | The route panel |
| `web-backend/src/fork/grid/route.py` | 384 | Routes over the grid |
The rest of the fork is under 370 lines a file.

### G. Complicated logic
Not judged by this survey (it needs reading). First places to read: the files of F,
`fork/ui/highlight.ts` (266), `line_trace/trace.py` (290), `userdata/changes.py` (251).

### H. Names that no longer fit
- `data/basemap/` holds satellite imagery, aerial photos, background maps, the
  inventory and the queue: "offline maps" (`data/maps/`?). Touches every script,
  Compose, the backend's mount, the docs, and your 56 GB of files (a folder rename,
  instant): only once the IGN download is finished.
- In the scripts: `BASEMAP_DIR`, `lib/basemap.sh`, `--basemap-dir`, `select_basemap`,
  `BASEMAP_CHANGED`. `scripts/satellite.sh` / `satellite.py` / `satimagery/` are now
  the offline maps menu.
- The fork's SQL files sit in `schema/` beside upstream's with nothing in their
  name to tell them apart (`grid.sql`, `sites.sql`, `extra.sql`, `search.sql`,
  `places.sql`, `eez.sql`, `local-stats.sql`, `distances.sql`, `tower-numbers.sql`,
  `buildings.sql`); Tegola's and the frontend's use `.fork.`.

### I. Structure
- The folder rules are enforced by a test on the frontend only
  (`structure.test.ts`); nothing checks the backend's or the scripts'.
- `docs/architecture.md` (upstream's, 40 lines) beside `docs/ARCHITECTURE.md` (the
  fork's): one letter case apart, which breaks on a disk that ignores case.
- Six local branches merged long ago (`distribution-data`, `grid-routing`,
  `local-dev-setup`, `user-layers`; `main` is a month behind `ui-rework`).

### J. One way to do each thing; one source of truth across languages
- The PMTiles program's version (`protomaps/go-pmtiles:v1.28.0`): Compose, three
  option defaults in `cli.py`, `extract.py`.
- Ports: each in 3 to 8 files (Compose, the gate, the scripts, the frontend).
- The sizes that make a building "large" at each zoom: in Tegola's SQL (600, 2,500,
  10,000) and the backend (600); the zooms in the frontend.
- Sentinel-2's first zoom: shell and Python (a test checks they agree: the model
  to follow for the others).

### K. Tests
- The frontend run builds its fake browser 55 times (70 s of a ~2 min run): one
  setting to try.
- No continuous integration runs the fork's tests (see CI below).
- Coverage wasn't measured; the newest code (menu, inventory, buildings) has tests.

### L. Docs
- `docs/FORK_CHANGES.md`: 2,694 lines, history and current state mixed; sections
  describe things since removed (statuses, the online background map, reduced detail).
  Split: "how it is now" (short) and a dated history.
- `docs/LOCAL_DEVELOPMENT.md` (730 lines): the satellite part still explains the
  older questions' sizes in detail.
- Plans finished or dropped kept beside live ones (`refactor.md`, `refactor-5e.md`,
  `feature-status.md` removed, `satellite-imagery.md`); `my-layers-v2.md` says
  "nothing is implemented yet" though v3 is built. An `archive/` folder.
- `CLAUDE.md`: its build-steps line has a misplaced clause (towers / buildings).

### M. Dependencies, lint, config
- Scripts: 3 files with a `#!` line but not executable, 1 regex flag (ruff).
- Shellcheck: 7 warnings, all minor (5 unused variables, 1 masked return value).
- `.gitignore`: add `*.bak`, `web-backend/.env.*` (not `.example`).
- 22 `__pycache__` folders (ignored; harmless).

### N. Distance from upstream
103 upstream-side files differ, +1,829 / −607 lines, most of it the fork's own
new files in upstream folders (SQL, icons). Real edits to upstream's code are
small: `openinframap.ts` (46 lines), `style.ts` (34), `search.ts` (34),
`vite.config.ts` (36), `functions.sql` (42), a dozen others under 15 lines. Seven
upstream files are deleted (Edit button, Osmose, remote control).

### Build and CI
- The six workflows in `.github/workflows/` are upstream's: they build and push
  upstream's Docker images on pushes to `main` and run upstream's tests. **None runs
  the fork's tests** (`test:fork`, `tests/fork/`, `scripts/tests`), and whether the
  pushes do anything on your GitHub account wasn't checked.
- `web-router/` (upstream's production router) isn't used by the fork (`gate/` is).
- The backend's image is 708 MB (pandas, bokeh, shapely, now the tile decoder).

### Error handling
Good overall: downloads all go through `netsafe` / `lib/net.sh`, scripts stop on
errors. Two broad `except Exception` in the backend (`userdata/layers.py:129` to
look at; the PMTiles one is deliberate).

## Suggested batches

1. **Quick and safe (an hour):** `.env.bak` and `.gitignore`; the lint and
   shellcheck findings; the debug print; unused string, variables, function; the
   CLAUDE.md line; old branches (asked first).
2. **Disk (your call, minutes):** `data/region.osm.pbf` (34 GB), Russia and
   Saarland downloads, Docker's untagged images and build cache.
3. **The old satellite path (B, with its C, D, E; half a day):** first give the new
   menu the tile-server sources without questions, then remove `menu.py`'s old
   half, the shell presets, the compatibility names.
4. **Duplicates (D; 2–3 hours):** one PMTiles reader, one "run in the backend", one
   client name, one test helper, one details table.
5. **One source of truth (J; 2 hours):** versions, building sizes, each with a test
   like Sentinel-2's.
6. **Large files (F; a day):** `maps.py` (screens / jobs per source), `cli.py`,
   `build-region.sh` (questions / steps), with their tests as the safety net.
7. **Renames (H; half a day, after the IGN download):** `data/basemap/` and the
   `basemap` names; the fork's SQL files.
8. **CI (2 hours):** one workflow running the fork's three test suites; upstream's
   deploy workflows switched off in the fork.
9. **Docs last (L; half a day):** FORK_CHANGES split, plans archived, the guide
   trimmed.
