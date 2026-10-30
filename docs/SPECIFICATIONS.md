# Specifications

Everything the project owner has asked for, in one place, from the first session
(2026-10-14) on. Each item says what was asked, its status and where it lives.
**Keep this file up to date:** add new requests here when they're made, and change
the status when they're done.

Status: ✅ done · 🚧 in progress · 📋 planned (plan written) · 🗂 backlog (parked,
don't start unprompted) · ✖ dropped or replaced

How the work is organised: [FORK_CHANGES.md](./FORK_CHANGES.md) (what changed and
why), [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) (user guide), `docs/plans/`
(plans for bigger features).

---

## 1. Goals and ground rules

| # | Requirement | Status |
|---|---|---|
| 1.1 | Run Open Infrastructure Map 100% on localhost, and fully offline from a built or imported database. | ✅ |
| 1.2 | A new user shouldn't need to understand anything: setup and data building automated as far as possible. | ✅ |
| 1.3 | Upstream (russss/openinframap) won't take the fork's changes: keep the fork's code apart from upstream's so upstream changes merge easily. Changing upstream files is OK if it stays easy to merge (one-line hooks). | ✅ `web/src/fork/`, `web-backend/src/fork/`, `tegola/layers.fork.yml`, `docker-compose.override.yml`; list in FORK_CHANGES "Merging from upstream" |
| 1.4 | Keep upstream's `main` changes merged into the fork. | ✅ (merged 2026-10-14) |
| 1.5 | Remove stale branches. | ✅ |
| 1.6 | Docs explain what was done and why; the GitHub page (README) describes the fork. | ✅ FORK_CHANGES, LOCAL_DEVELOPMENT, README |
| 1.7 | One place with all the specifications (this file). | ✅ |
| 1.8 | Unit tests for the fork's code where they make sense; not for upstream's code unless needed. | ✅ |
| 1.9 | Licences: don't copy code whose licence would change the project's (e.g. ODIN is AGPL). | ✅ (rule followed) |

## 2. Setup, building and sharing data

| # | Requirement | Status |
|---|---|---|
| 2.1 | Interactive script that builds the data for a chosen region (continents, countries, sub-regions from Geofabrik). | ✅ `scripts/build-region.sh` |
| 2.2 | An option for the whole world, with a warning that it takes long. | ✅ |
| 2.3 | Keep downloads and show which files are already present; don't re-download (e.g. Russia). Keep a log of builds. | ✅ `data/osm/`, build log |
| 2.4 | EEZ boundaries: explain them; ask the user to download them (with the link) or skip; show progress so the script never looks frozen. | ✅ |
| 2.5 | At the end, offer to fill the Wikidata image cache, warning it can take long and naming the script to run later. | ✅ `scripts/fetch_images.py` |
| 2.6 | Offer to start the frontend/backend in a new terminal window; open the browser on the map when ready. | ✅ `start_app`, `open_in_terminal` |
| 2.7 | `launch.sh` (first time, everything) and a no-questions daily start. | ✅ `launch.sh`, `start.sh` |
| 2.8 | Export / import a built database to share the project without internet (copy to a flash drive). Exports found by the build script replace the matching menu entry ("import Russia"). | ✅ `export-db.sh`, `import-db.sh`, `data/exports/*.oimdb` |
| 2.9 | Backend in Docker so the project is easy to copy. | ✅ Compose service `backend` |
| 2.10 | Build performance: per-country stats fast for big countries. | ✅ `schema/local-stats.sql` |
| 2.11 | Extra data (not from OSM) is offered in the build script for the regions it covers (e.g. France or a French sub-region), and is included in export/import. | ✅ |
| 2.12 | Rebuilding the OSM data must not delete the extra data (it's slow to download): keep it, and keep the raw downloads to rebuild from. | ✅ `data/extra/` |
| 2.13 | List the dependencies needed to run the project from nothing. | ✅ LOCAL_DEVELOPMENT "Prerequisites" |
| 2.14 | Rebuilds and imports keep My layers (they belong to the computer). | ✅ |
| 2.15 | Should the setup scripts have tests? (asked 2026-10-30) | 🚧 see section 11 |
| 2.16 | Re-export a region's ready-made export by default when it's out of date (no question). | ✅ `reexport_if_outdated` in `build-region.sh` and `start.sh` |

## 3. Background map and map sources

| # | Requirement | Status |
|---|---|---|
| 3.1 | Don't host background tiles by default: use the online default, or let the user configure a local server. | ✅ (then extended by 3.3) |
| 3.2 | A place in the UI to see and change the tile server URL, with an explanation of how to change the default in the config; the change lasts for the session only. | ✅ now in **Settings** |
| 3.3 | Fully offline needs a local background map: build-script option to download one (full or reduced detail) for the region. | ✅ Protomaps extract, `basemap` service |
| 3.4 | Night lights layer: disabled (online only, broke the map). | ✅ hidden |
| 3.5 | Future: one command that sets up local tile server + local geocoder; priority local from config, fall back to online defaults, UI override showing the URL in use. | ✅ partly (local basemap, Photon optional); single command for Photon not done |
| 3.6 | Satellite imagery as a build-script option: NASA Blue Marble for zoom 0–8, intermediate zooms from 10 m imagery, optional high resolution; offline. | ✅ `scripts/satellite.py`, `fork/satellite/`; Settings → Background |

## 4. Search

| # | Requirement | Status |
|---|---|---|
| 4.1 | Search works on localhost. | ✅ |
| 4.2 | "vianden" finds "Centrale de Vianden" (words inside names). | ✅ |
| 4.3 | Offline place search (cities, towns, villages, hamlets, neighbourhoods) from the local database; OpenCage removed. | ✅ |
| 4.4 | Optional Photon server for addresses, configurable in the map sources; not installed by the scripts. | ✅ |
| 4.5 | Everything with a name is searchable (critical sites, lines, telecoms, pipelines, water, extra data...). | ✅ `schema/search.sql` |
| 4.6 | Picking a result opens its details and highlights it, like a click. | ✅ |

## 5. Map display, key and layers

| # | Requirement | Status |
|---|---|---|
| 5.1 | In the key, untick any line, icon or other row to hide it from the map. | ✅ `fork/key/` |
| 5.2 | Key checkboxes aligned. | ✅ |
| 5.3 | Underground filter works. | ✅ |
| 5.4 | Low-voltage lines easier to click without drawing them bigger. | ✅ |
| 5.5 | Layer list scrolls when taller than the map. | ✅ |
| 5.6 | Layers and Key open on click (not hover), placed correctly (not over the buttons); one look for all panels. | ✅ `fork/ui/dock.ts`, `panel.css` |
| 5.7 | Map sources moved to a Settings page opened next to about / stats / export. | ✅ `fork/ui/settings.ts` |
| 5.8 | Feature details in a panel on the left (not a bubble over the map), above the Grid connection panel; each with minimise (keeps the highlight) and close (removes it). | ✅ `fork/grid/` |
| 5.9 | Highlight what's clicked: icons, areas (the area if big enough on screen, else the icon), lines. | ✅ |
| 5.10 | Clicking the same feature again deselects it. | ✅ |
| 5.11 | Photos never make the details panel scroll (shrink them); vertical scroll only for long details. | ✅ |
| 5.12 | The map search box in the top bar, right of the header (title, about, stats...), not above the panels on the left. | ✅ `fork/ui/search-bar.ts` (narrow screens: stays on the left) |

## 6. Grid connections (power routing)

| # | Requirement | Status |
|---|---|---|
| 6.1 | Show which power lines connect two places (e.g. a plant in France and a substation in Germany), with multiple paths. | ✅ prototype, `fork/grid/`, `web-backend/src/fork/grid.py` |
| 6.2 | Only lines of 110 kV and more for routes. | ✅ |
| 6.3 | Stations only on lower voltages (wind parks, biogas on a 65 kV line) connect over those lines to the 110 kV+ grid; a station that isn't connected because data is missing (e.g. Germany outside the region) is fine. | ✅ |
| 6.4 | A route is drawn as one line (no different line styles at substations); lines through a station's outline are drawn. | ✅ |
| 6.5 | The panel lists what the route goes through: each stretch with its distance, and a total. | ✅ |
| 6.6 | Highlight a power line when selected to see where it goes. | ✅ |
| 6.7 | Works on a country the size of France. | ✅ (build ~2 min) |

## 7. Extra data (not from OpenStreetMap)

| # | Requirement | Status |
|---|---|---|
| 7.1 | Street-level power lines and distribution substations missing from OSM, from open data (France first: Agence ORE, all operators; then other countries). All voltages, low voltage included. | ✅ France |
| 7.2 | Kept in a separate `extra` schema; imported when the user asks. | ✅ |
| 7.3 | No duplicates with OSM: what OSM already has is left out of the extra data (OSM kept as is). | ✅ |
| 7.4 | Data from everywhere the source covers (no metropolitan-France-only rule). | ✅ |
| 7.5 | Displayed like OSM data: same voltage colours as the key, under the Power lines section of the key; no extra open-data-only filters in the key (the layer switcher toggles them). | ✅ |
| 7.6 | Gas distribution network (unknown pressure treated as low-pressure distribution); biomethane injection points; ICPE classified installations (Géorisques). | ✅ |
| 7.7 | ICPE duplicates of OSM power plants: don't drop factories that just have solar panels. | ✅ |
| 7.8 | Not wanted: HTA/BT poles (clutter). | ✖ |
| 7.9 | Other countries' open distribution data (e.g. Germany). | 🗂 |
| 7.10 | FINESS health establishments, fuel stations (after the OSM equivalents). | 🗂 |

## 8. Critical sites (from OpenStreetMap)

| # | Requirement | Status |
|---|---|---|
| 8.1 | Layers for infrastructure people tend to miss: airports, ports, military bases, data centres, food depots, health and emergency, government (mairie, trésorerie, CAF...), places of worship with an icon per religion, fuel and weapons, transport hubs, dams, landfills, weather stations... | ✅ `imposm/sites.py`, `schema/sites.sql`, `fork/sites/` |
| 8.2 | Disused military (bunkers, trenches) as its own category. | ✅ |
| 8.3 | Pharmacies yes (not visible from far out); defibrillators and post offices no. | ✅ |
| 8.4 | Supermarkets and wholesale (cash & carry) shown. | ✅ |
| 8.5 | Icons shown at every zoom; nearby icons grouped into a count bubble when zoomed out; never grouped when zoomed in. Only for the critical-sites layers (the grid stays as it is). | ✅ `site_points()` |
| 8.6 | Seveso sites, EU industrial emissions, IXPs (PeeringDB), satellite ground stations... | 🗂 |

## 9. My layers (your own layers on the map)

| # | Requirement | Status |
|---|---|---|
| 9.1 | Add your own objects to the map: symbols, images, icons. | ✅ |
| 9.2 | Make your own layer, add (copy) map features such as power lines to it, hide the grid but not your layer: the copies stay drawn. | ✅ |
| 9.3 | Saved in the database with a Save button that sends the local changes. | ✅ |
| 9.4 | Change tracking that can be played back step by step. | ✅ |
| 9.5 | Symbols from ODIN (syncpoint/ODINv2): military and emergency symbols. | ✅ point symbols via `@syncpoint/signs` (MIT); ODIN's code not used (AGPL) |
| 9.6 | ODIN's "actions": tactical graphics (axes of advance, attack directions, boundaries, phase lines, task symbols...). Use mil-sym-ts if it covers them, else write our own inspired by ODIN. | ✅ mil-sym-ts (`fork/userlayers/graphics.ts`); 197 point + 212 line/area graphics |
| 9.7 | Rework the My layers UI (tabs Layers / Add / History, save bar, history as a timeline bar). | ✖ done, then replaced by 9.13–9.14 (sidebar and toolbar) |
| 9.8 | ODIN's descriptive fields per symbol (designation, higher formation, status, date-time group, comments...), edited in the left panel, drawn on the map. | ✅ `editor.ts`, `fields.ts`, `sidc.ts` |
| 9.9 | History steps say what changed. | ✅ |
| 9.10 | Edit the shape of lines, areas and graphics after drawing them; move items between layers. | ✅ |
| 9.12 | Arrows (e.g. main attack) easy to draw and good-looking: drawn as a path; the size has its own handle (the 4th point), not part of the highlighted path, that only changes the width. Old arrows converted. | ✅ |
| 9.13 | Rework the whole My layers panel for easier access and better display (not ODIN's style). | ✅ `docs/plans/my-layers-v3.md` |
| 9.14 | Left sidebar shared with search, feature details and the grid route; tools on the map; default details per kind; situations (named moments) shown with one line and a banner; layer folders that fold. | ✅ all built; not done: situations as marks on the history bar, box selection |
| 9.15 | Undo (Ctrl+Z) goes on after a Save without rolling back the server: undoing a saved change is a new change, saved like any other, that puts back only the fields that change touched (others' later edits stay); undoing a change that cancels another (lock, unlock) doesn't count as unsaved. | ✅ `Store.undo`, `unsavedCount` |
| 9.16 | Layer folders in the layer list: "+ New folder", drag a layer onto a folder or a layer, or ⋯ → Move to folder (a list of folders). | ✅ `outliner.ts` |
| 9.11 | Resize pictures (and symbols, markers) shown on the map: a handle on the map, and a Size setting (20–800 %). | ✅ |

## 10. Backlog (parked)

| # | Item | Status |
|---|---|---|
| 10.1 | Wikipedia and GEM wiki links in popups open offline (cached pages; Kiwix, GEM bulk download looked into). | 🗂 |
| 10.2 | Military grid coordinates (MGRS) under the cursor and in search; range rings; distance/area measuring. | 🗂 |
| 10.3 | Terrain: hillshading and line of sight (Copernicus 30 m elevation, offline). | 🗂 |
| 10.4 | Grid what-if: what loses its connection if a substation is hit. | 🗂 |
| 10.5 | Time on items: valid from/to and a timeline slider. | 🗂 |
| 10.6 | Users: a login page, user accounts, access control per user (view the map; read or write each layer). | 🗂 asked 2026-10-30 |
| 10.6b | Auto sync of My layers between users (instead of / alongside Save); how it should work is to be discussed (conflicts, offline edits, history). | 🗂 asked 2026-10-30, to discuss |
| 10.7 | Import/export GeoJSON, KML, GPX; print a PDF with a legend. | 🗂 |

## 11. Quality

| # | Requirement | Status |
|---|---|---|
| 11.1 | Unit tests for the fork's code (frontend: Vitest; backend: pytest), where they make sense. | ✅ 91 frontend (`npm run test:fork`), 13 backend (`tests/fork/`), 58 scripts (`scripts/tests/`) |
| 11.2 | Tests for the setup scripts. | ✅ the scripts run in a sandbox with fake Docker/network (options, refusals, safety rules); a real Luxembourg build, export and import in a separate test database (opt-in) |
