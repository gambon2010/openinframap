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
| 3.6 | Satellite imagery as a build-script option: NASA Blue Marble for zoom 0–8, intermediate zooms from 10 m imagery, optional high resolution; offline. | ✅ `scripts/satellite.py`, `fork/modules/satellite/`; Settings → Background |
| 3.7 | Download satellite imagery for the region already built without losing the data (no rebuild). | ✅ `scripts/satellite.sh` |
| 3.8 | Blue Marble for the whole world by default; a menu that explains each choice. | ✅ one shared `world.sat-overview.pmtiles` (~330 MB) |
| 3.9 | Sentinel-2 for other countries or the whole world; high-resolution photos for more countries than France. | ✅ `satellite.py choose`, `DETAILED_SOURCES` (14 sources, 10 countries); the world end to end not run (too big to test) |

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
| 5.1 | In the key, untick any line, icon or other row to hide it from the map. | ✅ `fork/ui/key/` |
| 5.2 | Key checkboxes aligned. | ✅ |
| 5.3 | Underground filter works. | ✅ |
| 5.4 | Low-voltage lines easier to click without drawing them bigger. | ✅ |
| 5.5 | Layer list scrolls when taller than the map. | ✅ |
| 5.6 | Layers and Key open on click (not hover), placed correctly (not over the buttons); one look for all panels. | ✅ `fork/ui/dock.ts`, `panel.css` |
| 5.7 | Map sources moved to a Settings page opened next to about / stats / export. | ✅ `fork/ui/settings.ts` |
| 5.8 | Feature details in a panel on the left (not a bubble over the map), above the Grid connection panel; each with minimise (keeps the highlight) and close (removes it). | ✅ `fork/modules/grid/` |
| 5.9 | Highlight what's clicked: icons, areas (the area if big enough on screen, else the icon), lines. | ✅ |
| 5.10 | Clicking the same feature again deselects it. | ✅ |
| 5.11 | Photos never make the details panel scroll (shrink them); vertical scroll only for long details. | ✅ |
| 5.12 | The map search box in the top bar, right of the header (title, about, stats...), not above the panels on the left. | ✅ `fork/modules/layout/search-bar.ts` (narrow screens: stays on the left) |
| 5.13 | The header's "about" and "stats" pages: do they still make sense for this app? Remove them or update what they say (about: probably keep; stats: doubtful). | ✅ "stats" and "export (online)" removed; "about" is the fork's page: this map's data, how to use it, credits (2026-11-03) |
| 5.14 | No header: Settings (the app's: background, map sources, accounts), print and the account (Log out) as buttons among the map's (top right); About in the map's credits; My layers' settings in their own window, opened from My layers only. | ✅ (2026-11-06) |
| 5.15 | A debug option in Settings showing the zoom, scale, tiles, layers and what is under the pointer. | ✅ (2026-11-06) |
| 5.16 | No Edit button (OpenStreetMap's online editors). | ✅ (2026-11-06) |

## 6. Grid connections (power routing)

| # | Requirement | Status |
|---|---|---|
| 6.1 | Show which power lines connect two places (e.g. a plant in France and a substation in Germany), with multiple paths. | ✅ prototype, `fork/modules/grid/`, `web-backend/src/fork/grid.py` |
| 6.2 | Only lines of 110 kV and more for routes. | ✅ |
| 6.3 | Stations only on lower voltages (wind parks, biogas on a 65 kV line) connect over those lines to the 110 kV+ grid; a station that isn't connected because data is missing (e.g. Germany outside the region) is fine. | ✅ |
| 6.4 | A route is drawn as one line (no different line styles at substations); lines through a station's outline are drawn. | ✅ |
| 6.5 | The panel lists what the route goes through: each stretch with its distance, and a total. | ✅ |
| 6.6 | Highlight a power line when selected to see where it goes. | ✅ |
| 6.7 | Works on a country the size of France. | ✅ (build ~2 min) |
| 6.8 | A selected line follows only the line it is (its name, circuit number, way), not lines branching off or sharing pylons; on a way with two voltages only its own circuit is highlighted; it's drawn into the substations. | ✅ `web-backend/src/fork/line_trace.py` |
| 6.9 | Large lines should end at something; where they don't, list them as probable data errors. | ✅ `grid_check.py` → `data/grid-check.csv` (asked 2026-10-31) |
| 6.10 | A circuit opened from a substation's details shows below them, the details staying open (shrunk if needed), not at the bottom right. | ✅ `fork/modules/details/circuit.ts` (asked 2026-10-31) |
| 6.11 | Towers numbered along their line ("tower 23 of 61 on A – B, counted from A"): in a tower's details, as its label from zoom 16 when it has no ref, and found by the search ("23 marlenheim"). | ✅ `web-backend/src/fork/tower_numbers.py`, `fork/modules/grid/towers.ts` (asked 2026-10-31) |
| 6.12 | Routes change voltage only at stations (not at a pylon), and a way with two voltages carries each. | ✅ `grid.py` (2026-10-31) |
| 6.13 | A tower keeps the same number at every rebuild or renumbering (usable as a lasting reference). A tower added later between two gets a letter ("23a"). | ✅ register in `userdata` (`tower_numbers.py`) |
| 6.14 | A tower's label is just its number, not a long ref ("…- Pylône N°44" → "44"). | ✅ (asked 2026-10-31) |

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
| 8.1 | Layers for infrastructure people tend to miss: airports, ports, military bases, data centres, food depots, health and emergency, government (mairie, trésorerie, CAF...), places of worship with an icon per religion, fuel and weapons, transport hubs, dams, landfills, weather stations... | ✅ `imposm/sites.py`, `schema/sites.sql`, `fork/modules/sites/` |
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
| 9.6 | ODIN's "actions": tactical graphics (axes of advance, attack directions, boundaries, phase lines, task symbols...). Use mil-sym-ts if it covers them, else write our own inspired by ODIN. | ✅ mil-sym-ts (`fork/modules/userlayers/map/graphics.ts`); 197 point + 212 line/area graphics |
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
| 9.17 | Polish the list (2026-11-05): folder lock only on your layers; folder buttons off while a situation is shown; singular counts; search layers and folders by name; reorder layers by dragging (drawing order follows); names typed in place; zoom to a layer; drop zone only while dragging; long layers show 200 items first; keyboard. | ✅ |
| 9.18 | Polish drawing on the map (2026-11-05): a line to the cursor while drawing; a faint preview while placing; the same hints for every tool; labels "Marker", "Line", "Area"...; the card's picture for every item; Lock in the right-click menu. | ✅ |
| 9.19 | A graphic being drawn (an arrow...) previewed as it will look, faint, like a symbol being placed; right-click opens only the quick-actions menu, not the card. | ✅ (2026-11-05) |
| 9.20 | Shift + scroll while placing: the item's size (an arrow being drawn: its width) instead of zooming; the same on a selected item. | ✅ (2026-11-05) |
| 9.21 | The selection shows the item itself: a graphic, range rings or a measurement glow under their own lines, a picture or symbol gets a box fitting its image; one handle colour; items move as they're dragged, a line, area or graphic dragged by its body moves whole. | ✅ (2026-11-05) |
| 9.22 | One look app-wide for what's chosen or on (chips, tools, selected rows): a highlighted background, the border unchanged (`oim-on`). | ✅ (2026-11-05) |
| 9.23 | A copied feature stays visible when zoomed out, even where the original thins out. | ✅ (2026-11-05) |
| 9.24 | A click on a feature's status outline (e.g. a substation drawn as a point when zoomed out, or its layer off: switched on) selects the feature; the coordinates next to the scale. | ✅ (2026-11-05) |
| 9.25 | Three-point graphics square where the standard draws them so (Contain, Block, Clear, Breach, Bypass, Canalize, Penetrate, Disrupt, Ambush, Attack by fire position). | ✅ (2026-11-05) |
| 9.26 | Plain labels on tactical graphics for untrained users: one letter only for the most common (B Block…), short words in full, longer ones shortened (CATK), several words as initials (WUP), French built the same way (RSP); the full name in the legend. | ✅ `userlayers/map/graphic-labels.ts`, plan `docs/plans/graphic-labels.md` (2026-11-05) |
| 9.27 | One picker entry per graphic with a switch between its versions: Block/Disrupt/Fix task or obstacle effect; Main/Supporting attack, Aviation: axis of advance or direction of attack. One Engagement area. Rectangular fire areas removed (the irregular draw rectangles). | ✅ (2026-11-06); PAA: see 9.28 |
| 9.28 | Position area for artillery (PAA) back, drawn point by point like the other areas. | ✅ 2525D's irregular PAA, under our code G*F*ACPI (2525C has only a rectangle or a circle) (2026-11-06) |
| 9.29 | Rework how graphics with two versions are listed and named (backlog). Block, Disrupt, Fix exist as a task and as an obstacle ("obstacle effect"; Turn is one too); Main/Supporting attack and Aviation as an axis of advance or a direction of attack. Ideas: one "Obstacle" entry with its effect chosen on the card (Block / Disrupt / Fix / Turn), or names by effect ("Obstacle: block"…); a well-named list rather than hiding entries. Now: both versions listed, a switch on the card. | 📝 backlog (2026-11-06) |
| 9.30 | Satellite download menu easy to read (what each zoom shows, sizes, free space); aerial photos made more detailed later without downloading again what's there. | ✅ (2026-11-06) |
| 9.37 | Sentinel-2 imagery shown from lower zooms (from 5, where it's better than Blue Marble); already downloaded files get their lower zooms without downloading again. | ✅ (2026-11-06) |
| 9.38 | The satellite downloads run at the same time, not one after another. | ✅ (2026-11-06) |
| 9.31 | Downloads survive losing the internet: wait for the connection, go on when it's back, stop cleanly (keeping what's downloaded) if it doesn't come back or the download hangs. Every download (OSM extract, background map, satellite imagery, extra data, Wikidata cache) through one safe function. | ✅ (2026-11-06) `lib/net.sh`, `netsafe.py` |
| 9.32 | My layers' panel cleaner: as tall as its content (scrolls only when the column is full); situation, ⚙ and × in the header; one Filter button instead of the chips; new layer, folder, import, export in a footer; a layer's and a folder's actions in a right-click menu; an eye to show / hide. | ✅ (2026-11-06) |
| 9.33 | No colour per layer: what has no colour of its own is black; the colour new items get is chosen in My layers' settings. | ✅ (2026-11-06) |
| 9.35 | A layer's items sorted into groups that fold (by side: friendly units and graphics, hostile units and graphics, others; measurements, drawings and markers, pictures, copies); inside a group the same shapes and types together (arrows, lines, areas; then by type, then name), planned at the end. No hiding parts of a layer: a layer is hidden whole or not at all. | ✅ (2026-11-06) |
| 9.36 | In the list, Ctrl-click adds an item to the selection; Shift-click selects everything between what's selected and the click. | ✅ (2026-11-06) |
| 9.34 | Situations reworked so the history of all changes is kept (no deleting; a save makes one?); layers can be hidden while going through the history. To be discussed first. | backlog |

## 12. Feature status and "what if" (docs/plans/feature-status.md)

| # | Requirement | Status |
|---|---|---|
| 12.1 | A status on map features (power lines, substations, transformers, hospitals, places of worship, supermarkets, convenience stores...), separate from My layers' military symbols: operational, repaired, threatened, suspected damage, damaged, destroyed, under repair, unknown. Only problems shown on the map, with a colour and/or badge next to the item. | ✅ step 1: set in a feature's details, history, on the map (`fork/modules/status/`, `userdata/status.py`) |
| 12.2 | Extra fields by kind, e.g. how full stores are (stock level); several features at once (Shift-click); convenience stores as critical sites. | ✅ step 2 (`fork/modules/status/`; convenience stores from the next rebuild) |
| 12.3 | Power supply mode (a toggle): the grid coloured green (normal), orange/yellow (less power), red (none), from the statuses; also on power lines and transformers copied into My layers (normal look when the mode is off). Lines leaving or entering the region count as sources. | ✅ step 4: red and orange from the statuses, grey for what isn't connected in the data, copies in My layers (`grid_supply.py`, `fork/modules/status/supply.ts`); scenarios not yet |
| 12.3b | Show the substations and lines connected to nothing (no source even with nothing lost) in a different colour. | ✅ grey in power supply mode (asked 2026-10-31) |
| 12.4 | A status history of its own, independent of My layers' history, that can be played back. | ✅ per feature, and played back on the Status board (step 3: list, counts, filters, search by status) |
| 12.5 | Detailed substation model (voltage levels, transformers). | ❌ dropped (2026-10-31) |

## 10. Backlog (parked)

| # | Item | Status |
|---|---|---|
| 10.1 | Wikipedia and GEM wiki links in popups open offline (cached pages; Kiwix, GEM bulk download looked into). | 🗂 |
| 10.2 | Military grid coordinates (MGRS) under the cursor and in search; range rings; distance/area measuring. | ✅ `fork/modules/measure/` (2026-11-01) |
| 10.3 | Terrain: hillshading and line of sight (Copernicus 30 m elevation, offline). | 🗂 |
| 10.4 | Grid what-if: what loses its connection if a substation is hit. | ➡ now 12.3 |
| 10.5 | Time on items: valid from/to and a timeline slider. | 🗂 |
| 10.6 | Users: a login page, user accounts (local only), access control per user (view the map; read or write each layer). The whole app behind login; admins create the accounts. | ✅ accounts, login and the gate (every call needs a session); owners and sharing per layer (view, modify) (2026-11-01, `docs/plans/sync.md`) |
| 10.6c | HTTPS without a certificate signed by anyone else. | ✅ the gate makes its own (self-signed, the browser warns once) (2026-11-01) |
| 10.6b | Auto sync of My layers between users: layers update by themselves; edits sent with Save; field-by-field merge; conflicts one by one in a window that can be minimised (your version shown meanwhile), Save blocked until resolved; owners share layers to view or modify; a situation is only seen by those who can view all its layers. | ✅ sharing (view, modify), versions, field-by-field merge, the conflict window, live updates, per-user settings (folder, hidden, folded) (2026-11-01) |
| 10.2c | Measurements are My layers items (saved, shared, lockable), made with tools in the layer toolbar; editable after placing, and lockable; marks along distances like a ruler (labelled, e.g. "5 km"), finer when zoomed in (down to 10 m), never a mass of tiny marks when zoomed out. | ✅ `userlayers/kinds/measure.ts`, `measure/ticks.ts` (2026-11-03) |
| 10.2d | Measuring, refined: marks on the line at any zoom, one plain mark between labelled ones on full values, a mark at the start, "18 km 450 m" when zoomed in and whole km when not, no marks while drawing or when zoomed far out; labels along the line beside it; each leg's length editable on the card; points moved, not added. | ✅ (2026-11-03) |
| 10.2e | Areas can't be drawn crossing themselves. | ✅ `model/shapes.ts` (2026-11-03) |
| 10.2f | Zoomed out, a leg shows only its length when its label doesn't fit; marks follow one rule, like a ruler: the smallest round step (1, 2, 5 × 10ⁿ) whose labels land at least 60 px apart, so 60–150 px at every zoom; none only on a measurement shorter than two steps (2026-11-06; replaces "at least four labelled steps"); clicking an area's first point closes it. | ✅ (2026-11-03) |
| 10.2g | Range rings zoomed out: only the rings big enough to see are labelled, and small on screen one label with the diameter ("Ø 20 km"); an area's new point can't be put on top of another (a minimum separation; dragging one close is fine). | ✅ (2026-11-03) |
| 10.6d | The "draw into" layer and favourite (and recent) symbols follow the account, like folders. | ✅ `state/personal.ts` (2026-11-01) |
| 10.2b | Measured bearings from true, magnetic (compass) or grid (MGRS) north, chosen. | ✅ `userlayers/measure/north.ts` (2026-11-02; per account since 2026-11-03) |
| 10.7b | Unsaved changes kept in the browser whatever their size (big imports), with a warning if they can't be. | ✅ IndexedDB (`state/local.ts`) (2026-11-02) |
| 10.7 | Import/export GeoJSON, KML, GPX; print a PDF with a legend. | ✅ My layers' Import / Export (`userlayers/io/`), "print" in the header (`fork/modules/print/`) (2026-11-01) |
| 10.7c | The printed map fills the page (margins only what printers need), the legend in the room left: a box over the map's corner; a frame on screen shows what's printed. | ✅ (2026-11-05) |
| 10.7d | The printed legend explains what's on the page: the key's rows for the infrastructure there; My layers by layer name, each item with its own picture (graphics drawn small). | ✅ (2026-11-05) |
| 10.8 | Power supply scenarios: "what if these were lost?" without setting real statuses. | 🗂 (parked 2026-10-31) |
| 10.9 | Buildings: show building outlines on the map (a layer to switch on); copy chosen buildings' outlines into My layers. | 🗂 (asked 2026-11-05) |

## 11. Quality

| # | Requirement | Status |
|---|---|---|
| 11.1 | Unit tests for the fork's code (frontend: Vitest; backend: pytest), where they make sense. | ✅ 321 frontend (`npm run test:fork`), 19 backend (`tests/fork/`), 77 scripts (`scripts/tests/`) |
| 11.2 | Tests for the setup scripts. | ✅ the scripts run in a sandbox with fake Docker/network (options, refusals, safety rules); a real Luxembourg build, export and import in a separate test database (opt-in) |
| 11.6 | Dead code removed: features replaced or dropped (the typed author name, layer colours, ⋯ menus, unused strings, styles and helpers). | ✅ (2026-11-06) |
| 11.5 | The setup scripts easier to read: repeated code made into shared functions (menus, disk space, titles, JSON files, replacing the database), the build script's steps each doing one thing, its shared variables listed and explained at the top. | ✅ (2026-11-06) |
| 11.4 | The code tidied: no repeated logic (shared helpers in one place), long files and functions split, each file's types and constants in small files of their own (`X.types.ts`, `X.constants.ts`); exact values locked by tests first so nothing changes. | ✅ (2026-11-06) |
| 11.3 | Easy to extend without changing the structure ("modding"): a map mode interface, My layers' item kinds as a registry, the measure and print files split. | ✅ `services/map-mode.ts`, `userlayers/kinds/`, recipes in `docs/ARCHITECTURE.md` (2026-11-02) |
