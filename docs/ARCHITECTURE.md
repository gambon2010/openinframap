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
core/      no UI, imported by anything: i18n.ts (t()), mgrs.ts (grid references),
           geo.ts (metres per pixel, degrees/radians), math.ts (clamp), colour.ts
           (hex colours), map-style.ts (geometry-type filters), storage.ts (this
           browser's storage, read and written safely), author.ts, map-data.ts
ui/        shared building blocks you see: dock (right), left column, details
           panel, highlight, panels (panel.ts, makeModal), settings (the gear),
           map buttons (map-button.ts: print, Settings, account),
           the tooltip, the right-click menu (context-menu.ts: withContextMenu),
           line icons (icons.ts: the eye), the key's checkboxes and its rows on
           prints (key/)
services/  shared state and registries, nothing drawn: live updates (live.ts),
           who has the map (map-mode.ts: measuring, drawing),
           what a printed map's legend lists (legend.ts), the background map's
           background: the map's colours or imagery, chosen in Settings (background.ts)
modules/   one folder per feature, each a ForkModule, listed in MODULES:
  details      a clicked feature's details in the left panel
  grid         routes between stations, where a power line goes, tower numbers
  extra        data from outside OSM
  sites        critical sites
  search       search descriptions, Photon
  coordinates  the cursor's position and MGRS; MGRS in search
  print        the map as a PDF with a legend (services/legend.ts: modules add to it)
  background   Settings → Background: the map in high contrast or original colours, or imagery
  satellite    the imagery (tells services/background.ts what there is)
  map-sources  background tiles and Photon (Settings)
  layout       no header; the dock, About in the credits, the search box top left
  account      who is logged in and Log out (a map button), Settings → Accounts (admins)
  userlayers   My layers (below)
locales/en.json   the fork's English strings
```

Folder rules, checked by `fork/structure.test.ts`:

- a module imports `core/`, `ui/`, `services/`, the root files and its own files,
  never another module;
- `ui/` imports only `core/`, `services/` and the root files;
- `services/` imports only `core/` and the root files (never `ui/`);
- `core/` imports nothing else of the fork.

When two modules need to talk, the shared piece goes in `services/` as a small
registry (shared state: who has the map, the selection), or in `ui/` when it's
something on screen (the details panel's extras, the left column).
Examples:
- `addDetailsExtra`: the grid adds "Route from here" to a feature's details;
- `addSettingsSection`;
- `leftColumn.add`;
- the details panel's `onShow`: the route folds itself.

**Styles:** panels share `ui/panel.css` (build them with `makePanel()`). Anything
chosen, switched on or selected (a chip, an option, a tool, a list row; not the
map's icon buttons, whose open panel gets a dark ring) gets the class `oim-on`: a highlighted background
(`--oim-on-background`), its border and text unchanged. Don't give a module its own
`.active` or `.selected` look. A row's actions go in a right-click menu
(`withContextMenu`, which also opens with the Menu key / Shift+F10), not in buttons
on the row; preferences go in Settings (`addSettingsSection`), not in panels. Tooltips: give the element a `title`; `ui/tooltip.ts`
shows it as the page's own tooltip (never the browser's), for every title on the
page, upstream's included.

**Types and constants:** a file's types go in `X.types.ts` and its constants and
tables in `X.constants.ts`, next to it (`render.ts`, `render.types.ts`,
`render.constants.ts`; in a folder: `types.ts`, `constants.ts`), so the main file
holds the logic. Small files with a type or two keep them. A constant that's
worked out from the file's own functions stays with them. Helpers more than one
place needs (distances, storage, clamping) go in `core/`, never copied.

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
           local.ts      what's kept in the browser (unsaved changes: IndexedDB)
           personal.ts   yours only, per account (folders, hidden, draw into, favourites)
           transport.ts  load and Save (live sync will plug in here)
           view.ts       store.view: live, a situation or a history step;
                         canEdit(layer) is the one "may this be changed now?"
           playback.ts   the saved history, step by step; api.ts the backend
kinds/   the kinds of item, one file each (symbol, graphic, image, marker,
         drawing, measure, copy); types.ts says what a kind defines, index.ts lists them
         and has kindOf(properties)
map/     render.ts (the Renderer: sources, selection, handles), layers.ts (the map
         style layers, as functions), geometry.ts (pure: control points, moving,
         boxes), symbols.ts (drawing the images), icons.ts (adding them to the
         map, by the kinds' prefixes), tools.ts, interactions.ts (hover,
         right-click, copy / paste), legend.ts
graphics/ tactical graphics: graphics.ts (the C5ISR renderer: codes, points,
         squaring), labels.ts (plain labels, English/French), variants.ts (two
         versions of one graphic), svg.ts (drawn small, for the legend)
io/      files: formats.ts (GeoJSON, KML, GPX), files.ts (choose, download)
measure/ measurements, pure: geo.ts (distances, areas, great circles), north.ts,
         ticks.ts (marks along a distance), features.ts (labels, marks), prefs.ts
ui/      workspace.ts (opens, keyboard, wiring) and its components: toolbar,
         sidebar, inspector (the card), situations, timeline, toast,
         preferences.ts (My layers' part of Settings); editor/ (the card:
         index.ts builds it from sections.ts, controls.ts the small inputs),
         outliner/ (the list: index.ts, filter.ts, order.ts), palette.ts (the picker);
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
- `about.py` and `templates/` (the about page, replacing upstream's: built on its
  `_base.html` layout);
- `search/` (the search box: `matching.py`, one file per kind of result, `ranking.py`);
- `circuits.py` (names for unnamed circuits, replacing upstream's circuit API);
- `grid/` (`route.py`: routes over the power grid; `line.py`: where a line goes; `tower.py`), `line_trace.py` (following a
  line), `grid_check.py` (lines ending at nothing, a command), `tower_numbers/`
  (towers numbered along their lines, a build step);
- `map_data.py` (a map feature's full geometry);
- `wikidata_offline.py` (popups from the offline Wikidata cache, by wrapping
  upstream's functions: upstream's files stay untouched) and `paths.py` (the caches);
- `userdata/`, My layers:
  - `schema.py` and `migrations/` (numbered, run once each: `userdata.schema_version`);
  - `changes.py` (applying and logging, no HTTP);
  - `layers.py`, `situations.py`, `images.py`;
  - `users.py`, where `current_user()` is the one place login and access control
    will go.

The backend runs in Docker from its image: after changing it, run
`docker compose up -d --build backend`.

## Data and build: `scripts/`, `schema/`, `imposm/`, `tegola/`

OSM extract → osmium filter → imposm (`imposm/*.py` mappings) → PostGIS → the SQL
steps → Tegola (vector tiles) → the frontend.

- **`build-region.sh`:** at the top, "what the build will do": every variable the
  steps share, with what it means (choices are `yes` / `no` / `ask`). Then the
  helpers for its menus, then the steps, one function each; the last lines run them
  in order, all the questions first. A step does what its name says. A step must
  not end with a test that can be false: under `set -e` that stops the build
  silently, and a test checks for it.
- **`lib/common.sh`:** the paths. It sources the helpers in `lib/*.sh` by theme:
  - `ui`: titles (`banner`, `done_banner`), messages, questions (`ask_yes_no`,
    `choose_number` for every numbered menu), `room_for` (disk space), timed steps
    (`run_with_timer`, which can show progress and stop a hung command), `duration`;
  - `net`: **every download** goes through `download` (curl) or `safely` (another
    downloading command): tried again, waits up to 15 minutes for a lost connection,
    stops a download that hangs, ends with status 75 ("run again") when the
    connection doesn't come back. Never call curl for a download directly;
  - `json`: `json_get`, `json_write` (manifests);
  - `db`: `SCHEMA_FILES`, the SQL steps in order, `run_schema` (with each step's
    label), `schema_hash` (the fingerprint exports carry), and what building and
    importing share: `fresh_database` (My layers and extra data kept),
    `put_back_my_layers`, `restart_map_services`;
  - `eez`, `extra`, `userdata`, `exports`, `app`, `basemap` (also cutting the
    background map: `download_basemap`), `geofabrik` (the index, region lookups,
    extracts), `satellite`.
- **`netsafe.py`:** the same for the Python downloads (satellite imagery, extra
  data, the Wikidata cache): `safely(call, url)`, `fetch(url)`, `fetch_file(url, path)`,
  `run_until_connected(main)`. Same settings (`NET_WAIT_SECONDS`,
  `NET_CHECK_EVERY`).
- **`satellite.py`** is the command line for `satimagery/`:
  - `sources.py`: Blue Marble, Sentinel-2, `DETAILED_SOURCES`, credits;
  - `tiles.py`, `estimate.py`, `download.py` (tiles into MBTiles, through
    `netsafe`), `gdal.py`;
  - `bdortho.py`: France's photos as IGN's files, one département at a time
    (`departements.py`: their codes, names, areas, bounds and regions);
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
2. SQL views in a `schema/*.sql`. A new file goes in `SCHEMA_FILES` and
   `SCHEMA_LABELS` (`lib/db.sh`) and in a `run_schema` line of `build-region.sh`.
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

**A change to the My layers schema:** a new file in
`web-backend/src/fork/userdata/migrations/`, numbered after the last
(`003_what_it_does.sql`), never an edit of one already run: databases that ran it
won't run it again. The backend runs it on the next request; a database restored
from an older export catches up the same way.

**A setting:** `addSettingsSection({ el, refresh?, order?, focus? })` from
`ui/settings.ts`.

**A panel in the right dock:** `makePanel()` (`ui/panel.ts`) and
`dock.add(button, panel)`.

**A kind of item in My layers** (e.g. a checkpoint):
1. A file in `modules/userlayers/kinds/` exporting an `ItemKind` (`kinds/types.ts`):
   its names (`noun`, `what`), how it's drawn (`drawn: 'standard'` draws points as
   its `icon` and lines and areas in its colour), its icon images (`images`: a
   prefix and how one is drawn), its list thumbnail, and what the card offers
   (`sized`, `coloured`, `lineWidth`, `military`), whether it can be dragged
   (`movable`) and its filter chips.
2. Add it to `KINDS` in `kinds/index.ts` and its id to `FeatureProps.kind`
   (`model/model.ts`).
3. A way to make one: a tool in `ui/toolbar.ts` (`{ mode: 'place', properties: {
   kind: '...' } }` for a point), or a file import (`io/formats.ts` reads the kind
   back by itself).
4. Its English name: `npm run fork-strings`. `kinds/kinds.test.ts` checks the
   registry (unique ids and image prefixes, an icon only with images).

**A tool that takes the map over** (clicks, right-click, keys, the cursor):
`mapMode.enter({ name, cursor?, doubleClickZoom?, click?, dblclick?, contextmenu?,
mousemove?, keydown?, exit? })` from `services/map-mode.ts`, and `mapMode.leave(name)`
when done. Escape and other tools end it: tidy up in `exit`. Meanwhile clicks on
map features don't open their details. Example: My layers' tools
(`modules/userlayers/map/tools.ts`, `setTool`).

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
