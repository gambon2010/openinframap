# How the fork changes upstream

This fork of [openinframap/openinframap](https://github.com/openinframap/openinframap)
exists to run Open Infrastructure Map **entirely on your own computer**: your own
database, tile server and backend, built from OpenStreetMap data for a region you
choose, and shareable (on a USB drive, say) with a computer that has no internet
connection.

This page is what a merge from upstream needs: the goals, what the fork's code
may and may not touch, and every upstream file it changes. How the fork is
organised, and recipes for adding to it: [ARCHITECTURE.md](./ARCHITECTURE.md).
What changed when, and why: [HISTORY.md](./HISTORY.md). How to use it:
[LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md).

## Goals and decisions

| Goal | Decision |
|------|----------|
| A new user shouldn't need to understand the stack | One entry point (`scripts/launch.sh`) that asks a few questions up front and then runs unattended; `scripts/start.sh` for every day after |
| Any region, up to the whole world | Geofabrik regions by menu or search, plus the planet file; downloads are kept and reused |
| Don't reprocess big regions | Ready-made exports (`export-db.sh` / `import-db.sh`) restore in minutes |
| Work without internet | Exports carry the database; the Docker images are saved alongside; the backend runs from its image |
| Background map offline too | Optional per region: `build-region.sh` downloads it (full or reduced detail) and a small local server serves it; otherwise it comes from openinframap.org |
| Stay mergeable with upstream | New behaviour lives in new files (`scripts/`, `schema/local-stats.sql`, `schema/eez.sql`, `tools/`) where possible; upstream files get small, commented changes |

---

## Known limitations

- **Background map needs internet** unless you downloaded one for the region (or point
  `VITE_BASEMAP_URL` / Settings → Map sources at your own server). Planned: a local
  geocoder, preferring local services and falling back to the online ones, with the
  panel showing and overriding each URL.
- **Node.js and npm must be installed** on the computer running the frontend.
- **Street addresses** need a Photon server (not set up by the scripts); places
  (cities down to hamlets) are found offline for the built region.
- **No live updates**: data is a snapshot; rebuild to refresh.
- **Time estimates for the whole world** are scaled from the Russia build; the first
  real world build will show actual numbers in `build-history.log`.
- **Photos missing on Wikidata** keep showing as "missing" in the cache count.

---

## Fork structure: keeping upstream's files close to upstream

Upstream won't take the fork's changes, so the fork keeps them out of upstream's
files wherever it can, and where it can't, makes them one-line hooks. Upstream
commits then merge with few or no conflicts.

**Frontend: fork modules.** Everything the fork adds to the map lives in
`web/src/fork/`. A module (`ForkModule` in `fork/types.ts`) can add map sources,
layers, layer switcher groups, key sections, popup rules, search descriptions and
code that runs once the map exists. `fork/index.ts` lists the modules and has the
hooks upstream files call:

| Upstream file | Hook |
|---|---|
| `style/style.ts` | `...forkSources()` in the sources, `...forkLayers()` in `getPrimaryLayers` |
| `openinframap.ts` | `...forkSwitcherGroups()` before the Validation group; `forkInit(...)` before clicks are routed (with the URL hash, the info popup kept in a variable, and the circuit inspector) |
| `key/key.ts` | `await forkKey(...)` once its sections are built; `data-icon` on sprites |
| `key/svg.ts` | swatches carry `data-colour`, `data-dash` or `data-layer` |
| `popup/infopopup.ts` | `forkPopup.hiddenKeys()`, `.renderKey()`, `.title()`, `.html()`; `forkPopup.open()` first in `popup()` (details in the side panel) |
| `search/search.ts` | `forkSearchSelected(result)`, `forkSearchProviders(language)` (Photon, grid references) and `dropDuplicates` (all from `fork/index.ts`); results carry the backend's result (`backend`) |
| `search/openinframap.ts` | `forkSearchDescription(result)`; `backend: result` |
| `index.ts` | `addForkTranslations()` |

**Folders by role** (`docs/plans/refactor.md`, step 4):

```
web/src/fork/
  index.ts, types.ts, config.ts   the only files upstream imports
  core/                           no UI: i18n.ts (the t() helper)
  ui/                             shared building blocks: dock, panel, settings, key/
  modules/<name>/                 one folder per feature, each a ForkModule
```

Rules, checked by `fork/structure.test.ts`:
- a module imports `core/`, `ui/`, the root files and its own files, never another
  module;
- `ui/` imports only `core/` and the root files;
- `core/` imports nothing else of the fork;
- upstream files import only `fork/index.ts`, `fork/types.ts` and `fork/config.ts`.

Modules:
- `extra` (data from outside OSM);
- `sites` (critical sites);
- `userlayers` (My layers: symbols, pictures, drawings, copies, saving, history);
- `search` (place and feature descriptions, switching a result's layer on, Photon);
- `details` (a clicked feature's details in the left panel, highlighted; a second
  click closes them; search results open the same way);
- `grid` (routes between stations, "Route from / to here" and where a power line
  goes, both added to the details with `addDetailsExtra`);
- `satellite` (imagery as the background);
- `map-sources` (its Settings section);
- `layout` (the dock for the layer list and key, the Settings link, the search box
  in the top bar).

Shared: `ui/left-column.ts` (the left-hand panels in a fixed order, whichever
module adds them: My layers' sidebar 10, the details panel 20, the grid route 30;
it also holds the one details panel and highlight), `ui/details.ts` (the details
panel; `onShow` listeners, e.g. the route folds itself; `addDetailsExtra` for what
modules add to a feature's details), `ui/highlight.ts`, `ui/dock.ts`, `ui/panel.ts`
and `panel.css` (one look for panels),
`ui/settings.ts` (modules add sections with `addSettingsSection`, placed by
`order`). The key's checkboxes (`ui/key/toggles.ts`) are added to upstream's rows
after they're built, working out what each row hides from its swatch, so upstream's
key code is unchanged.

**Adding a feature** = a new folder in `modules/` plus a line in `MODULES`.

**Translations.** The fork's English strings are in `web/src/fork/locales/en.json`,
added to upstream's at startup (`i18next.addResourceBundle`), which also lets the
fork override an upstream string. Upstream's `web/locales/` is untouched. Fork
code uses one helper, `t(key, English, values)` from `web/src/fork/core/i18n.ts`,
never HTML-escaped (the fork puts text on the page as text), so names with `&` or
quotes show as typed; `npm run fork-strings` adds new keys to `en.json`.

**Tile server.** The fork's layers are in `tegola/layers.fork.yml`;
`generate_tegola_config.py` takes more than one layers file (the fork's use
`layers.yml`'s field sets) and the Dockerfile passes it. `layers.yml` is
upstream's.

**Backend.** `web-backend/src/fork/`: its routes go ahead of upstream's
(`main.py`: `routes = fork_routes + routes`), so the fork's search
(`fork/search.py`: word matching, places, everything else with a name) replaces
upstream's at the same URL while `views/search.py` stays upstream's. Its extra
indexes (`fork/indexes.py`) are appended to `create_indexes.py`'s lists.

**Docker Compose.** `docker-compose.yml` is upstream's; the fork's services
(backend, basemap, osmium), ports and SELinux labels are in
`docker-compose.override.yml`, which Compose merges automatically (`!override`
replaces tegola's port list).

**Docs.** `web/README.fork.md` and `web-backend/README.fork.md` hold the fork's
notes; upstream's READMEs only get a pointer line at the end.

## Merging from upstream

The fork's own files are under `web/src/fork/`, `web-backend/src/fork/`,
`scripts/`, `tools/`, the fork's `schema/*.sql` and `imposm/*.py` files,
`tegola/layers.fork.yml`, `docker-compose.override.yml`, `*.fork.md` and the docs.
Upstream files the fork still changes, and how:

Trial merge, 2026-11-07 (branch `trial-upstream-merge`, not pushed): upstream's 12
commits since 2026-10-13 (translations, dependency upgrades) merge cleanly but for
the dependency files. `web/package.json`: keep the fork's packages (`magvar`,
`mgrs`) and take upstream's versions. `web/package-lock.json` and
`web-backend/uv.lock`: take upstream's (`git checkout --theirs`), then `npm install`
and `uv lock` add the fork's packages back. After it every check passed (fork's
frontend tests, the build, backend and scripts tests); `tsc` shows the same 31
errors in upstream's own files as before.

| File | Change |
|------|--------|
| `README.md` | The fork's description (the GitHub page) |
| `.github/workflows/*.yml` (upstream's six) | Their image build jobs only run in upstream's repository (`if: github.repository == 'openinframap/openinframap'`): a fork can't push to upstream's registry. The fork's tests run in its own `fork-tests.yml`. |
| `imposm/main.py` | Imports `places.py` and `sites.py`; no longer excludes the keys they match on |
| `schema/dev-init.sql` | Database from `template_postgis`, pre-installs `intarray` / `hstore` |
| `schema/functions.sql` | Function order fixed for fresh installs |
| `tegola/generate_tegola_config.py`, `Dockerfile` | More than one layers file |
| `web-backend/create_indexes.py` | Appends the fork's indexes |
| `web-backend/src/main.py` | `pool_pre_ping`; the fork's routes first; the fork's middleware (login) after the database's; the database middleware skips the fork's streams (`streaming_paths`) |
| `web-backend/pyproject.toml`, `uv.lock` | `networkx` (grid routes), `types-networkx` |
| `web/src/index.ts`, `openinframap.ts`, `style/style.ts`, `key/key.ts`, `key/svg.ts`, `popup/infopopup.ts`, `search/search.ts`, `search/openinframap.ts` | Fork hooks (above); backend and tile URLs configurable; background switch hidden; the night lights' source removed (`style.ts`; on a merge, keep it out) |
| `openinframap.ts` (the `GeolocateControl` removed) | The "find my location" button removed (2026-11-06, asked for). On a merge, keep it out. |
| `web/src/edit-control.ts`, `edit-control.css` (deleted), `openinframap.ts` (its import and `addControl`) | The Edit button removed: it opened OpenStreetMap's online editors (iD, JOSM), which this offline map has no use for. On a merge, keep them deleted. |
| `web/src/style/style_osmose.ts`, `popup/validation-error-popup.ts`, `.css`, `remote-control.ts` (deleted), `style/style.ts` (the `osmose_errors_power` source, the import), `openinframap.ts` (the Validation group, the popup) | The Osmose validation layer removed (2026-11-11, asked for): it loaded OpenStreetMap's live error reports from osmose.openstreetmap.fr, online only, about data that isn't the local copy. Saved links listing its `E` still open (unknown codes are ignored). On a merge, keep them deleted. |
| `web/src/geocoder.ts`, `search/opencage.ts`, `elements/tab-pane.ts`, `.css`, `icons/validation_error.svg` (deleted) | Nothing imported them (OpenCage was replaced by the local search and Photon; the tab pane had no user; the icon was Osmose's). 2026-11-12, the clean-up. On a merge, keep them deleted unless upstream starts using one. `package.json` still lists upstream's packages they used (left: fewer merge conflicts). |
| `web/src/search/search.ts` | Photon instead of OpenCage (`opencage.ts` is kept, unused); `Promise.allSettled` |
| `web/src/api.ts` | Backend URL configurable; no error when it's unreachable |
| `web/src/style/style_base.ts`, `style_oim_power.ts`, `style_oim_petroleum.ts` | Background layers hidden; the night lights' two layers removed (`black_marble*`); a few constants exported for the fork's styles |
| `web/src/elements/external-links.ts` | Popup crash fix |
| `web/vite.config.ts` | Proxies backend routes (also `/userdata`) to the configured backend; PWA exclusions; larger precache limit (symbol and graphics libraries); tests exclude `src/fork/` |
| `web/package.json`, `package-lock.json` | `@syncpoint/signs` (My layers' symbols), `@armyc2.c5isr.renderer/mil-sym-ts-web` (tactical graphics); dev: `happy-dom`; script `test:fork` |
| `web/index.html` | "export (online)" label |

After merging, check: `bash scripts/build-region.sh --region luxembourg --rebuild
--yes`, then `bash scripts/start.sh`, and try a search and a country stats page.
If the import mapping or views changed, old exports will warn that they don't match.
