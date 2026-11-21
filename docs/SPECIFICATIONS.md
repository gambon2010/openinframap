# Specifications

Everything the project owner has asked for, in one place, from the first session
(2026-10-14) on. Each item says what was asked, its status and where it lives.
**Keep this file up to date:** add new requests here when they're made, and change
the status when they're done.

Status: ✅ done · 🚧 in progress · 📋 planned (plan written) · 🗂 backlog (parked,
don't start unprompted) · ✖ dropped or replaced

How the work is organised: [FORK_ARCHITECTURE.md](./FORK_ARCHITECTURE.md) (the code),
[HISTORY.md](./HISTORY.md) (what changed and why), [FORK_CHANGES.md](./FORK_CHANGES.md)
(upstream's files the fork changes), [LOCAL_DEVELOPMENT.md](./LOCAL_DEVELOPMENT.md) (user guide), `docs/plans/`
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
| 1.6 | Docs explain what was done and why; the GitHub page (README) describes the fork. | ✅ ARCHITECTURE, HISTORY, FORK_CHANGES, LOCAL_DEVELOPMENT, README |
| 1.7 | One place with all the specifications (this file). | ✅ |
| 1.8 | Unit tests for the fork's code where they make sense; not for upstream's code unless needed. | ✅ |
| 1.9 | Licences: don't copy code whose licence would change the project's (e.g. ODIN is AGPL). | ✅ (rule followed) |

## 2. Setup, building and sharing data

| # | Requirement | Status |
|---|---|---|
| 2.1 | Interactive script that builds the data for a chosen region (continents, countries, sub-regions from Geofabrik). | ✅ `scripts/build-region.sh` |
| 2.2 | An option for the whole world, with a warning that it takes long. | ✅ |
| 2.3 | Keep downloads and show which files are already present; don't re-download (e.g. Russia). Keep a log of builds. | ✅ `data/downloads/osm/`, build log |
| 2.4 | EEZ boundaries: explain them; ask the user to download them (with the link) or skip; show progress so the script never looks frozen. | ✅ |
| 2.5 | At the end, offer to fill the Wikidata image cache, warning it can take long and naming the script to run later. | ✅ `scripts/fetch_images.py` |
| 2.6 | Offer to start the frontend/backend in a new terminal window; open the browser on the map when ready. | ✅ `start_app`, `open_in_terminal` |
| 2.7 | `launch.sh` (first time, everything) and a no-questions daily start. | ✅ `launch.sh`, `start.sh` |
| 2.8 | Export / import a built database to share the project without internet (copy to a flash drive). Exports found by the build script replace the matching menu entry ("import Russia"). | ✅ `export-db.sh`, `import-db.sh`, `data/map/exports/*.oimdb` |
| 2.9 | Backend in Docker so the project is easy to copy. | ✅ Compose service `backend` |
| 2.10 | Build performance: per-country stats fast for big countries. | ✅ `schema/fork/local-stats.sql` |
| 2.11 | Extra data (not from OSM) is offered in the build script for the regions it covers (e.g. France or a French sub-region), and is included in export/import. | ✅ |
| 2.12 | Rebuilding the OSM data must not delete the extra data (it's slow to download): keep it, and keep the raw downloads to rebuild from. | ✅ `data/downloads/extra/` |
| 2.13 | List the dependencies needed to run the project from nothing. | ✅ LOCAL_DEVELOPMENT "Prerequisites" |
| 2.14 | Rebuilds and imports keep My layers (they belong to the computer). | ✅ |
| 2.15 | Should the setup scripts have tests? (asked 2026-10-30) | ✅ yes: every setup script and Python tool is tested (11.2), the last ones added 2026-11-07 (`number-towers.sh`, `fetch_images.py`) |
| 2.16 | Re-export a region's ready-made export by default when it's out of date (no question). | ✅ `reexport_if_outdated` in `build-region.sh` and `start.sh` |

## 3. Background map and map sources

| # | Requirement | Status |
|---|---|---|
| 3.1 | Don't host background tiles by default: use the online default, or let the user configure a local server. | ✅ (then extended by 3.3) |
| 3.2 | A place in the UI to see and change the tile server URL, with an explanation of how to change the default in the config; the change lasts for the session only. | ✅ now in **Settings** |
| 3.3 | Fully offline needs a local background map: build-script option to download one (full or reduced detail) for the region. | ✅ Protomaps extract, `basemap` service |
| 3.4 | Night lights layer: disabled (online only, broke the map). | ✅ hidden |
| 3.5 | Future: one command that sets up local tile server + local geocoder; priority local from config, fall back to online defaults, UI override showing the URL in use. | ✅ partly (local basemap, Photon optional); single command for Photon not done |
| 3.6 | Satellite imagery as a build-script option: NASA Blue Marble for zoom 0–8, intermediate zooms from 10 m imagery, optional high resolution; offline. | ✅ `scripts/offline-maps.py`, `fork/modules/satellite/`; Settings → Background |
| 3.7 | Download satellite imagery for the region already built without losing the data (no rebuild). | ✅ `scripts/offline-maps.sh` |
| 3.8 | Blue Marble for the whole world by default; a menu that explains each choice. | ✅ one shared `world.sat-overview.pmtiles` (~330 MB) |
| 3.9 | Sentinel-2 for other countries or the whole world; high-resolution photos for more countries than France. | ✅ the offline maps menu (`offline-maps.py maps`), `offline_maps/sources/` (14 aerial sources, 10 countries); the world end to end not run (too big to test) |

## 4. Search

| # | Requirement | Status |
|---|---|---|
| 4.1 | Search works on localhost. | ✅ |
| 4.2 | "vianden" finds "Centrale de Vianden" (words inside names). | ✅ |
| 4.3 | Offline place search (cities, towns, villages, hamlets, neighbourhoods) from the local database; OpenCage removed. | ✅ |
| 4.4 | Optional Photon server for addresses, configurable in the map sources; not installed by the scripts. | ✅ |
| 4.5 | Everything with a name is searchable (critical sites, lines, telecoms, pipelines, water, extra data...). | ✅ `schema/fork/search.sql` |
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
| 5.17 | The layer list and the key merged into one panel, Data layers: each category unfolds to its key with a tick box per row; statuses only as a key (no tick boxes); background stays in Settings. | ✅ (2026-11-06) |
| 5.18 | Open data not split from OSM data in Data layers: the distribution network with Power, the gas network with Oil & gas, ICPE under Critical sites. | ✅ (2026-11-06) |
| 5.19 | The background map's colours: still pale and washed out, but each kind of area (fields, grass, woods, housing, industry, hospitals, water) its own shade, so where each stops shows. | ✅ (2026-11-06) |
| 5.20 | Buildings a little darker and airports their own shade; Settings → Background offers the map in high contrast (default) or in its original colours, or satellite imagery. | ✅ (2026-11-06); original colours removed (2026-11-17, 10.18) |
| 5.21 | A server that stops answering while the internet works (IGN's anti-bot block) is said so and the download stops at once, instead of 15 min of "waiting for the connection"; the download lines stay one line each. | ✅ (2026-11-06) |
| 5.22 | France's aerial photos from IGN's BD ORTHO files (per département, chosen in the menu, up to zoom 19), not IGN's tile server (which blocks bulk downloads); the tile download from IGN removed. | 🔄 (2026-11-06: code done, Bas-Rhin test running) |
| 5.23 | No "find my location" button on the map. | ✅ (2026-11-06) |
| 5.24 | In high contrast, roads visible over towns (white with a grey edge; footpaths grey). | ✅ (2026-11-06) |
| 5.25 | Aerial photos shown from zoom 12 (were 14); files made before get the lower zooms without downloading. | ✅ (2026-11-06) |
| 5.27 | A download speed cap for IGN's photos (e.g. 10 MB/s, all parts together). | ✅ (2026-11-11) |
| 5.28 | Offline maps as one clear menu (docs/plans/offline-maps.md): sources as files, an inventory of what is there, no pointless offers (coverage rules), short screens; Blue Marble and Sentinel-2 at their most or nothing, aerial photos from zoom 17. | ✅ (2026-11-11; each download shows its own progress: fine as it is; newer IGN editions: 10.13) |
| 5.29 | Only local tiles: no online background map (openinframap.org) as default or fallback; no night lights, no Osmose validation layer; several background map areas shown at once (served by the backend, first file that has the tile), full detail only, the build's own background map question folded into the offline maps menu. | ✅ (2026-11-11: night lights and the infrastructure fallback removed; the background map served by the backend, several areas at once; the `basemap` service renamed `satellite`; the background map chosen in the offline maps menu, full detail, editions shown; no online background map: the default is the backend's; France's downloaded, 5.4 GB) |

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
| 6.9 | Large lines should end at something; where they don't, list them as probable data errors. | ✅ `grid_check.py` → `data/local/grid-check.csv` (asked 2026-10-31) |
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
| 7.10 | FINESS health establishments, fuel stations (after the OSM equivalents). | 🗂 |

## 8. Critical sites (from OpenStreetMap)

| # | Requirement | Status |
|---|---|---|
| 8.1 | Layers for infrastructure people tend to miss: airports, ports, military bases, data centres, food depots, health and emergency, government (mairie, trésorerie, CAF...), places of worship with an icon per religion, fuel and weapons, transport hubs, dams, landfills, weather stations... | ✅ `imposm/sites.py`, `schema/fork/sites.sql`, `fork/modules/sites/` |
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
| 9.29 | Rework how graphics with two versions are listed and named (backlog). Block, Disrupt, Fix exist as a task and as an obstacle ("obstacle effect"; Turn is one too); Main/Supporting attack and Aviation as an axis of advance or a direction of attack. Ideas: one "Obstacle" entry with its effect chosen on the card (Block / Disrupt / Fix / Turn), or names by effect ("Obstacle: block"…); a well-named list rather than hiding entries. Now: both versions listed, a switch on the card. | ✅ (2026-11-06) one row per type in the picker (the first version, found by either name, with its versions noted); the card switches |
| 9.30 | Satellite download menu easy to read (what each zoom shows, sizes, free space); aerial photos made more detailed later without downloading again what's there. | ✅ (2026-11-06) |
| 9.37 | Sentinel-2 imagery shown from lower zooms: from zoom 7 for every area (5 first, then 7: at 5 a country is a few dozen pixels); already downloaded files get their lower zooms without downloading again. | ✅ (2026-11-06) |
| 9.38 | The satellite downloads run at the same time, not one after another. | ✅ (2026-11-06) |
| 9.31 | Downloads survive losing the internet: wait for the connection, go on when it's back, stop cleanly (keeping what's downloaded) if it doesn't come back or the download hangs. Every download (OSM extract, background map, satellite imagery, extra data, Wikidata cache) through one safe function. | ✅ (2026-11-06) `lib/net.sh`, `netsafe.py` |
| 9.32 | My layers' panel cleaner: as tall as its content (scrolls only when the column is full); situation, ⚙ and × in the header; one Filter button instead of the chips; new layer, folder, import, export in a footer; a layer's and a folder's actions in a right-click menu; an eye to show / hide. | ✅ (2026-11-06) |
| 9.33 | No colour per layer: what has no colour of its own is black; the colour new items get is chosen in My layers' settings. | ✅ (2026-11-06) |
| 9.35 | A layer's items sorted into groups that fold (by side: friendly units and graphics, hostile units and graphics, others; measurements, drawings and markers, pictures, copies); inside a group the same shapes and types together (arrows, lines, areas; then by type, then name), planned at the end. No hiding parts of a layer: a layer is hidden whole or not at all. | ✅ (2026-11-06) |
| 9.36 | In the list, Ctrl-click adds an item to the selection; Shift-click selects everything between what's selected and the click. | ✅ (2026-11-06) |
| 9.34 | Situations reworked so the history of all changes is kept (no deleting; a save makes one?); layers can be hidden while going through the history. To be discussed first. | backlog |

## 12. Feature status and "what if" (docs/plans/feature-status.md): removed 2026-11-06

| # | Requirement | Status |
|---|---|---|
| 12.1 | A status on map features (power lines, substations, transformers, hospitals, places of worship, supermarkets, convenience stores...), separate from My layers' military symbols: operational, repaired, threatened, suspected damage, damaged, destroyed, under repair, unknown. Only problems shown on the map, with a colour and/or badge next to the item. | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |
| 12.2 | Extra fields by kind, e.g. how full stores are (stock level); several features at once (Shift-click); convenience stores as critical sites. | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |
| 12.3 | Power supply mode (a toggle): the grid coloured green (normal), orange/yellow (less power), red (none), from the statuses; also on power lines and transformers copied into My layers (normal look when the mode is off). Lines leaving or entering the region count as sources. | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |
| 12.3b | Show the substations and lines connected to nothing (no source even with nothing lost) in a different colour. | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |
| 12.4 | A status history of its own, independent of My layers' history, that can be played back. | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |
| 12.5 | Detailed substation model (voltage levels, transformers). | ❌ removed (2026-11-06: the whole status system, to be rebuilt simpler later) |

## 10. Backlog (parked)

| # | Item | Status |
|---|---|---|
| 10.1 | Wikipedia and GEM wiki links in popups open offline (cached pages; Kiwix, GEM bulk download looked into). | 🗂 |
| 10.2 | Military grid coordinates (MGRS) under the cursor and in search; range rings; distance/area measuring. | ✅ `fork/modules/measure/` (2026-11-01) |
| 10.3 | Terrain: hillshading and line of sight (Copernicus 30 m elevation, offline). | 🗂 |
| 10.4 | Grid what-if: what loses its connection if a substation is hit. | ➡ now 12.3 |
| 10.5 | Time on items: valid from/to and a timeline slider. | 🗂 |
| 10.6 | Users: a login page, user accounts (local only), access control per user (view the map; read or write each layer). The whole app behind login; admins create the accounts. | ✅ accounts, login and the gate (every call needs a session); owners and sharing per layer (view, modify) (2026-11-01, `docs/plans/archive/sync.md`) |
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
| 10.9 | Buildings: show building outlines on the map (a layer to switch on); copy chosen buildings' outlines into My layers. | ✅ `fork/modules/buildings/`: every building from zoom 15, the big ones from 12 inside the background map's tiles (`<area>.buildings.pmtiles`, made after each download, appended by the backend; 2026-11-16); clickable inside, details, copied as areas (copy tool or the details' button); over imagery filled like roofs with a small shadow, dark outlines (2026-11-16; white outlines before) |
| 10.11 | Feature statuses as layer information (a side's or team's own assessment), not one global state. The old status system was removed (2026-11-06); something simpler is to be designed and rebuilt. | 🗂 (asked 2026-11-06) |
| 10.12 | Critical infrastructure people tend to miss, as map layers: airports, ports, military sites, food (distribution centres, wholesale markets, silos), health and emergency (hospitals, fire, ambulance, police), fuel depots and storage tanks, transport chokepoints (bridges, tunnels, rail yards, container terminals), digital (IXPs, satellite ground stations), dams, wastewater plants, landfills. From OSM (new imposm mapping, rebuild) and open data (extra data). Not HTA/BT poles. See also 7.10, 8.6. | 🗂 (asked 2026-10-15; listed 2026-11-11) |
| 10.13 | Far off: update aerial photos when IGN publishes a newer edition of a département (every ~3 years): only those, replaced when done. Editions are recorded from 2026-11-11. | 🗂 far off (2026-11-11) |
| 10.14 | The whole world's background map zoomed out (to zoom 8, 560 MB), so every country's borders and names show over imagery. | ✅ (2026-11-11) |
| 10.15 | Satellite with roads easy to read: roads at their real size coloured by importance (motorways orange, main roads yellow, smaller white) with a dark edge, railways highlighted, tunnels marked differently (not hidden), the lines fading when zoomed right in, street names white on a dark halo; small roads and paths as a thin dark line zoomed out; borders more visible. | ✅ (2026-11-16) `fork/modules/roads/` |
| 10.16 | 3D buildings: a 3D view where the map can be tilted and turned and buildings rise to their height; big buildings selected whole (not the piece in one tile). | ✅ (2026-11-16) `fork/modules/view3d/`, `modules/buildings/look.ts`; buildings with parts: the parts raised, not the building (`parts.ts`); the selection joined from the loaded tiles |
| 10.17 | Roads and railways the same at each zoom over the map and over imagery; small roads, paths and railways from further out (long-distance railways like motorways, smaller like main roads); tunnels marked at every zoom. | 🚧 (2026-11-16, `docs/plans/roads-and-railways.md`) steps 1 and 3 done (one set of roads; roads zoomed out), step 2 (2026-11-17): railways ranked from OpenStreetMap in the zoomed out file, close tracks and a motorway's carriageways drawn as one |
| 10.18 | Trams drawn differently from railways; one satellite choice, one map (the high contrast one: no original colours); bold roads, railways and trams as Data layers entries (off at first) switched alone or as a group, replacing the map's light ones where ticked, the only ones over imagery; Railways (Trams and metro) unticked shows the map's own railways (trams), not a light version. | ✅ (2026-11-17) `fork/modules/roads/`, group tick boxes in `ui/data-layers.ts` |
| 10.19 | Each tram and metro line its own colour (its route's, else one picked by its letter or number: line A the same everywhere), lines sharing a track side by side and joined through junctions, each in its lane; one line for both tracks; metro and light rail with the trams (*Trams and metro*). | ✅ (2026-11-17) LOOM (tools/loom, `loom_input.py`, `loom_tiles.py`, `lane-layers.ts`): 88 of France's 91 lines drawn (not: Rhônexpress, T12, a heritage horse tram) |
| 10.20 | Narrow-gauge, heritage and funicular railways: today ranked minor (from zoom 11), so a long narrow-gauge line with passenger trains (Train Jaune, Chemins de fer de Provence) shows late. Options: those with passenger service as branch lines (from zoom 8); tourist and heritage lines their own look (thinner, another dash). | 🗂 (2026-11-17) |
| 10.21 | Roads by importance: trunk roads (voies express) amber, between motorways and primary roads; secondary pale yellow, tertiary white; zoomed out, secondary roads from zoom 10 and tertiary from 11 (zoom 9 was a web of yellow). | 🚧 (2026-11-17) colours done; the zooms show once the zoomed out file is made again |
| 10.22 | Roads, railways and trams: each entry unfolds to its kinds (motorways, trunk, main, secondary... main lines, branch lines... trams, metro, light rail), each switched alone; sidings, yards and depots off at first. Over the map without the bold entries, roads as before: white with a grey edge, at the same zooms and widths (the map's own were wider, with a faint edge, heavy at airports). Twin tram tunnels as one line; tracks cut where they ran beside another joined back to it (no gaps). | 🚧 (2026-11-17) the app's part done; the tunnels and gaps show once the zoomed out file is made again |
| 10.23 | Roads drawn cleanly zoomed out, as established tools do (Planetiler): no home-made carriageway merging; round ends; tunnels dotted (no transparency); roads near a border not lost past the area. | 🚧 (2026-11-17) made; shows once the zoomed out file is made again |
| 10.24 | Clicking a road shows its information (name, number such as A35, European number) at every zoom, zoomed out too. | ✅ (2026-11-17) `zoomed_roads.py` KEPT; needs the zoomed-out tiles rebuilt |
| 10.25 | Trams and metro: tunnels at the same level as the lines above ground, a full outline around a see-through line; junctions clean at every zoom (no outlines across the lanes). | ✅ (2026-11-17) `lane-layers.ts` |
| 10.26 | Clicking a tram or metro line highlights the whole line on the map. | ✅ (2026-11-17) `modules/roads/lane-highlight.ts`, from zoom 12 (LOOM's lanes) |
| 10.27 | A highlighted tram or metro line shows its stops. | ✅ (2026-11-17) `line_stops.py` (the routes' stops, else platforms; a stop's positions within 200 m one), `lane-highlight.ts` (each named, smaller zoomed out) |
| 10.28 | Details of a clicked road, railway, tram or metro line: a title a person would use ("A35 – Autoroute des Cigognes", "D392 – Route de Schirmeck", "Tram F") and the copy button, nothing else; a building without its data source note; every raw property only with debug on, marked "Debug info". | ✅ (2026-11-17) `modules/roads/popup.ts`, `modules/debug` |
| 10.29 | Trams and metro in tunnels drawn see-through at every zoom (zoomed out only some lanes were). | ✅ (2026-11-17) `loom_tiles.py`: tunnels widened per zoom as far as a bundle of lanes spreads |
| 10.30 | Airports: the stand lead-in hooks (Entzheim) not drawn; the named taxiways, the stand spokes and the corners kept. | ✅ (2026-11-17) `stand_lead_ins.py`: untagged taxiway runs under 150 m with a free end, from `<area>.taxiways.osm.pbf`; checked against upstream's map (94 of the 105 pieces it lacks gone, nothing it has); the source fix (retagging them `aeroway=taxilane` in OpenStreetMap) is the owner's |
| 10.31 | Map or satellite as a toggle among the map's buttons, not a setting; the buttons reorganised in groups; Data layers and My layers icons clearly different (no red dot). | ✅ (2026-11-17) `modules/background` (satellite button), `ui/icons.ts`, `ui/panel.css` (order) |
| 10.32 | Trams and metro drawn at every zoom (they vanished just below 12, where some tiles were). | ✅ (2026-11-18) hand-over at 11.5 (`LANES_SHOWN_FROM`) |
| 10.33 | Critical sites: gun shops removed (OpenStreetMap's data on them is poor); the category is *Fuel*. | ✅ (2026-11-18) `sites.sql`, `imposm/sites.py`, `modules/sites` |
| 10.34 | Grouped markers follow the key: a hidden kind isn't counted, a group of hidden kinds goes; a kind's lone site in a group's place shows as itself. | ✅ (2026-11-18) `site_points` (counts per kind, groups of two or more of a kind), `ui/key/counted-groups.ts` |
| 10.35 | "View on OpenStreetMap" only with debug on. | ✅ (2026-11-18) `ui/details.css`, `modules/debug` |
| 10.36 | Every data layer fading in and out when switched, as the roads do. | ✅ (2026-11-18) `ui/fade.ts` (the layer switcher's visibility through a fade; the roads fade on their own) |
| 10.37 | A site in two data layers (an oil depot in Oil & Natural Gas and in Critical sites) drawn once; Oil & Natural Gas's facilities in the fuel colour, with the depot icon zoomed out. | ✅ (2026-11-18) `sites.sql` (fuel depots inside or the same as a petroleum site left out: 1,408 → 755), `modules/sites/petroleum.ts`, tegola `petroleum_facility` (766 facilities, the pipelines' substations aside); the key row replaced (`KeySection.replaces`) |
| 10.38 | No gaps when a data layer hands over to another while zooming; tests to keep it so. | ✅ (2026-11-18) `core/tile-zooms.ts`: buildings at 14.5 (were missing from 14.5 to 15), trams at 11.5; upstream's power line labels moved by `modules/handovers`; `handovers.test.ts` |
| 10.39 | Critical sites' "Fuel depot, storage tank" is "Storage tank" with its own icon (depots are Oil & Natural Gas's); the oil and gas facilities' icon their own. | ✅ (2026-11-18) kind `storage_tank`, icons `site_storage_tank`, `site_oil_facility`; `industrial=fuel_depot/oil_storage` no longer imported as sites |
| 10.40 | "Not from OpenStreetMap" notes (where the data comes from) only in the debug info, in every panel. | ✅ (2026-11-18) `SOURCE_NOTE` (`ui/details.ts`), moved by `modules/debug` |
| 10.41 | Military: sub-categories; military areas (3,509) with their own key row and icon (they had none, and fell back to the government icon). Icons reworked: disused military a fort, supermarket a shopfront, courthouse scales. | ✅ (2026-11-18) kinds `military_area`, `_base`, `_office`, `_depot`, `_range`, `military` (other); `scripts/make_site_icons.py` |
| 10.42 | A Data layers entry shown in part (some key rows unticked) marked partial; ticking a row under an entry that's off turns the entry on. | ✅ (2026-11-18) `ui/data-layers.ts` (`entryTick`) |
| 10.43 | Police, gendarmerie, customs a category of their own (gendarmerie, national police, municipal police, force not given, customs, border posts); a gendarmerie compound mapped as a military area with its station inside one item; Government ochre, Police and gendarmerie navy. | ✅ (2026-11-18) `sites.sql` (`is_gendarmerie`, the compound merge: unnamed military areas under 5 ha with a gendarmerie station and no army site inside), grenade icon |
| 10.44 | Disused fortifications a row of Military (grey, unticked at first): bunkers (but inside an active military site), forts and historic sites (but showing use), named "Ancien...", tagged disused; site areas visible over imagery (an outline, more fill); prefecture and social icons; 3D gives back buildings switched off. | ✅ (2026-11-18) `is_disused_military`, `site_feature` (active-site checks), `modules/sites`, `modules/view3d` |
| 10.45 | Military sites sorted by their names too ("dépôt" a depot, "champ de tir" a range, an ouvrage a fort, "École nationale de police" police, a civilian "stand de tir" left out), with rules easy to extend and in other languages (German...); new kinds where the names call for them (forts, radar and radio stations, schools). | ✅ (2026-11-19) `schema/fork/site-rules.sql` (a row per kind and language), `military_kind` in `sites.sql` |
| 10.46 | A military site inside a larger one takes its kind when it says no more itself (the areas inside the Rozelier depot, an ouvrage's blocks); a generic area takes the kind of the more specific sites inside it. | ✅ (2026-11-19) `site_feature` (up, down) |
| 10.47 | Sites corrected by hand where OSM misleads (Forts de Nogent, Ivry, Portzic: in use, tagged historic), in a file that tracks them. | ✅ (2026-11-19) `schema/fork/site-overrides.sql` (OSM id, name, kind, date, why) |
| 10.48 | Disused military grouped apart from the military in use zoomed out, in grey discs; still a row of Military in Data layers. | ✅ (2026-11-19) `site_group` (`sites.sql`), `group_icon` (`modules/sites/style.ts`) |
| 10.49 | One thing mapped twice (same name, overlapping) drawn once, keeping the more specific kind. | ✅ (2026-11-19) `site_feature` (`twin`, `site_kind_says_little`) |
| 10.50 | Ambiguous military names checked against what the sites are (looked up): camps by size (training ground or garrison), schools before camps, DGA test centres ranges. | ✅ (2026-11-19) `site-rules.sql`, `site-overrides.sql` (Cercottes) |
| 10.51 | Military: a kind for research, test and weapons establishments (CEA, DGA test centres, ONERA, arms makers); disused fortifications stay disused inside an area that says no more; every remaining generic name looked up. | ✅ (2026-11-19) `military_research`, `site-rules.sql`, `site-overrides.sql` |
| 10.52 | Military bases split into air (airfields), naval and army; military airfields one row listed under both Transport and Military (one tick box), so neither menu forgets them; a civilian airport with a military part stays civil, the part in Military. | ✅ (2026-11-20) `military_airfield`, `military_naval_base` (`site-rules.sql`, `site_kind`), `shared_kinds` (`modules/sites/style.ts`), `showTicked` (`ui/key/toggles.ts`) |
| 10.53 | The generic military areas (493) looked into and classified where something says what they are (their tags, what stands inside, the sites they touch). | ✅ (2026-11-20) 316 left: `military_kind` (landuse's military=*), `site_feature` (by_tower, by_neighbour, by_ruins) |
| 10.54 | Disused aerodromes shown (military under Military, not hidden with the disused fortifications; civil with the airports), a grey icon, with no extra tick box: the two airfield rows show every airfield. | ✅ (2026-11-20) `military_airfield_disused` (`was_military_airfield`), `airport_disused`, shown by the airfield rows (`KEY_ROW_OF`, a hide spec of several icons) |
| 10.55 | What was left to clean in the sites: the air force units drawn twice on their air base, closed civil airfields drawn as airports, gendarmerie barracks drawn as army bases. | ✅ (2026-11-20) `part_of_airfield`, `airport_disused`, compounds named "Caserne ...", `part_of_gendarmerie`, `is_gendarmerie` |
| 10.56 | The military sites nothing classifies ("Other military area", 307 on 2026-11-20) checked by hand by the owner; verdicts into `site-overrides.sql`. | 🗂 backlog (2026-11-20) list: `data/local/checks/military-areas.csv` |
| 10.57 | Terrain: contour lines, hill shading, and the relief in the 3D view, offline. | ✅ (2026-11-20) download, hill shading, 3D relief, contour lines (supplementary, depressions, a tick box per part), heights and slope, line of sight: `docs/plans/terrain.md` |
| 10.58 | Signal propagation mode: how far a radio reaches given terrain and buildings. | 🗂 backlog (2026-11-20) after 10.57; what it needs: `docs/plans/terrain.md` "Next" |
| 10.59 | Reuse before writing: look up how open source projects do a known problem; use a package or plugin, else a larger project's method, before writing our own; list earlier parts that would benefit. | ✅ (2026-11-20) rule in `CLAUDE.md`; candidates: `docs/plans/reuse-review.md` |
| 10.60 | Large food and logistics depots missing from OpenStreetMap (Pro à Pro, Duppigheim): other sources. | 🗂 backlog (2026-11-20) the ICPE register (Géorisques: warehouses 1510, cold stores 1511, with volumes) and SIRENE (activity codes, geocoded), Overture Places elsewhere; Google's terms forbid it |
| 10.61 | The UI pieces not yet on the standard (STYLE.md) brought to it. | 📋 planned (2026-11-20) `docs/plans/ui-standard.md` |
| 10.62 | My layers' drawing and editing on the map by Terra Draw (a maintained library) instead of our own code. | 🗂 backlog (2026-11-20) prototype first: `docs/plans/reuse-review.md` |
| 10.63 | My layers' KML export by `@placemarkio/tokml` (the import's sister library) instead of KML written by our own code, keeping our extra details so files come back intact. | 🗂 backlog (2026-11-20) `docs/plans/reuse-review.md` |
| 10.64 | Sentinel-2 imagery kept up to date for a chosen area: newer images downloaded for it, and its history browsable (the same place at earlier dates). | 🗂 backlog (2026-11-20) |
| 10.65 | Satellite imagery found while the app runs (no frontend restart after a download). | ✅ the imagery list (`data/map/offline-maps/imagery.json`, the backend's `/imagery`) (2026-11-20) |
| 10.66 | The satellite imagery served by the backend, by a known good package (Protomaps' `pmtiles`), without the go-pmtiles server. | ✅ `/satellite`, `imagery.py`; measured as fast (2026-11-20) |
| 10.67 | The whole project on an external drive: on a Linux or Windows computer, install Docker, plug the drive in, run one script, and the app runs 100% offline, reading the maps from the drive (the Docker images and the map database loaded into Docker); pulling the drive out damages nothing. | 📋 planned (2026-11-20) `docs/plans/portable-drive.md` |
| 10.68 | My layers and accounts in a database of their own, so a map update never touches them. | ⏸ not needed (2026-11-20): the map database stays in Docker, and the import already keeps them |
| 10.69 | Installers kept for computers without the internet: Docker (a clean install for every large Linux distribution, Intel/AMD and ARM, and Windows) and the development tools for Linux and Windows; the setup scripts say where they are when something is missing. | ✅ `scripts/fetch_installers.py`, `data/installers/`, `install-docker.sh` (2026-11-20) |
| 10.70 | Switching between the built page and the development one resets itself in the browser (no old version kept, nothing to clear by hand). | ✅ the gate removes the map's service worker (`gate/service-worker/sw.js`) (2026-11-20) |
| 10.71 | Only the built frontend in Docker; development uses Vite's dev server directly, as before the gate. | ✅ one gate image (`gate/`), Vite passes the gate's paths on (`web/vite.config.ts`) (2026-11-21) |
| 10.72 | A French "place d'armes" (parade ground) isn't a range. | ✅ `site-rules.sql`: only "Place d'armes de ..." (Swiss training grounds) (2026-11-21) |
| 10.73 | A military base's parts not drawn like the base: the base alone with its icon; parts of another kind keep their own marking; parts that are buildings drawn as buildings with a clear title (those not tagged as buildings too); the rest as outlines; zoomed out, the base's details count its parts instead of numbered discs. | ✅ `site-parts.sql`, `modules/sites/parts.ts` (2026-11-21) |
| 10.74 | Ranges' icon a gun instead of the skull and bones. | ✅ a pistol (`make_site_icons.py`) (2026-11-21) |
| 10.75 | A hidden key row hides its sites' areas, not only their icons. | ✅ `SAME_FEATURES_AS` (2026-11-21) |
| 10.76 | Hill shading over imagery that doesn't look odd; 3D turns the shading on over the map. | ✅ shadows only from the photos' sun; `modules/view3d` (2026-11-21) |
| 10.77 | Contour heights readable over imagery (the map's unchanged). | ✅ replaced by 10.82 (2026-11-21) |
| 10.78 | No relief or contours at sea where ships were measured (Toulon). | ✅ `background_build/terrain_sea.py`: the sea flattened with the background map's land, after every terrain download (2026-11-21) |
| 10.79 | Several plots of one site (Issoudun's transmitter: 13 fenced plots, one Wikipedia link) shown as one site with its towers counted. | 🗂 backlog (2026-11-21) |
| 10.80 | A base's buildings drawn as buildings even when tagged as another kind (a camp's barracks and office blocks), raised in 3D. | ✅ `site-parts.sql`, `parts.ts` (2026-11-21) |
| 10.81 | A depot whose base isn't mapped (bunkers alone in a forest) shown as one base. | ✅ bases made for groups of buildings (`site_made_base`) (2026-11-21) |
| 10.82 | Contour heights over imagery as over the map. | ✅ (2026-11-21) |
| 10.83 | Sites classified better from their names: tax offices, town halls, the CSNJ (military), lunettes (forts); radio stations not made from anonymous masts. | ✅ `site-kinds.sql`, `site-rules.sql`, `sites.sql` (2026-11-21) |
| 10.84 | Landmarks for navigating: hilltops and mountaintops with their name and altitude, large radio towers, radio repeaters' positions. | 🗂 backlog (2026-11-21) |
| 10.85 | Montmacq's ammunition depot (Forêt de Laigue) one base; disused bunker groups as bases with a grey outline. | ✅ `site_made_base_whole`, `site-parts.sql` (2026-11-21) |
| 10.86 | The unclear military sites researched: those confirmed fixed by hand with their sources, the rest left for checking. | ✅ `site-overrides.sql` (2026-11-21) |
| 10.87 | Made bases' shapes following their parts (not long hulls), a spread cap; Maginot works grouped by their name; "Ligne Maginot" disused unless tagged otherwise. | 🗂 backlog (2026-11-21) |
| 10.88 | A list of the sites whose kind is only a guess, for spot checks. | 🗂 backlog: the list made (`data/local/checks/sites-guessed.csv`), the checks to do (2026-11-21) |
| 10.89 | Line of sight: kept in My layers, the line and what blocks it drawn on the map; its card simplified, a button opening a split screen (the chart large on the right, the line on the left, centred), hovering the chart showing the place on the map; trees and buildings counted. | ✅ `terrain/obstacles.py`, `measure/sight-panel.ts` (2026-11-21) |
| 10.90 | The line of sight green where the line is clear, red where it's blocked; tree and building heights adjustable (15 m and 8 m at first); not counted twice outside France. | ✅ `measure/sight.ts`, `terrain/bare_ground.py` (2026-11-21) |
| 10.91 | The strings check notices a text changed in the code but not in en.json. | ✅ `scripts/fork-strings.mjs` (2026-11-21) |
| 10.92 | The line of sight's profile a bubble on the right, clear of the buttons; its chart with the line of sight level; its heights set in the panel, the card only the answer and the button; its line drawn by the panel (shown even in a hidden layer); debug numbers to check the math; a moved point recalculates. | ✅ `measure/sight-panel.ts`, `sight-debug.ts` (2026-11-21) |

## 11. Quality

| # | Requirement | Status |
|---|---|---|
| 11.1 | Unit tests for the fork's code (frontend: Vitest; backend: pytest), where they make sense. | ✅ frontend `npm run test:fork`, backend `tests/fork/`, scripts `scripts/tests/` |
| 11.2 | Tests for the setup scripts. | ✅ the scripts run in a sandbox with fake Docker/network (options, refusals, safety rules); a real Luxembourg build, export and import in a separate test database (opt-in) |
| 11.7 | Distances and areas mean the same anywhere in the world: written in real metres, not map units tuned for France. | ✅ (2026-11-06) |
| 11.8 | The largest files split, each part about one thing, behaviour unchanged: My layers' map tools and list (refactor 5), the backend's grid, search, tower numbers and line tracing (refactor e). | ✅ (2026-11-07): each split behind tests written first (the backend's answers on the real database; My layers' tools and list). Plan: docs/plans/refactor-5e.md |
| 11.6 | Dead code removed: features replaced or dropped (the typed author name, layer colours, ⋯ menus, unused strings, styles and helpers). | ✅ (2026-11-06) |
| 11.5 | The setup scripts easier to read: repeated code made into shared functions (menus, disk space, titles, JSON files, replacing the database), the build script's steps each doing one thing, its shared variables listed and explained at the top. | ✅ (2026-11-06) |
| 11.4 | The code tidied: no repeated logic (shared helpers in one place), long files and functions split, each file's types and constants in small files of their own (`X.types.ts`, `X.constants.ts`); exact values locked by tests first so nothing changes. | ✅ (2026-11-06) |
| 11.3 | Easy to extend without changing the structure ("modding"): a map mode interface, My layers' item kinds as a registry, the measure and print files split. | ✅ `services/map-mode.ts`, `userlayers/kinds/`, recipes in `docs/FORK_ARCHITECTURE.md` (2026-11-02) |
