# How the fork is put together

The fork runs Open Infrastructure Map locally, and offline, for a chosen region. It
adds its own layers, My layers (your own layers on the map), satellite imagery and
the scripts that build everything. Upstream won't take its changes, so it keeps them
out of upstream's files.

This page is the map of the code and how to extend it. What changed and why, step
by step, is in `HISTORY.md`; every upstream file the fork changes, in `FORK_CHANGES.md`. Requirements are in `SPECIFICATIONS.md`, and plans
are in `plans/`.

## The rule that shapes everything: stay out of upstream's files

New code goes in fork-only places:

- **Frontend:** `web/src/fork/`.
- **Backend:** `web-backend/src/fork/`.
- **Tiles:** `tegola/layers.fork.yml`.
- **Docker:** `docker-compose.override.yml`.
- **Strings:** `web/src/fork/locales/en.json`.
- **Build:** `scripts/`, plus `schema/fork/*.sql` for the fork's own SQL (upstream's stay in `schema/`).

Upstream files only get one-line hooks, all listed in `FORK_CHANGES.md` ("Fork
structure", "Merging from upstream"). Upstream imports only three fork files:
`fork/index.ts`, `fork/types.ts` and `fork/config.ts`.

## Frontend: `web/src/fork/`

```
index.ts, types.ts, config.ts   the module registry and hooks, the types, the URLs
core/      no UI, imported by anything: i18n.ts (t()), mgrs.ts (grid references),
           geo.ts (metres per pixel, degrees/radians), math.ts (clamp), colour.ts
           (hex colours), map-style.ts (geometry-type filters; clickableArea and hitLine:
           areas clickable inside, thin lines easy to click), storage.ts (this
           browser's storage, read and written safely), author.ts, map-data.ts,
           buildings.ts (the background map's buildings: their layer, a building's
           pieces joined across tiles)
ui/        shared building blocks you see: dock (right), left column, details
           panel, highlight, panels (panel.ts, makeModal), settings (the gear),
           map buttons (map-button.ts: print, Settings, account),
           the tooltip, the right-click menu (context-menu.ts: withContextMenu),
           line icons (icons.ts: the eye), the key's checkboxes and its rows on
           prints (key/)
services/  shared state and registries, nothing drawn: live updates (live.ts),
           who has the map (map-mode.ts: measuring, drawing),
           what a printed map's legend lists (legend.ts), the background map's
           background: the map's colours or imagery, chosen in Settings (background.ts),
           the 3D view on or off (view3d.ts)
modules/   one folder per feature, each a ForkModule, listed in MODULES:
  details      a clicked feature's details in the left panel
  grid         routes between stations, where a power line goes, tower numbers
  extra        data from outside OSM
  sites        critical sites
  search       search descriptions, Photon
  coordinates  the cursor's position and MGRS; MGRS in search
  print        the map as a PDF with a legend (services/legend.ts: modules add to it)
  background   Settings → Background: the map or imagery
  satellite    the imagery (tells services/background.ts what there is)
  roads        bold roads, railways, trams and metro (each line its colour, lines
               sharing a track side by side), Data layers entries (off at first), the
               same at each zoom over the map and imagery (layers.ts), the map's own
               light ones hidden where ticked; borders over imagery (upstream's
               Borders entry); street names white over imagery
  buildings    building outlines (every one from zoom 15, the big ones from 12), a layer
               to switch on (clickable: details, copy); look.ts: roofs and shadows over
               imagery, raised to their height in the 3D view; parts.ts: the buildings
               mapped with parts (their parts raised instead)
  view3d       the 3D button: the map tilted, tilting and turning allowed, buildings on
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

**The screen:** no header. The right-hand dock (`ui/dock.ts`) holds Data layers
(upstream's layer list and key in one panel, `ui/data-layers.ts`: each entry's tick
box calls the layer switcher, its key sections fold under it) and My layers, one
open at a time (the panel element with class `visible`). A clicked feature's details
open in the left panel (`modules/details/`, through the `forkPopup.open` hook), the
Grid connection panel below it (`ui/left-column.ts` orders the left column). Settings,
print and your account are buttons at the bottom of the top-right column
(`ui/map-button.ts`); About this map is in the credits. Upstream's Background layer
group (OpenStreetMap) stays commented out in `src/openinframap.ts`: re-enabling it
breaks saved links whose layer list has no `A`. URLs come from `config.ts` (`VITE_*`
variables; `throughGate` sends local services through the gate). Search
(`src/search/`) combines coordinates, the backend (`search_feature`; picking a result
switches its layer on) and an optional Photon server (`VITE_PHOTON_URL` / Settings),
same-name results within ~5 km merged.

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
         map, by the kinds' prefixes), tools.ts (what a click does: wires the
         map's events; its parts in tools/: drawing, dragging, resize, copy,
         selection, sharing tools.types.ts's ToolsContext), interactions.ts (hover,
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
         outliner/ (the list: index.ts, rows/ item, layer, folder; menus.ts, editing.ts,
         drag.ts, footer.ts over types.ts's OutlinerContext; filter.ts, order.ts), palette.ts (the picker);
         userlayers.css lists the CSS files in order (order matters)
```

Every edit is a `Change`. It's applied at once, kept unsaved (in the browser too) and
sent with Save. The backend logs each one, and that log is the history. Users,
sharing and live sync are designed in `plans/archive/sync.md`. They plug into
`state/transport.ts`, `state/view.ts` (`canEdit`) and the backend's
`userdata/users.py`.

## Backend: `web-backend/src/fork/`

Starlette (entry point `src.main:app`), SQLAlchemy async with asyncpg
(`DATABASE_URL` with the `postgresql+asyncpg://` scheme; `pool_pre_ping`, so it
survives database rebuilds). The fork's routes are put ahead of upstream's (the
fork's search replaces upstream's at the same URL), behind a login check (`auth/`:
every route but logging in needs a session):

- `auth/`: accounts, sessions, the login page, `LoginMiddleware`;
- `about.py` and `templates/` (the about page, replacing upstream's: built on its
  `_base.html` layout);
- `search/` (the search box: `matching.py`, one file per kind of result, `ranking.py`;
  its name indexes, btree and `pg_trgm`, are made by upstream's `create_indexes.py`
  plus `indexes.py`: keep them in step with `search/`);
- `circuits.py` (names for unnamed circuits, replacing upstream's circuit API);
- `grid/` (`route.py`: routes over the power grid; `line.py`: where a line goes; `tower.py`), `line_trace/` (following a
  line), `grid_check.py` (lines ending at nothing, a command), `tower_numbers/`
  (towers numbered along their lines, a build step);
- `map_data.py` (a map feature's full geometry);
- `background/` (the background map's tiles, `/background/{z}/{x}/{y}.mvt`: each from
  the first `data/offline-maps/<area>.pmtiles` that has it, so several areas show together;
  at zooms 8 to 14 with the area's `<area>.zoomed-out.pmtiles` tile appended, its
  roads replacing the background map's (`mvt.py`: a tile's layers, undecoded);
  satellite imagery is the `satellite` service's; `zoomed_out.py`, a build step run
  after each download, from the zoom 15 tiles: the buildings big enough to see at
  zooms 12 to 14 (`zoomed_buildings.py`) and the roads at zooms 8 to 13 with what
  Protomaps drops there, tunnel marks, small roads, paths (`zoomed_roads.py`), and the
  railways at zooms 6 to 15, ranked from `<area>.railways.osm.pbf` (`zoomed_railways.py`);
  close tracks and carriageways drawn as one zoomed out (`close_lines.py`); trams and
  metro split into their lines from the routes, a strand each (`transit_lines.py`);
  `tiles.py` their tile geometry; `buildings.py`, a building's whole outline from the
  zoom 15 tiles, `/background/building/{id}`, for copies);
- `wikidata_offline.py` (popups from the offline Wikidata cache, by wrapping
  upstream's functions: upstream's files stay untouched) and `paths.py` (the caches);
- `userdata/`, My layers:
  - `schema.py` and `migrations/` (numbered, run once each: `userdata.schema_version`);
  - `changes.py` (applying and logging, no HTTP);
  - `layers.py`, `situations.py`, `images.py`;
  - `users.py`, where `current_user()` is the one place login and access control
    will go.

The backend runs in Docker from its image (`web-backend/Dockerfile`; Compose starts
`/app/.venv/bin/uvicorn` directly, so `uv run` doesn't sync at startup), with
`data/images`, `data/wikidata_json` and `data/offline-maps` mounted: after changing
it, run `docker compose up -d --build backend`.

## Data and build: `scripts/`, `schema/`, `imposm/`, `tegola/`

OSM extract → osmium filter (`scripts/osm_filter.py`, made from the imposm mapping)
→ imposm (`imposm/*.py` mappings; the fork's: `places.py`, `osm_place` for search,
and `sites.py`, `osm_site`, critical sites) → PostGIS → the SQL steps → Tegola
(vector tiles) → the frontend. Changing the mapping changes the osmium filter and
the schema fingerprint builds and exports carry.

- **The build's steps, in order:** region menu → download to `data/osm/` → osmium
  filter → `docker compose down -v` → imposm import → `views`, `distances`, `stats`,
  `places`, `sites`, `grid` (the power grid network), `tower-numbers` +
  `number_towers` → search indexes → extra data, `extra`, `search` → EEZ →
  `local-stats` (a fast per-country stats snapshot) → `oim_build_info` → Tegola →
  the offline maps queued in the menu (a background map: `pmtiles extract` of the
  area's outline from Protomaps' daily build, then its buildings, roads and railways
  zoomed out (the railways cut from the region's OpenStreetMap extract: `offline_maps/railways.py`);
  `select_basemap` points `VITE_BASEMAP_URL` at the backend's `/background`). Every
  question comes before the first long step.
- **SQL (`schema/`):** upstream's: `dev-init.sql` / `prod-init.sql` (once, when the
  database is created: extensions, roles), `functions.sql` (before `views.sql`),
  `views.sql` (what Tegola queries), `stats.sql`, `jobs/` (upstream's production
  job). The fork's, in `schema/fork/`: `distances.sql` (real metres:
  `oim_units`, `oim_max_stretch`, `oim_ground_area`), `places.sql`, `sites.sql`
  (`site_feature`, `site_points`), `grid.sql` (`grid_node` / `grid_edge`, used by
  `/grid/route` and `/grid/line`), `tower-numbers.sql`, `extra.sql` (the `extra`
  schema), `search.sql` (`search_feature`, rebuilt after extra data changes),
  `eez.sql`, `local-stats.sql`. My layers' schema is the backend's numbered
  migrations (`userdata/migrations/`).
- **Tegola (`tegola/`):** `config.toml` is generated from `tegola.yml`, `layers.yml`
  (upstream's) and `layers.fork.yml` (`generate_tegola_config.py`); never edit it.
  Tegola caches tiles in its container: recreated after the data is replaced.

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
    connection doesn't come back, 76 at once when only that server stops answering
    while the internet works (an anti-bot block). Never call curl for a download
    directly;
  - `json`: `json_get`, `json_write` (manifests);
  - `docker`: **every Docker call**: `up_services` (start services, images rebuilt
    first, offline the ones there), `compose_run` (a one-off container of a service),
    `backend_python` (the backend's image, for build steps written in Python). The
    Python scripts' one is `offline_maps/docker.py` (`run` an image, `run_service`;
    `as_root` for images whose programs only run as root, the files given back);
  - `db`: `SCHEMA_FILES`, the SQL steps in order, by name (`schema_file`: upstream's
    in `schema/`, the fork's in `schema/fork/`), `run_schema` (with each step's
    label), `schema_hash` (the fingerprint exports carry), and what building and
    importing share: `fresh_database` (My layers and extra data kept),
    `put_back_my_layers`, `restart_map_services`;
  - `eez`, `extra`, `userdata`, `exports`, `app`, `basemap` (`select_basemap`: the
    frontend pointed at the backend's background map), `geofabrik` (the index, region lookups,
    extracts), `offline-maps` (the imagery server, the menu during a build).
- **`netsafe.py`:** the same for the Python downloads (satellite imagery, extra
  data, the Wikidata cache): `safely(call, url)`, `fetch(url)`, `fetch_file(url, path)`,
  `run_until_connected(main)`. Same settings (`NET_WAIT_SECONDS`,
  `NET_CHECK_EVERY`).
- **`offline-maps.py`** is the command line for `offline_maps/`, the offline maps
  into `data/offline-maps/`: Blue Marble for the world, Sentinel-2 10 m for an area
  or the world, aerial photos by country (France's as IGN's BD ORTHO files, one
  département at a time, never IGN's tile server, which blocks bulk downloads) as
  `<area>.sat-*.pmtiles`, background maps as `<area>.pmtiles`. Its menu is
  `offline-maps.sh` (for the region built, no rebuild; `build-region.sh` opens it
  with `--queue-only` and downloads the queue after the build); `select_satellite`
  writes `VITE_SATELLITE_TIERS` (every imagery file and its credit; `start.sh`
  refreshes it). The package:
  - `sources/`: one file per source (`SOURCE`, fields in `source.py`): Blue
    Marble, Sentinel-2, the aerial photos by country, the background map; read into
    `SOURCES`, credits;
  - `tiles.py`, `estimate.py`, `download.py` (tiles into MBTiles, through
    `netsafe`), `gdal.py`, `docker.py` (every Docker call);
  - `bdortho.py`: France's photos as IGN's files, one département at a time
    (`departements.py`: their codes, names, areas, bounds and regions);
  - `inventory.py`: what's in `data/offline-maps/` (`inventory.json`, made from the
    files), stopped jobs, `settings.json`, the one-download lock;
  - `coverage.py`: what's worth offering (zooms another source takes over, areas
    inside areas, what could be freed);
  - `maps.py`: the offline maps menu (`offline-maps.py maps`), its screens through
    `ui.py`; `offers.py`: what each source offers and the downloads it makes;
    `jobs.py`: a download and the queue (Resume);
  - `regions.py` (Geofabrik's index), `aerial.py` (tile-server photos),
    `pmtiles.py` (a file's header), `extract.py` (background maps);
  - `cli.py`: one command per download, `maps`, `tiers` / `summary` (what the map
    is told about the imagery).
- **`extra_data.py`** is the command line for `extradata/`: `base.py`, one file per
  source, and `SOURCES`.
- **Exports** (`export-db.sh`, `import-db.sh`) carry the database: a `pg_dump` of
  the `public`, `countries`, `stats`, `extra` and `userdata` schemas and a manifest.
  The restore skips what a fresh database already has (PostGIS, `spatial_ref_sys`,
  `functions.sql`'s functions) but keeps `views.sql`'s (Tegola needs them). An
  export that's out of date is redone by `build-region.sh` and `start.sh`.
- **`launch.sh`, `start.sh`:** start everything, the frontend in a new terminal
  window (`open_in_terminal`). **`fetch_images.py`:** the offline Wikidata cache
  (entity JSON, Commons thumbnails) in `data/`.

## Recipes

**A map layer from OSM** (e.g. airports):
1. Add the mapping in `imposm/` (a new `*.py`, like `sites.py`). This changes the
   osmium filter and the fingerprint.
2. SQL views in a `schema/fork/*.sql`. A new file goes in `SCHEMA_FILES` and
   `SCHEMA_LABELS` (`lib/db.sh`) and in a `run_schema` line of `build-region.sh`.
3. The tile layer in `tegola/layers.fork.yml`, then regenerate `config.toml`.
4. A module in `fork/modules/<name>/`: its `layers()` (style),
   `switcherGroups()`, `key()`, popup rules. Add it to `MODULES`.
5. Strings: `npm run fork-strings`. Searchable by name: `schema/fork/search.sql`.
6. Rebuild the region. `consistency.test.ts` fails if a tile layer isn't drawn, or a
   layer can't be switched off.

**Data from outside OSM:**
1. Write a `Source` class in a new file in `scripts/extradata/`, plus a line in
   `SOURCES`.
2. Add its tables or views in `schema/fork/extra.sql`, and draw it in `modules/extra/`.

**A country's aerial photos:**
1. Add a file in `offline_maps/sources/` (copy one of the same kind, e.g.
   `lu_geoportail.py` for a tile server, `be_wallonia.py` for a WMS): its `SOURCE`
   with the URL, region, metres per pixel, last zoom, credit.
   `tests/test_sources.py` checks it.
2. Check that it answers tile requests and allows offline copies.

The credit reaches the map by itself (`VITE_SATELLITE_TIERS`).

**Something clickable on the map:** an area clickable anywhere inside, or a thin line
easy to hit: `clickableArea` / `hitLine` in `core/map-style.ts` (their `<id>_hit`
layer is what clicks find). A colour that changes over satellite imagery:
`followBackground` (`services/background.ts`).

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
