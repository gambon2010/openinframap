# How the fork is put together

The fork runs Open Infrastructure Map locally, and offline, for a chosen region. It
adds its own layers, My layers (your own layers on the map), satellite imagery and
the scripts that build everything. Upstream won't take its changes, so it keeps them
out of upstream's files.

This page is the map of the code and how to extend it. What changed and why, step
by step, is in `FORK_CHANGES.md`. Requirements are in `SPECIFICATIONS.md`, and plans
are in `plans/`.

## The rule that shapes everything: stay out of upstream's files

New code goes in fork-only places:

- **Frontend:** `web/src/fork/`.
- **Backend:** `web-backend/src/fork/`.
- **Tiles:** `tegola/layers.fork.yml`.
- **Docker:** `docker-compose.override.yml`.
- **Strings:** `web/src/fork/locales/en.json`.
- **Build:** `scripts/`, plus `schema/*.sql` for the fork's own SQL.

Upstream files only get one-line hooks, all listed in `FORK_CHANGES.md` ("Fork
structure", "Merging from upstream"). Upstream imports only three fork files:
`fork/index.ts`, `fork/types.ts` and `fork/config.ts`.

## Frontend: `web/src/fork/`

```
index.ts, types.ts, config.ts   the module registry and hooks, the types, the URLs
core/      no UI, imported by anything: i18n.ts (t())
ui/        shared building blocks: dock (right), left column, details panel,
           highlight, panels, settings, the key's checkboxes, live updates (live.ts),
           who has the map's clicks (map-clicks.ts: measuring)
modules/   one folder per feature, each a ForkModule, listed in MODULES:
  details      a clicked feature's details in the left panel
  grid         routes between stations, where a power line goes, tower numbers
  status       statuses of map features (damage, threats): details, map
  extra        data from outside OSM
  sites        critical sites
  search       search descriptions, Photon
  measure      distances, areas, range rings; cursor position and MGRS; MGRS search
  satellite    imagery as the background
  map-sources  background tiles and Photon (Settings)
  layout       the dock, the Settings link, the search box in the top bar
  account      who is logged in, log out, Settings → Accounts (admins)
  userlayers   My layers (below)
locales/en.json   the fork's English strings
```

Folder rules, checked by `fork/structure.test.ts`:

- a module imports `core/`, `ui/`, the root files and its own files, never another
  module;
- `ui/` imports only `core/` and the root files;
- `core/` imports nothing else of the fork.

When two modules need to talk, the shared piece goes in `ui/` as a small registry.
Examples:
- `addDetailsExtra`: the grid adds "Route from here" to a feature's details;
- `addSettingsSection`;
- `leftColumn.add`;
- the details panel's `onShow`: the route folds itself.

**Strings:** write `t('module.key', 'English text', values)` from `core/i18n.ts`.
Values are never HTML-escaped, because text goes on the page as text, never through
`innerHTML`. `npm run fork-strings` adds new keys to `en.json`, and a test fails if
one is missing.

### My layers: `modules/userlayers/`

```
model/   what items are: model.ts (Change, UserLayer...), sidc.ts (symbol codes),
         fields.ts (descriptive fields), labels.ts, the symbol catalogue
state/   store.ts (the Store the UI uses) on top of:
           changes.ts    pure: applying changes, steps, revertFields, differences
           undo.ts       undo / redo, including undo after Save
           merge.ts      field-by-field merge (yours, theirs, the base)
           reconcile.ts  your unsaved changes brought onto the server's layers
           local.ts      what's kept in the browser
           personal.ts   yours only, per account (folders, hidden, draw into, favourites)
           transport.ts  load and Save (live sync will plug in here)
           view.ts       store.view: live, a situation or a history step;
                         canEdit(layer) is the one "may this be changed now?"
           playback.ts   the saved history, step by step; api.ts the backend
map/     render.ts, graphics.ts (tactical graphics), symbols.ts, tools.ts,
         interactions.ts (hover, right-click, copy / paste)
ui/      workspace.ts (opens, keyboard, wiring) and its components: toolbar,
         sidebar, inspector (the card), situations, timeline, toast; editor.ts
         (the card), outliner.ts (the list), palette.ts (the picker);
         userlayers.css lists the CSS files in order (order matters)
```

Every edit is a `Change`. It's applied at once, kept unsaved (in the browser too) and
sent with Save. The backend logs each one, and that log is the history. Users,
sharing and live sync are designed in `plans/sync.md`. They plug into
`state/transport.ts`, `state/view.ts` (`canEdit`) and the backend's
`userdata/users.py`.

## Backend: `web-backend/src/fork/`

Starlette routes, put ahead of upstream's (the fork's search replaces upstream's at
the same URL), and a login check (`auth/`: every route but logging in needs a
session):

- `auth/`: accounts, sessions, the login page, `LoginMiddleware`;
- `search.py`;
- `circuits.py` (names for unnamed circuits, replacing upstream's circuit API);
- `grid.py` (routes over the power grid, `/grid/line`), `grid_supply.py` (power
  supply mode), `line_trace.py` (following a
  line), `grid_check.py` (lines ending at nothing, a command), `tower_numbers.py`
  (towers numbered along their lines, a build step);
- `map_data.py` (a map feature's full geometry);
- `userdata/`, My layers:
  - `schema.py` and `userdata.sql`;
  - `changes.py` (applying and logging, no HTTP);
  - `layers.py`, `situations.py`, `images.py`;
  - `users.py`, where `current_user()` is the one place login and access control
    will go.

The backend runs in Docker from its image: after changing it, run
`docker compose up -d --build backend`.

## Data and build: `scripts/`, `schema/`, `imposm/`, `tegola/`

OSM extract → osmium filter → imposm (`imposm/*.py` mappings) → PostGIS → the SQL
steps → Tegola (vector tiles) → the frontend.

- **`build-region.sh`:** each step is a function. The last lines run them in order,
  all the questions first. A step must not end with a test that can be false: under
  `set -e` that stops the build silently, and a test checks for it.
- **`lib/common.sh`:** the paths. It sources the helpers in `lib/*.sh` by theme:
  - `ui`: prompts, timed steps;
  - `db`: `SCHEMA_FILES`, the SQL steps in order, and `schema_hash`, the
    fingerprint that exports carry;
  - `eez`, `extra`, `userdata`, `exports`, `app`, `basemap`, `geofabrik`,
    `satellite`.
- **`satellite.py`** is the command line for `satimagery/`:
  - `sources.py`: Blue Marble, Sentinel-2, `DETAILED_SOURCES`, credits;
  - `tiles.py`, `estimate.py`, `download.py`, `gdal.py`;
  - `menu.py`: the questions and the plan;
  - `cli.py`.
- **`extra_data.py`** is the command line for `extradata/`: `base.py`, one file per
  source, and `SOURCES`.
- **Exports** (`export-db.sh`, `import-db.sh`) carry the database. An export that's
  out of date is redone by `build-region.sh` and `start.sh`.

## Recipes

**A map layer from OSM** (e.g. airports):
1. Add the mapping in `imposm/` (a new `*.py`, like `sites.py`). This changes the
   osmium filter and the fingerprint.
2. SQL views in a `schema/*.sql`. A new file goes in `SCHEMA_FILES` (`lib/db.sh`)
   and in `build-region.sh`'s `import_osm`.
3. The tile layer in `tegola/layers.fork.yml`, then regenerate `config.toml`.
4. A module in `fork/modules/<name>/`: its `layers()` (style),
   `switcherGroups()`, `key()`, popup rules. Add it to `MODULES`.
5. Strings: `npm run fork-strings`. Searchable by name: `schema/search.sql`.
6. Rebuild the region. `consistency.test.ts` fails if a tile layer isn't drawn, or a
   layer can't be switched off.

**Data from outside OSM:**
1. Write a `Source` class in a new file in `scripts/extradata/`, plus a line in
   `SOURCES`.
2. Add its tables or views in `schema/extra.sql`, and draw it in `modules/extra/`.

**A country's aerial photos:**
1. Add an entry in `DETAILED_SOURCES` (`satimagery/sources.py`): URL or WMS,
   region, resolution, credit.
2. Check that it answers tile requests and allows offline copies.

The credit reaches the map by itself (`VITE_SATELLITE_TIERS`).

**A panel on the left:** `leftColumn.add(element, order)` from `ui/left-column.ts`.
Pick an order between the existing ones (`LEFT_ORDER`). To show details, use
`leftColumn.details.show(content, onClose)`.

**A setting:** `addSettingsSection({ el, refresh?, order?, focus? })` from
`ui/settings.ts`.

**A panel in the right dock:** `makePanel()` (`ui/panel.ts`) and
`dock.add(button, panel)`.

**A backend route:** a module in `web-backend/src/fork/`, with its routes added in
`fork/__init__.py`. For My layers, check rights through `userdata/users.py`.

## Tests

| Where | Command |
|---|---|
| `web/src/fork/**/*.test.ts` | `cd web && npm run test:fork` |
| `web-backend/tests/fork/` | `cd web-backend && uv run pytest` |
| `scripts/tests/` | `uv run --with pytest --with httpx --with psycopg2-binary pytest scripts/tests` |

The script tests run the setup scripts in a sandbox with fake Docker and network.
Add `OIM_TEST_REAL_BUILD=1` to build, export and import Luxembourg for real, in a
separate Docker project. Tests cover the fork's code where there's logic to get
wrong, not upstream's.
