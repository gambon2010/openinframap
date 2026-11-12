# Plan: the global clean-up

Status: **in progress** (started 2026-11-11). Findings: `cleanup-audit.md`. Nothing
changes for whoever uses the map except where a line below says so.

## Rules

1. **Old parts go**, everywhere: superseded paths, options kept "for older
   commands", code that upgraded old data once, stand-in names for old code.
   What replaces an option removed is said by the option itself when someone
   still types it.
2. **Split, rename, restructure only the fork's own files.** Upstream's files are
   only touched to make the fork's edits smaller, or to delete what nothing uses.
3. **Order:** deletions → duplicates → one source of truth → structure → names →
   docs last. Each batch its own commits, the three test suites passing before
   and after.
4. **Not deleted without asking:** anything in `data/` and Docker's leftovers
   (decided 2026-11-11: left for now, about 110 GB, listed in the audit).
5. After changes to what's saved in the export (database, Docker images):
   re-exported at the end of the batch.

## Batches

| # | Batch | Status |
|---|---|---|
| 1 | **The old satellite path** and what only it used: `menu.py`'s questions and plan, the `choose` / `steps` / `estimate` / `estimate-detailed` commands, the shell presets and `run_parallel`, the options `--satellite`, `--satellite-detailed`, `--area`, `--zoom`, `--sources` (replaced: `build-region.sh --maps "ID ..."`, `satellite.py maps --source ID --yes`, now also for tile-server photos); the stand-in names (`DETAILED_SOURCES`, `TIERS`, the size constants); one-time code (lower zooms added to old imagery files, the old `.sat-detailed` name, a region's own Blue Marble file, `select_basemap`'s old addresses, `import-db.sh` patching exports from before search / the grid / extra data existed: an older export now defaults to "don't import") | ✅ 2026-11-12 |
| 2 | **Quick and safe:** `.gitignore` (`*.bak`); lint findings; the debug print; unused string; upstream files nothing imports (`geocoder.ts`, `search/opencage.ts`, `elements/tab-pane.ts`); the `area` re-export | ✅ 2026-11-12 |
| 3 | **Duplicates:** one PMTiles header reader for the scripts; one "run in the backend"; one client name for downloads; one fake-PMTiles test helper; one details table (frontend); the code normaliser | ✅ 2026-11-12 |
| 4 | **One source of truth:** the PMTiles program's version; the building sizes per zoom; each checked by a test where two languages must agree | ✅ 2026-11-12 (the building sizes: with batch 6) |
| 5 | **Old My layers data** (layers from before accounts, old arrows, a layer's own folder, items from before fields and colours): check what the database holds, convert it once with a migration, then remove the code that handles the old forms | ✅ 2026-11-12 |
| 6 | **Buildings: exact copies at every zoom.** Planned: the backend making the zoomed-out tiles from the background map's zoom 15 tiles (one source). Measured too slow (below), so the zoomed-out drawing stays the build step and Tegola; a copy takes the exact outline from the backend instead | ✅ 2026-11-12 (reduced) |
| 7 | **Large files** (fork's own): `maps.py` (screens / each source's jobs), `cli.py`, `build-region.sh` (options and questions / steps), `bdortho.py`; then the frontend's (`render.ts`, `store.ts`) if reading them shows a clean cut | ✅ 2026-11-12 (the menu, the build script; the rest left: below) |
| 8 | **Names:** `data/basemap/` → offline maps (and `BASEMAP_*`, `lib/basemap.sh`, `--basemap-dir`); the fork's SQL files told apart from upstream's; `scripts/satellite.*` → offline maps | ⏸ waits for the IGN download (it writes in `data/basemap/`, and `satellite.sh` is running) |
| 9 | **CI:** one workflow running the fork's three test suites; upstream's deploy workflows off in the fork | ✅ 2026-11-12 |
| 10 | **Docs:** `FORK_CHANGES.md` split into "how it is" and a dated history; finished plans archived; the guide trimmed; `CLAUDE.md` checked line by line | ✅ 2026-11-12 |
| 11 | **Proof:** the real Luxembourg build → export → import test (`OIM_TEST_REAL_BUILD=1`), then the export made again | |

## Log

- **2026-11-12, batch 1.** Scripts: −1,900 lines (code and tests). New pieces:
  `satimagery/regions.py` (Geofabrik's index), `aerial.py` (tile-server photos:
  job, file, estimate); `attribution_for` reads file names through
  `inventory.identify` (one parser). `satellite.sh` takes no options;
  `build-region.sh --maps "sentinel2 fr_ign"` queues without questions.
  Downloads from the menu run one after the other (the old path ran them side by
  side). Blue Marble is the world's file only.
- **2026-11-12, batch 2.** `*.bak` ignored (the stray `web-backend/.env.bak` itself
  is left: yours to delete). Scripts' lint clean. Upstream files nothing imported
  deleted (`geocoder.ts`, `search/opencage.ts`, `elements/tab-pane.*`, the Osmose
  icon): upstream's own type errors go from 31 to 24. Measuring's own copy of the
  distance formula and its re-export of the area go: one of each, in
  `core/geo.ts`. The debug line on a clicked feature stays (development only).
- **2026-11-12, batch 3.** One PMTiles header reader (`satimagery/pmtiles.py`):
  the shell's own (five functions with Python inside) is gone, because the list of
  imagery the map is told about (`VITE_SATELLITE_TIERS`) and its summary are now
  made in Python (`inventory.imagery_tiers`, `imagery_summary`; `satellite.py
  tiers` / `summary`), which also ends the first-zoom number kept in two
  languages. `backend_python` (`lib/db.sh`) runs every build step written in the
  backend. One client name for downloads (`netsafe.USER_AGENT`). One fake offline
  map for the tests (`tests/fake_pmtiles.py`). The département code as typed and
  a background map's edition: one function each (`bdortho.unit_code`,
  `extract.edition`). Frontend: `detailsCard` (`ui/details.ts`) builds the details
  of the extra data and of buildings. Left: the map credit line written in
  `sites` and in upstream's `style.ts` (upstream's isn't exported).
- **2026-11-12, batch 4.** `scripts/tests/test_one_source.py`: each service's port
  (Compose is the reference) agrees in the scripts, the gate and the frontend; the
  PMTiles program is one version (Compose and `extract.py`). The scripts' ports
  are named in one place (`lib/common.sh`: `TEGOLA_PORT` was a bare 7800 in five
  places; the `.env` template now uses them).
- **2026-11-12, batch 5.** The database had no old-format My layers data (no
  ownerless layer, no layer's own folder, no item with its name as designation or
  without a colour, no four-point arrow, none in the history either). Migration
  `003_layers_have_owners.sql` makes every layer have an owner (one without gets
  the first admin, the others keep "can change"); then the code for the old forms
  went: ownerless layers' rules (`access.py`, `sharing.py`, the sharing window's
  note), a layer's shared folder (`style.folder`), settings taken over from this
  browser's storage before accounts, a symbol's name as its designation, old
  arrows turned into paths when drawn. A layer without an owner is now nobody's.
- **2026-11-12, batch 6.** Buildings made on request were timed over central
  Paris: one zoom 12 tile = 64 zoom 15 tiles = 88,000 buildings, 3.8 s just to
  decode them in Python, 13 s in all; a zoom 13 tile about 1 s, and a screen needs
  ~20. Not usable, so reverted: the zoomed-out drawing stays the large-buildings
  build step and Tegola (fast, measured before). What was kept fixes the actual
  problem (a building copied zoomed out took Tegola's simplified shape): a copy
  asks `/background/building/{id}?lon=&lat=` (`web-backend/src/fork/background/
  buildings.py`), which joins the building's pieces from the zoom 15 tiles around
  it (45 ms for a large Paris building), at any zoom; offline from the backend,
  the pieces on screen. A cut leaving a line beside the area keeps the area only.
- **2026-11-12, batch 7.** `satimagery/maps.py` (865 lines) → `maps.py` (the
  screens, 434), `offers.py` (what each source offers and the downloads it makes,
  417: a part `Maps` takes in) and `jobs.py` (a download, the queue: 53).
  `build-region.sh` (874) → `build-region.sh` (options, the variables the steps
  share, the order of the steps: 180), `build/questions.sh` (511) and
  `build/steps.sh` (195); the tests read the three as one (`conftest.BUILD_SCRIPT`).
  Left as they are, after reading them: `bdortho.py` (524: one pipeline in clear
  sections, listing → download → extract → tiles → command), `cli.py` (336, now
  small), and the frontend's `render.ts` (564) and `store.ts` (463), each one
  class whose methods share its state: a split would scatter it for no gain.
- **2026-11-12, batch 9.** `.github/workflows/fork-tests.yml`: on every push and
  pull request, the fork's three suites and their linters (frontend: eslint and
  prettier on `src/fork`, type errors in `src/fork` only, `test:fork`; backend:
  ruff, mypy, `tests/fork`; scripts: ruff, shellcheck, `scripts/tests`). Upstream's
  six workflows build upstream's images: their build jobs now run only in
  upstream's repository (one `if:` each, listed in FORK_CHANGES.md).
  `scripts/.shellcheckrc` says once what's shared between sourced files.
- **2026-11-12, batch 10.** `FORK_CHANGES.md` (2,700 lines) split: it keeps what a
  merge from upstream needs (goals, the fork's structure rules, every upstream
  file changed: 180 lines); the dated notes went to `HISTORY.md`, as they were.
  Plans built, done or dropped moved to `plans/archive/` (refactor, refactor-5e,
  feature-status, satellite-imagery, my-layers-v2, my-layers-v3, graphic-labels,
  offline-maps); `sync.md`, the audit and this plan stay.
- **Batch 8 waits.** The IGN download was resumed from the menu
  (`bash scripts/satellite.sh`, 93 départements): renaming `data/basemap/` and the
  scripts it runs would break it. To do once it's finished (or stopped for good).
