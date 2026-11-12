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
| 2 | **Quick and safe:** `.gitignore` (`*.bak`); lint findings; the debug print; unused string; upstream files nothing imports (`geocoder.ts`, `search/opencage.ts`, `elements/tab-pane.ts`); the `area` re-export | |
| 3 | **Duplicates:** one PMTiles header reader for the scripts; one "run in the backend"; one client name for downloads; one fake-PMTiles test helper; one details table (frontend); the code normaliser | |
| 4 | **One source of truth:** the PMTiles program's version; the building sizes per zoom; each checked by a test where two languages must agree | |
| 5 | **Old My layers data** (layers from before accounts, old arrows, a layer's own folder, items from before fields and colours): check what the database holds, convert it once with a migration, then remove the code that handles the old forms | |
| 6 | **Buildings from one source:** zoomed out, the backend makes the tiles from the background map's zoom 15 data on the fly (all buildings at 13 and 14, the large ones at 12), instead of a table in the database, a build step and a Tegola layer; copies are then exact at every zoom | |
| 7 | **Large files** (fork's own): `maps.py` (screens / each source's jobs), `cli.py`, `build-region.sh` (options and questions / steps), `bdortho.py`; then the frontend's (`render.ts`, `store.ts`) if reading them shows a clean cut | |
| 8 | **Names:** `data/basemap/` → offline maps (and `BASEMAP_*`, `lib/basemap.sh`, `--basemap-dir`); the fork's SQL files told apart from upstream's; `scripts/satellite.*` → offline maps | |
| 9 | **CI:** one workflow running the fork's three test suites; upstream's deploy workflows off in the fork | |
| 10 | **Docs:** `FORK_CHANGES.md` split into "how it is" and a dated history; finished plans archived; the guide trimmed; `CLAUDE.md` checked line by line | |
| 11 | **Proof:** the real Luxembourg build → export → import test (`OIM_TEST_REAL_BUILD=1`), then the export made again | |

## Log

- **2026-11-12, batch 1.** Scripts: −1,900 lines (code and tests). New pieces:
  `satimagery/regions.py` (Geofabrik's index), `aerial.py` (tile-server photos:
  job, file, estimate); `attribution_for` reads file names through
  `inventory.identify` (one parser). `satellite.sh` takes no options;
  `build-region.sh --maps "sentinel2 fr_ign"` queues without questions.
  Downloads from the menu run one after the other (the old path ran them side by
  side). Blue Marble is the world's file only.
