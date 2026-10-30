# Refactor plan: firmer foundations for the fork

Status: **in progress** (agreed 2026-10-30). Phase 1 done; phase 2 steps 4–7 done.

## Why

The fork grew feature by feature: local build scripts, extra data, critical sites,
the grid route, satellite imagery, My layers v1 → v3. Each piece works and is
tested, but several were stretched past what they were first written for. The
backlog (users and access control, auto-sync, MGRS, terrain, time on items,
import/export, more critical-infrastructure layers) will land on exactly those
pieces. The aim here is to rework them **before** that, so new features plug in
instead of being wedged in.

Ground rules for every step:

- **Behaviour doesn't change.** Each step is a refactor: same UI, same data, same
  commands. Bug fixes found on the way are listed and committed separately.
- **Upstream files stay as they are** (one-line hooks only, as now).
- **Each step ships on its own**: tests green (frontend, backend, scripts), a
  browser check of what it touches, docs updated, one commit. They can stop
  anywhere and the code is still in a good state.
- **No rewrites for taste.** Code that's small, tested and not in the way of the
  backlog stays as it is (see "Left as it is").

## What's in the way (findings)

Sizes in lines. "Coupling" = one part reaching into another's insides.

| Where | Finding | Why it matters next |
|---|---|---|
| `fork/userlayers/panel.ts` (999) | One class does the toolbar, sidebar, situations, history playback, toasts, the symbol picker, keyboard shortcuts and the item card. Showing the past is two separate flags (`inPlayback`, `viewing`). | Time on items, users and sync all touch "what am I looking at, and can I edit it". Today that's spread over a 1,000-line class. |
| `fork/userlayers/store.ts` (549) | Layer state, undo/redo, undo-after-save, the unsaved list in the browser and the server calls in one class. | Auto-sync replaces "Save"; access control needs "who may change this". Both need the change log, the undo stack and the server transport to be separate pieces. |
| Left column | My layers puts its sidebar into the left column by importing `sidePanel()` and `foldRoute()` from the **grid** module. The feature-details panel (`InfoPanel`) lives in `fork/grid/` but is used by everything. | Any new left-side panel (MGRS readout, measuring, import) would copy that hack. |
| `fork/grid/` | Mixes three things: feature details for every layer (panel, highlight, click/deselect), where a power line goes, and routes between stations. | The grid what-if (backlog 10.4) belongs with routes; details belong to everyone. |
| `fork/` layout | Feature modules (`satellite`, `extra`, `sites`, `grid`, `userlayers`, `search`, `ui`) sit next to shared building blocks (`key/`, `map-sources/`, `config.ts`, `types.ts`) with no visible difference. `map-sources/` isn't a module: `ui/settings.ts` imports it directly, while `satellite/` registers its own Settings section. | It's not obvious where new code goes, or what may import what. |
| Strings | Two helpers: `t` from i18next (17 files) and My layers' `tt` (no HTML escaping). | One rule for every module avoids double-escaped names elsewhere. |
| `userlayers.css` (1,170) | One file for every My layers component; button/chip styles redefined next to `ui/panel.css`. | Restyling or reusing a component means searching one huge file. |
| Satellite credits | The aerial-photo source list is in `satellite.py`, and its credit lines are copied into `fork/satellite/index.ts`. | Adding a country means editing two languages in two places. |
| `scripts/lib/common.sh` (767, 56 functions) | Prompts, timers, database, EEZ, exports, user data, terminals, `.env`, basemaps, Geofabrik and satellite helpers in one file. | Every script loads everything; finding or testing one area is hard. |
| `scripts/build-region.sh` (923) | Each step's logic is inline, and the order of the SQL steps is written out twice, in `build-region.sh` and in `import-db.sh`. | A new SQL step has to be added in two places, in the right order. |
| `schema_hash` (`common.sh`) | **Bug**: the database fingerprint covers `functions, views, stats, eez, extra, sites` but not `grid.sql`, `search.sql`, `places.sql` or `local-stats.sql`. | Changing those doesn't mark an export as out of date (the new automatic re-export misses it). |
| `scripts/satellite.py` (1,500) | Tile maths, outlines, sources, MBTiles, Docker/GDAL, the downloader, the menu and the CLI in one file. | Every new source or menu question goes into the same file. |
| `scripts/extra_data.py` (1,043) | Every outside data source (Agence ORE, Géorisques…) and the shared loading code in one file. | The critical-infrastructure backlog adds several sources. |
| `web-backend/src/fork/userdata.py` (477) | Routes, SQL, the schema check, images and `source-feature` (map data, not user data) in one file. There's nowhere to put "who is asking". | Users and access control need a place to check permissions, separate from the routes. |
| `docs/FORK_CHANGES.md` (~1,100) | Both a history of changes and the architecture guide. | New contributors (or a new session) can't find "how do I add X". |

## The plan

Phases are ordered by what the backlog needs first. Effort is a rough guess in
working sessions.

### Phase 1: fixes and groundwork (small, safe) — done

1. **Fix the database fingerprint**: one list of the SQL build steps, in order,
   for example `schema/build-steps.txt` or an array in a new `scripts/lib/db.sh`.
   `build-region.sh`, `import-db.sh` and `schema_hash` all read that list, and a
   test checks every fork `.sql` file is either on it or explicitly excluded.
   *Effort: ½. Fixes the bug above; a new SQL file becomes a one-line change.*
2. **One string helper** for the whole fork, in `fork/core/i18n.ts`: `t(key, text,
   values)`, never HTML-escaped, since every fork module puts text on the page as
   text. `userlayers/i18n.ts` goes. *Effort: ½.*
3. **Consistency tests** that catch half-added features:
   - every fork Tegola layer has a style layer;
   - every style layer is in the key or deliberately not;
   - every aerial photo source has a credit line;
   - every `t()` key is in `en.json` (already there).

   *Effort: ½.*

### Phase 2: frontend structure

4. **Folders by role** under `web/src/fork/` (done; `config.ts` stays at the root
   with `index.ts` and `types.ts`, since upstream imports it; the old `ui/index.ts`
   module became `modules/layout/`):

   ```
   fork/
     index.ts, types.ts        the module registry and hooks (unchanged role)
     core/                     config.ts, i18n.ts: no UI, imported by anything
     ui/                       shared UI: panel, dock, settings, left column,
                               details panel, buttons; the key (key/ moves here)
     modules/                  one folder per feature, each a ForkModule
       satellite/ extra/ sites/ search/ details/ grid/ map-sources/ userlayers/
   ```

   Rules, checked by an ESLint `no-restricted-imports` rule:
   - modules import `core/` and `ui/`, never each other;
   - `ui/` imports only `core/`.

   *Effort: 1 (moves plus import paths; upstream's hooks import only
   `fork/index.ts`, so upstream files don't change).*
5. **A left-column service** in `ui/left-column.ts` (done; the route folds itself
   through the details panel's `onShow`). Modules register a panel with a
   place in the order (details, the My layers sidebar, the grid route…) and a fold
   policy ("fold me when another panel needs room"). My layers stops importing
   from the grid module. *Effort: 1. Prepares MGRS, measuring and import panels.*
6. **Split `grid/`** (done: `modules/details/`, `modules/grid/`; the details panel
   and highlight are shared in `ui/`, the power-line tracing is `grid/line.ts`):
   - `details/`: the feature-details panel, highlight, click and deselect, used by
     every layer;
   - `grid/`: where a line goes, routes, and later the what-if.

   *Effort: ½.*
7. **Map sources as a module** (done): it registers its own Settings section, like
   satellite does. *Effort: ¼.*
8. **Satellite credits from the files themselves.** Each PMTiles file already
   carries its attribution, and `pmtiles serve` shows it in `/<name>.json`. The
   frontend reads it from there, so the list in `index.ts` goes. *Effort: ½. A new
   country becomes one entry in `satellite.py`.*

### Phase 3: My layers (the biggest; prepares users and sync)

9. **Split the store** into four parts (shaped for `docs/plans/sync.md`), with
   `Store` as a thin front that keeps today's API for the UI:
   - `changes.ts`: pure. `Change`, `applyChange`, steps, `revertFields`, cloning.
     Already mostly pure and tested.
   - `history.ts` (rename the current playback file to `playback.ts`): the undo
     and redo stacks, including undo after Save.
   - `persistence.ts`: unsaved changes in the browser.
   - `transport.ts`: the server calls: load, save, history, situations. Today it's
     "Save sends the list"; later an auto-sync transport can sit behind the same
     interface.

   *Effort: 1½.*
10. **One "view" object** for what the map shows: live (editable), a situation, or
   a history step (read-only). The toolbar, outliner, card and keyboard ask it
   "can I edit?" instead of checking two flags. *Effort: ½. Time on items and
   per-user read-only access hook in here.*
11. **Split `panel.ts`** into components, each with its own CSS file (and
   `userlayers.css` split along the same lines):
   - `workspace.ts`: open and close, keyboard, wiring;
   - `toolbar.ts`;
   - `sidebar.ts`: outliner, situations line, settings;
   - `inspector.ts`: which card to show;
   - `timeline.ts`: history playback;
   - `picker.ts`, `toast.ts`.

   Shared buttons and chips move to `ui/`. *Effort: 2.*
12. **Folders inside `userlayers/`**:
   - `model/`: changes, model, sidc, fields, labels;
   - `state/`: store, history, persistence, transport, view;
   - `map/`: render, graphics, symbols, tools, interactions;
   - `ui/`: the components above, editor, outliner, palette.

   *Effort: ½.*

### Phase 4: backend

13. **`userdata.py` → package `src/fork/userdata/`**:
    - `schema.py`: `ensure_schema`;
    - `changes.py`: applying and logging changes, no HTTP;
    - `routes.py`, `situations.py`, `images.py`.

    `source-feature` moves to its own `src/fork/map_data.py`. One `current_user()`
    function returns "anyone" for now: the single place login and access control
    will fill in. *Effort: 1.*

### Phase 5: scripts

14. **`common.sh` split into `scripts/lib/*.sh`**: `ui.sh` (prompts, timers),
    `db.sh`, `exports.sh`, `userdata.sh`, `app.sh` (terminals, `.env`, start),
    `basemap.sh`, `geofabrik.sh`, `satellite.sh`. `common.sh` keeps the paths and
    sources them all, so no script changes how it starts. *Effort: 1.*
15. **`build-region.sh` steps as functions** with the main flow on one screen:
    choose, download, import, SQL steps (from the list in step 1), extras, finish.
    *Effort: 1.*
16. **`satellite.py` → package `scripts/satellite/`**:
    - `tiles.py` (tile maths, outlines, blocks);
    - `sources.py` (Blue Marble, Sentinel-2, `DETAILED_SOURCES`);
    - `mbtiles.py` and `download.py`;
    - `gdal.py`;
    - `menu.py` (choose, steps);
    - `__main__.py` (the CLI).

    Still standard library only; check how `python3 -I` runs a package directory,
    else keep a thin `satellite.py` entry. *Effort: 1.*
17. **`extra_data.py` → package `scripts/extra_data/`**: the shared loader plus one
    file per source, with a short "adding a source" docstring. *Effort: 1.
    Prepares the critical-infrastructure sources.*

### Phase 6: docs

18. **Split the docs:**
    - `docs/ARCHITECTURE.md` (new): how the fork is put together, the folder rules,
      and recipes such as "add an OSM layer", "add an outside data source", "add a
      satellite source", "add a left panel", "add a setting".
    - `FORK_CHANGES.md` becomes what changed versus upstream and the merge notes.
    - CLAUDE.md points to both.

    *Effort: 1.*

Total: roughly 15 sessions. Phases 1, 2 and 3 matter most for the backlog;
4–6 can wait or be done piecemeal.

## Left as it is

Small, tested and not in the way, so no change:
- the fork module registry and hooks (`fork/index.ts`, `types.ts`);
- `search.py`;
- `grid.py`;
- the key toggles;
- `sites/` and `extra/` frontend modules (apart from moving folders);
- the imposm mapping files;
- `tegola/layers.fork.yml`;
- the satellite tile maths (just moved);
- `launch.sh`, `start.sh`, `export-db.sh`, `import-db.sh` (apart from the shared
  SQL list).

## Questions for you

1. **Order.** Phases 1 → 3 first (frontend and My layers, which users and sync
   need), then 4 → 6? Or scripts first, because the critical-infrastructure layers
   come before users?
2. **Folder names.** `core/`, `ui/`, `modules/` under `web/src/fork/`, and
   `model/`, `state/`, `map/`, `ui/` inside `userlayers/`: fine, or do you prefer
   other names?
3. ~~Auto-sync.~~ Discussed: `docs/plans/sync.md`. Phase 3 shapes the store for it
   (versions on each item, a `merge.ts` beside `changes.ts`, conflicts in the
   store, the view object answering "can I edit?"), and phase 4 leaves room for
   versions, access checks and a push connection.
4. **Scope.** Is anything here more than you want (e.g. splitting `satellite.py`
   or `extra_data.py` now), or missing (an area you find hard to work with)?
