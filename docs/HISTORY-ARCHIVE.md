# History: the archive

Sections moved out of `docs/HISTORY.md` on 2026-11-20 (one-off changes from late
October to 7 November 2026, and topics closed since: statuses, login and sync, the
early refactors and polish), word for word. New history goes in `docs/HISTORY.md`.

## Statuses of map features (docs/plans/feature-status.md, step 1)

- **What:** any map feature the details panel shows with an id (power lines,
  substations, towers, plants, transformers, pipelines, masts, critical sites, extra
  data...) can be marked Operational, Repaired, Threatened, Suspected damage,
  Damaged, Destroyed, Under repair or Unknown, with how it's known (seen, reported,
  imagery), a note and who set it. Shared by everyone; separate from My layers.
- **Setting it:** a "Status" section in the feature's details
  (`web/src/fork/modules/status/details.ts`): the status, who set it and when, its
  note, "Set status" / "Change status" (a form), and the history (newest first).
  The name typed is remembered with My layers' (`core/author.ts`).
- **Colours:** threatened yellow, suspected damage purple (as power supply mode's
  "at risk"; orange there means less power), damaged red, destroyed black, under
  repair blue.
- **On the map** (look C): only the problems (threatened, suspected damage, damaged,
  destroyed, under repair), as a coloured casing along both sides of a line, an
  outline round an area, a ring round a point, and from zoom 12 a badge with the
  status's sign (⚠ ? ! ✕ 🔧, drawn by the browser) (`modules/status/map.ts`). The
  layers start with `status_` (the layer switcher's "Damage and threats", K) and
  aren't clickable: a click goes to the feature underneath. The key lists them.
- **Stored** in the `userdata` schema (`userdata.sql`): `feature_status` (the current
  status; the feature is its table and id, as several tile layers show the same
  table, with a copy of its geometry so it's drawn whatever the tiles) and
  `status_change` (every change: the history). So statuses are kept across rebuilds
  and imports like My layers (`user_data_saves` counts their changes too).
- **Backend** (`web-backend/src/fork/userdata/status.py`): `GET /userdata/status`
  (the problems, GeoJSON with a badge point), `GET /userdata/status/feature?layer=&id=`,
  `POST /userdata/status`. Who may set statuses: `can_set_statuses()` in `users.py`
  (everyone until there are accounts).

- **Not on small parts** (asked 2026-10-31): switches, disconnectors, compensators,
  gantries, street cabinets, poles, busbars and bays get no Status section (and are
  left out of "Set status for all"): a status there says nothing useful, and power
  supply mode doesn't use them (`NO_STATUS`, `can_have_status` in `status.py`;
  `canHaveStatus` in `modules/status/fields.ts`). Transformers keep it (step 5).

### Step 2: extra fields, several at once, convenience stores

- **Extra fields by kind** (`modules/status/fields.ts`, checked by `clean_details` in
  `status.py`, kept in `details`): stock (Full, Half, Low, Empty, Unknown) and what's
  short for supermarkets, convenience stores, wholesale, distribution centres, silos
  and fuel depots; capacity (Normal, Saturated, Closed) for hospitals and clinics;
  fuel available (Yes, No, Rationed) for fuel stations and depots. Shown under the
  status ("Stock: Low · What is short: water") and in the history.
- **Several at once** (`services/selection.ts`, `modules/status/selection.ts`): Shift-click
  adds a feature to a selection (or takes it out) instead of showing its details. The
  picked features are outlined in purple (their whole shape) and listed in a panel
  in the left column; "Set status for all" sets them together, each getting only the
  extra fields of its kind. MapLibre's Shift-drag box zoom is off for good (it
  swallowed Shift-clicks; My layers had already turned it off while open).
- **Convenience stores** (`shop=convenience`) are critical sites now (food supply,
  from zoom 14, Maki's convenience icon): `imposm/sites.py`, `schema/sites.sql`,
  `scripts/make_site_icons.py`. They appear at the next rebuild of the region.

### Step 3: the Status board, playback, search by status

- **The Status board** (`modules/status/board.ts`): a ⚠ button with the others on the
  right opens it in the dock. Every feature with a status (`GET
  /userdata/status?all=1`), newest first, with counts per status (click one to show
  only those, more than one at a time), a filter by kind (power, critical sites,
  telecoms, pipelines, water, open data) and by name. A row shows the status, who set
  it and when, the extra fields and the note; clicking it zooms there and highlights
  the feature.
- **Playback** (`playback.ts`, `GET /userdata/status/history`): a timeline over every
  status change, with first, back, play, forward and Now. At an earlier step the map
  (`StatusMap.showPast`) and the board show the statuses as they were then (the
  timeline turns yellow); closing the board goes back to now. My layers' history is
  separate.
- **Search by status** (`search.py` `search_statuses`): typing a status ("damaged",
  "under rep", 4 letters at least) finds the features that have it; the result says
  "Status: Damaged" and switches the statuses layer on.

### Step 4: power supply mode

- **Turned on** with the switch at the top of the Status board ("Power supply mode"). A banner at the bottom sums it up ("Without supply: 2 ×
  400 kV, 2 × 63 kV substations or plants; 1 with less power") with the legend and
  "Turn off".
- **Worked out** by `web-backend/src/fork/grid_supply.py` (`GET /grid/supply`) on the
  grid network held in memory, voltages meeting only at stations (as routes):
  - sources: plants of 10 MW and more (or the substation they're in), and line ends
    at the edge of the region (power comes from outside);
  - lost: power lines, substations, plants and towers Destroyed or Damaged (a tower
    cuts the lines it carries);
  - for every point, the best path's lowest voltage from a source (widest path), with
    nothing lost (kept) and now: **red** if no source reaches it any more, **orange**
    if only through lower voltages than before (a 225 kV substation fed through 63 kV
    lines), **purple** ("at risk") if it would be red or orange were what has
    Suspected damage lost too, **green** otherwise. (A first version had a
    "Pessimistic" switch counting suspected damage as lost; replaced by the purple.) About 0.5 s for France (6 s the first time).
  - **grey**: what no source reaches even with nothing lost, missing in OpenStreetMap
    (about 99,000 ways and 15,000 stations in France, mostly 20 kV):
    `GET /grid/supply/unconnected?grid=<build>`, made once per grid build, served
    gzipped (0.5 MB). Its address names the grid build (`grid` in `/grid/supply`'s
    answer): a first version had a fixed address cached for an hour, and browsers
    that had its old answer (shapes) failed to colour anything (all green).
  - Both send ids only (per way and circuit, in the tiles' order: `{"s1": "red"}`),
    no shapes.
- **On the map** (`modules/status/supply.ts`): nothing is drawn over the map.
  Upstream's power line, substation and plant layers are recoloured while the mode is
  on (their paint put back when it's off), by the feature state the backend's ids get:
  each circuit of a way carrying several (power_line_1/2/3) its own colour, so double
  lines stay double; lines below 10 kV (not in the network) grey. A first version
  drew a green copy of every line plus the grey lines as a 14 MB GeoJSON over the
  map: slow, and the double lines showed through. A way gets one colour along its
  whole length (a tower down turns all of it red, not only from the break).
- **Copies in My layers** of power lines, substations and plants take their original's
  colour while the mode is on (`services/supply.ts`, read by My layers' renderer), and their
  own look when it's off.
- **Inside a substation** without supply (or with less), every power line within its
  outline (bays, connections, often not in the network) takes its colour.
- Not yet: scenarios ("what if these were lost?" without setting statuses), and the
  detailed substation model (step 5: levels and transformers).

## Login for the whole app (docs/plans/sync.md, phase 1)

- **Accounts** (`web-backend/src/fork/auth/`, tables `userdata.app_user` and
  `userdata.user_session`): local only, made by admins; the first one at setup (the
  login page offers it while there's no account). Rights: admin, can set statuses.
  Passwords hashed with scrypt; sessions are a random token in an HttpOnly cookie
  (`oim_session`), stored hashed, 30 days from the last visit.
- **Every call needs a session:** `LoginMiddleware` (added in `main.py` after the
  database middleware, one line) answers 401 to anything but `/login` and `/auth/*`.
  `current_user()` (`userdata/users.py`) is the logged-in user; statuses use its
  rights (`can_set_statuses`) and name.
- **The gate** (`gate/nginx.conf`, Compose `gate`, on the host's network, port 8800):
  the only way in from the network. It checks the session with the backend
  (`auth_request` → `/auth/check`) on every request and passes it to the frontend dev
  server, Tegola (`/tegola/`), the background map (`/basemap/`) or the backend; a page
  without a session goes to `/login?next=…` (the map's place after `#` is kept). The
  database, Tegola, the backend and the background map server listen on 127.0.0.1
  only (checked: from the network address only 8800 answers).
- **Frontend:** `throughGate()` (`fork/config.ts`) sends the local services of
  `web/.env` (localhost:7800, 8001, 8090) through the gate, at the page's address. The
  `account` module shows "log out (name)" in the header, Settings → Accounts for
  admins (add, rights, new password, disable), and goes back to the login page when
  an answer from the site says the session has ended (401).
- **Scripts:** `start.sh` / `launch.sh` start the gate and open https://localhost:8800.
- **HTTPS** (asked 2026-11-01): the gate has its own image (`gate/Dockerfile`: nginx and
  openssl) and makes a self-signed certificate on first start (`gate/10-certificate.sh`,
  10 years, for localhost, this computer's name and addresses; kept in `data/gate/`).
  Plain http on 8800 is sent to https; the session cookie is `Secure` (the gate
  passes `X-Forwarded-Proto`; in nginx, a location setting a header of its own loses
  the server's, so they're repeated). The gate passes the host with its port
  (`$http_host`) and the backend trusts its `X-Forwarded-Proto` (uvicorn
  `--proxy-headers` in `docker-compose.override.yml`), so the backend's redirects
  (a power plant's page) stay on https://…:8800 (2026-11-03: they went to
  http://localhost). Browsers warn once (nobody vouches for the
  certificate); installing `data/gate/cert.pem` avoids it. The gate's image is saved
  with the others for offline use.
- **What can't be changed is locked** in Settings → Accounts (greyed out, the reason as
  its tooltip) rather than refused after: your own admin right and Disabled, and
  Disabled for another admin (take away the admin right first; the backend refuses
  it too).

## Owners and sharing for My layers (docs/plans/sync.md, phase 2)

- **Rules** (`web-backend/src/fork/userdata/access.py`, one place): a layer belongs to
  who made it (`layer.owner_id`); its owner shares it per account to **view** or
  **modify** (`userdata.layer_access`). The owner may do everything; modify: its
  items, name, colour, folder; view: see it, read-only. Only the owner locks or
  unlocks it, deletes it, shares it. Moving an item needs modify on both layers.
  Admins see nothing more of other people's layers.
- **Layers from before accounts** (no owner) stay open to everyone (modify); admins act
  as their owner. The first time an admin shares one, they become its owner and every
  other account gets modify access, so nothing changes until it's changed on purpose.
- **Checked on the server:** `/userdata` sends only the layers you can see, with your
  access and their owner; Save (`changes.py`) refuses a change to a layer you may not
  change (403, nothing saved); the history leaves out layers you can't see; a
  situation records its layers (those shown on the map when it's made) and is seen
  only by who can see them all. Saves record the account (`save.user_id`, its name as
  author).
- **Frontend:** a layer shared to view is read-only (`view.canEdit`); the lock and
  Delete are its owner's; a shared layer shows 👥 (can change) or 👁 (view only) with
  whose it is; **"Share…"** in the layer's menu (owner) opens the sharing dialog
  (`ui/sharing.ts`, `GET/PUT /userdata/layers/{id}/access`), saved at once.
- Tested end to end with two accounts: not shared → not seen; view → seen, changes
  refused; modify → items changed, lock/delete/share refused; access taken back → the
  layer, its history and the situation gone for them.

## Versions, merging and conflicts in My layers (docs/plans/sync.md, phase 3)

- **Versions** (`userdata.sql`): every layer and item has a `version`, raised by each
  saved change, and `updated_by` (who saved it last). `/userdata` sends them.
- **Save checks them** (`changes.py` `stale`, `layers.py` `save`): the browser sends,
  with its changes, the version each changed item started from (`bases`); if any
  moved on since (someone else saved it), nothing is saved: 409 with those items.
- **The browser keeps a base** for everything it changes: how it was saved, and its
  version, when the first change to it was made (`state/store.ts`, kept with the
  unsaved changes in the browser, `local.ts`).
- **Merging** (`state/merge.ts`, pure): field by field, as the plan's table: the
  position, the layer, each property, each detail (modifier), each part of the
  symbol code (identity, status, echelon...); a layer's name and each style key.
  Deleted on one side and changed on the other is a conflict.
- **Bringing your changes up to date** (`state/reconcile.ts`, pure): when Save is
  refused, and when the page loads with unsaved changes kept in the browser, your
  changes are merged with the server's layers: rewritten on top of them, new bases,
  and the conflicts left. Your undo history starts again then.
- **The conflict window** (`ui/conflicts.ts`): one conflict at a time ("Conflict 2 of
  5"), what and in which layer, who changed it and when, the differing fields yours
  and theirs side by side, **Keep mine** / **Take theirs**, ◀ ▶, **Keep all mine** /
  **Take all theirs**; "–" folds it to a bar ("⚠ 3 conflict(s): resolve"). Until
  resolved, the map shows your version with an orange dashed ring (the list a ⚠), and
  **Save is disabled** ("Resolve the 3 conflict(s) first"). Keep mine: your version
  is saved with the next Save, against the server's new version.
- Tested end to end: A's unsaved rename (to "Charlie") on an item B renamed meanwhile
  ("Bravo"): A's Save with the old version is refused (409); A's page shows the
  conflict; Keep mine, Save: the server has "Charlie", version 3.

## Live updates (docs/plans/sync.md, phase 4)

- **The backend pushes** (`web-backend/src/fork/userdata/events.py`, `GET
  /userdata/events`, Server-Sent Events): each open page keeps a connection; every 2
  seconds it looks for new saved changes on layers that user can see ("changes": how
  many, which layers, by whom), a change in what they can see ("access": a layer
  shared with them or not any more), a status changed ("status"). A comment every 25
  s keeps it open through proxies. The event id is the last change: the browser
  reconnects by itself after a break and is told what it missed.
- **No database connection held:** the stream takes one for each look; `main.py`'s
  database middleware skips it (`streaming_paths`, a one-line hook), and the login
  middleware then opens one just to check the session.
- **The page** (`fork/services/live.ts`, one connection, `onLive(kind, listener)`): My layers
  fetches the layers again (`store.refresh`): shown as they are if you have nothing
  unsaved, merged with your changes otherwise (phase 3; conflicts not yet resolved
  stay); a Save under way first. The statuses (map, supply, board) refresh too.
- Tested: A's page open, B saves a layer and shares it with A, sets a status: A's list
  shows the layer 2 s later, its statuses refresh, no reload.

## Per-user settings (docs/plans/sync.md, phase 5)

- **The backend** (`web-backend/src/fork/userdata/settings.py`, `GET/PUT
  /userdata/settings/{key}`): one JSON value per account and key (at most 200 KB),
  in `userdata.user_setting` (`userdata.sql`'s last statement: `schema.py` checks
  for it to know the schema is up to date). Without an account (`ANYONE`): 403.
- **My layers** (`web/src/fork/modules/userlayers/state/personal.ts`, key
  "userlayers"): each layer's folder, the layers hidden, the layers open and the
  folders folded in the list, the folders still empty, the layer you draw into
  (`store.activeLayer`: yours if it's still there, else the first), favourite and
  recently used symbols (the picker, `ui/palette.ts`). Kept in this browser too
  (shown at once, used when the server can't be reached), sent half a second after
  a change. What the account doesn't have yet is taken from what the browser kept
  before (`oim-userlayers-hidden`, `-folded`, `-empty-folders`, `-favourites`,
  `-recent`) and sent.
- **Folders aren't changes any more:** moving a layer to a folder isn't recorded,
  saved or undone, and works on layers shared with you to view only. A layer's
  `style.folder` (set before) is only the fallback when you haven't chosen.
- Tested: a layer whose shared folder is "Shared" shows in the account's "Mine";
  moved to a new folder from its menu, the server has it and nothing is unsaved.

## Measuring and grid references (SPECIFICATIONS 10.2)

**Grid references** (`web/src/fork/modules/coordinates/`):
- **Where the cursor is** (`readout.ts`), bottom left, to the right of the scale, in
  a fixed place just past the scale bar's widest (it grows and shrinks with the
  zoom; `coordinates.css`): latitude, longitude and the military grid reference (MGRS,
  to the metre; the `mgrs` package from proj4js, MIT, bundled: works offline;
  formatting in `fork/core/mgrs.ts`). Off the map: its centre. **G** copies the grid reference under the cursor (the
  pointer stays where it is; not while typing in a field), which the readout's tooltip says
  ("G: copy grid at pointer", the page's tooltip: `ui/tooltip.ts`); clicking it does
  nothing.
- **Search** (`mgrs.ts`, `MgrsSearch`): a grid reference typed in any usual way
  ("32TLT7257789913", "32T LT 725 899") goes to the centre of the square it names.
  Search providers come from the modules (`searchProviders` hook,
  `forkSearchProviders` in `search/search.ts`, which used to name Photon).

**Measuring is a My layers tool** (2026-11-02; it was a panel of its own before):
a measurement is an item of the kind `measure` (`userlayers/kinds/measure.ts`),
so it's saved, shared, in the history, undone, exported and printed like the
others, and its points are moved like a drawing's.
- **The tools**, in My layers' toolbar after the drawing ones: 📏 distance (D),
  ⬠ area (E), ◎ range rings (O). Distance and area are the line and area tools
  making a measurement (`Tool.properties`): while drawing, the lengths and bearings
  so far follow the cursor (`Renderer.measureDraft`; marks only once it's done).
  Click points; double-click or Enter finishes; Backspace takes back a point;
  right-click drops what's drawn so far (again: stops; any drawing tool); Esc stops.
  Points can be moved afterwards, not added or removed.
- **What it shows** (`userlayers/measure/features.ts`, pure): each leg's length and
  bearing in degrees and NATO mils, written along the leg and above it; the total
  beyond the end; an area and its perimeter; rings and their radii, outside each
  ring (only rings at least 25 px across on screen; the bigger ring's label wins;
  when the largest is under 60 px, one label above it with its diameter, "Ø 20 km":
  the map's font has no ⌀). A leg too short on screen for its whole label shows only its length. Where
  labels would overlap, the total stays, then the legs, then the marks
  (`symbol-sort-key`). Lines follow great circles (`greatCirclePath`, a point every
  2 km so the straight pieces on the flat map stay within a metre of it).
- **Marks along distances** (`measure/ticks.ts`, pure), like a ruler: a mark at the
  start, a labelled mark every `major` with one plain mark halfway, on full values
  (majors 1 or 2 × 10ⁿ; a 5 × 10ⁿ step has no halfway mark), labels about 80 px
  apart, never under 10 m. Labels: "18 km" when the step is a kilometre or more,
  else "18 km 450 m"; under the line, along it. None when fewer than four labelled
  steps fit along the whole measurement (zoomed out: one or two lone marks say little). Placed on the line as drawn (in Web Mercator,
  where screen directions are true) and square to it; only those in view are made,
  again as the map moves. Drawn in the measurement's line and label layers.
- **Legs on the card** (`ItemKind.card`, a new hook, which can also change the
  shape): each leg's length, typed over ("18 km 450 m", "2.5 km", "800"): its end
  moves along the same bearing and the legs after keep their length and bearing
  (`withLegLength`); an area's closing leg follows from the others.
- **No areas that cross themselves** (`model/shapes.ts`, any area, drawn or
  measured; a click on the first point closes an area, and a last point finished on
  it is dropped; a new point at least 12 px from the others, dragging one closer is
  fine): a point that would make the outline cross isn't added, closing one
  that would is refused (add a point, or take one back), a point dragged stops
  where it would cross, a leg length that would is refused.
- **Testing note:** the headless browser used for checks only draws a new frame when
  something asks for one, so labels fading in and freshly updated sources can be
  missing from screenshots; force repaints (`map.triggerRepaint()`) before taking one.
- **Range rings' distances** are on the item's card (`ItemKind.card`, a new hook);
  new rings get the last ones set.
- **Which north** (`measure/north.ts`), in My layers' settings ("Measured bearings
  from"), kept per account (`personal.ts` `north`, `radii`; `measure/prefs.ts`):
  true north (°T), magnetic north (°M: the declination at the leg's start from the
  World Magnetic Model 2025, `magvar` package, MIT, offline, valid to 2030) or grid
  north (°G: UTM/MGRS grid convergence).
- **Locking one item** (any kind): 🔒 Lock on its card. A locked item can't be
  changed, moved or deleted until unlocked (`View.canEditItem`, used by dragging,
  deleting, moving to another layer, the card and the right-click menu); 🔒 in the list.
- Exports keep a measurement's type, ring distances and lock.
- Not done: the MGRS grid drawn on the map, polar areas (UPS), adding or removing a
  point of a placed measurement (its points are moved, as a drawing's).

## Import, export and printing (SPECIFICATIONS 10.7)

- **My layers to and from files** (`userlayers/io/formats.ts`, pure; `io/files.ts`):
  GeoJSON, KML (a folder per layer, colours) and GPX (points as waypoints, lines and
  area outlines as tracks: GPX has no areas, symbols or colours). Exported items keep
  what they are (kind, symbol code, details, notes) in their properties or KML's
  ExtendedData (`oim:...`), so they come back as they were. Files from elsewhere
  (`@tmcw/togeojson` reads KML and GPX): points become markers, the rest drawings,
  with their name, colour if any, other fields in the notes; multi-geometries are
  taken apart, heights dropped. **Import a file…** under the list makes a new layer
  (`Store.importLayer`: one change, undone at once, shown once); **Export…** saves the
  layers shown (a situation's while one is shown); each layer's ⋯ → Export as.
- **Print** (`fork/modules/print/`, "print" in the header; `pdf.ts` puts the page
  together from `parts.ts` (header, map and north, legend, footer), `layout.ts`
  (sizes, scale, pure) and `images.ts` (the map's picture, symbols as PNG)): title, A4 or A3,
  landscape or portrait, legend or not. jsPDF, loaded only when used. The map as on
  screen, drawn again at twice the resolution (`setPixelRatio`), north as the map is
  turned, the scale (1:N) and a bar, the centre's position and MGRS, the map's credits,
  the date and who printed it. The legend (`fork/services/legend.ts`, `addLegend`): the map
  layers on (print), the layers shown and the symbols in view (My layers), the power
  supply colours while the mode is on (status). Long legends end with "…and N more".
- `fork/ui/panel.ts` `makeModal`: the window Settings used, shared with Print (Print's is a floating panel since 2026-11-05).
- MGRS formatting moved to `fork/core/mgrs.ts` (used by measure and print).
- Tested: a GeoJSON file with a symbol, a point and a line imported, exported as KML,
  printed: the PDF has the map, the legend (map layers, the layer, "Infantry"), 1:20 000.

## Position area for artillery, drawn point by point (2026-11-06)

2525C has the PAA only as a rectangle or a circle (both need a width or radius the
tool doesn't ask for, so the rectangle was removed with the others); 2525D and E have
it irregular too (entity 240503). It's back in the catalogue under a 2525C-style code
of ours, G*F*ACPI ("Position area for artillery (paa)"), which `toDCode`
(`graphics/graphics.ts`, `BEYOND_C`) turns into 2525D's irregular PAA: the irregular fire
support area's code (G*F*ACSI, for the affiliation and status) with its entity
swapped. Note: G*F*ACPI isn't a real 2525C code, for anything exported to other
systems. The renderer writes "PAA" on every side, as the standard's template does
(readable whatever part of a large area is in view): kept.

## Fork folders tidied (2026-11-06)

Pure moves, nothing changed in behaviour:
- `userlayers/graphics/`: everything about tactical graphics, out of `map/` (which
  kept the map's own drawing and tools): `graphics.ts`, `labels.ts`, `variants.ts`,
  `svg.ts` (were `map/graphics.ts`, `map/graphic-labels.ts`, `graphic-variants.ts`,
  `graphic-svg.ts`), `tta106-sigles.json`.
- `fork/services/`: the shared state and registries, out of `fork/ui/` (which kept
  what's on screen): `legend.ts`, `live.ts`, `map-mode.ts`, `selection.ts`,
  `supply.ts`. `structure.test.ts` checks the new area: modules and `ui/` may use
  `services/`, `services/` never `ui/`.

## Satellite menu easier to read; more detail added later (2026-11-06)

- **The aerial photo question** (`scripts/satimagery/menu.py`) line by line: what the
  photos are, one line per zoom with what it shows (`ZOOM_SHOWS`: 15 streets and
  blocks, 16 houses, 17 cars), its size and time, the free space on the disk (a
  zoom that wouldn't fit, at twice its size during the last step, is marked). The
  Sentinel-2 zoom question too: "a town fills the screen … on disk (downloads ~…)".
- **More detail later without downloading again**: the first download makes
  `<area>.sat-detailed-<source>.pmtiles` (zoom 14 up); asked for more later, the menu
  (and `--satellite-detailed`) sees what's there (`detailed_have`, from the files'
  PMTiles headers) and offers only the zooms after it, with their own size
  (`detailed_estimate(..., start)`), downloaded into a file of their own
  (`detailed_file`: `...-z16-17.pmtiles`; `satellite.py detailed --minzoom`). What's
  there stays. The tiers line takes each aerial file's own first zoom
  (`pmtiles_minzoom`, 14 at the lowest), and the map draws each file from its
  first zoom, coarsest first, so the added file takes over from its first zoom.
  Before, the working file was deleted once converted, so asking for more meant
  downloading zoom 14 up again.

## One graphic, two versions (2026-11-06)

Block, Disrupt and Fix were each in the picker twice (the task and the obstacle
effect), Main attack, Supporting attack and Aviation too (an axis of advance and a
direction of attack), with the same names. Now a switch on the card (`userlayers/graphics/variants.ts`, `VARIANTS`): **Task / Obstacle**,
**Axis of advance (wide) / Direction of attack (thin)**. The two versions take the
same points (an arrow: its path, tail to tip), so switching keeps the drawing; an
axis gets its width back (`axisWidth`), a direction has none. Both versions are in
the picker (a filter hiding the second ones was tried and removed: how to list and
name them is in the backlog, SPECIFICATIONS 9.29). The second versions are named for what they are in the catalogue ("Block (obstacle)", "Main attack (direction of attack)") for the
legend. The obstacle effects are green: the standard's colour for friendly
obstacles (as is neutral; the shapes differ).
- **Directions of attack pointed backwards**: the renderer wants their tip first,
  the tool gives the path tail to tip. Reversed for the renderer (`isDirection`: the
  three, and the feint's direction of attack), on the map and in the preview.
- **Engagement area** was in the catalogue twice (G*G*GAE, G*G*DAE: the same 2525D
  symbol): G*G*DAE removed.

## Rectangular fire support areas removed (2026-11-05)

The 17 "…, rectangular" graphics (FSA, ACA, FFA, NFA, RFA, PAA, sensor zone, DA,
ZOR, TBA, TVAR, ATI zone, call for fire zone, censor zone, CFZ, blue and purple kill
boxes) need a width in metres besides their two points, which the drawing tool never
asks for: the renderer refused them ("requires a modifiers object that has 1
distance/AM value") and nothing was placed. Removed from `model/symbols-2525c.json`:
the irregular versions draw a rectangle just as well (four points). The position
area for artillery (PAA) had only the rectangular one in 2525C: it's back as 2525D's
irregular one (below).
With no other shape left, the remaining 16 lose ", irregular" from their names
("Zone of responsibility (zor)").

## Plain labels on tactical graphics (2026-11-05)

The renderer writes the standard's text on 110 graphics, and several share a letter
(B: Block, Breach, Bypass, Bridgehead, Bearing line). Each now gets a label of its
own, in English or French, as agreed in `docs/plans/graphic-labels.md`: one letter
only for the most common, short words in full, others shortened or initials (WUP);
French from the French Army's terms (TTA 106).
- `userlayers/graphics/labels.ts`: `GRAPHIC_LABELS` (2525C code without
  affiliation and status, `graphicKey`, now shared with `SQUARE`) → for each text the
  renderer writes, what to write instead in English and French ('' = not written:
  Contain's ENY), and the French name. `renderGraphic` replaces them (`language`:
  the chosen one by default, null the standard's), so the map, the preview, prints
  and the legend's drawings all show them.
- **Graphic labels: English / Français / Standard (MIL-STD-2525)** in My layers'
  "Labels, bearings, name", kept in this browser (`oim-userlayers-graphic-labels`);
  chosen, not the browser's language, so everyone on a map can see the same.
- The legend: "WUP: Withdraw under pressure", in the chosen language
  (`graphicSvg` returns the labels written; `graphicName`).
- `graphics/labels.test.ts`: every catalogue graphic through the real renderer, in
  both languages: no two different graphics share a label; every replaced text is
  one the renderer writes; no French label means something else in TTA 106
  (`tta106-sigles.json`: its abbreviations and the letters on its task symbols).
  It found DA, ZOR and TBA (kept as acronyms) clashing: Z-MORT, ZR, Z-CIB in French.

## One tooltip for the page (2026-11-05)

The browser's tooltips (`title`) wait for the pointer to rest, often didn't show
(the coordinates' "press G"), and look like nothing else here. `fork/ui/tooltip.ts`
(installed by `forkInit`) shows every title on the page, the fork's, upstream's and
MapLibre's, as one tooltip of its own: the title moves to `data-tip` when the pointer
first comes (an icon-only control keeps it as its `aria-label`); shown after 350 ms,
at once when going from one control to the next; below the element, above if there's
no room, kept on screen (`placeTip`); hidden on a click, a key, a scroll or the wheel;
on keyboard focus too; from where the pointer is (`elementFromPoint`: disabled
buttons send no pointer events). The coordinates' tooltip: "G: copy grid at pointer"
(its CSS one removed).

## The printed legend: what's on the page (2026-11-05)

It listed the layer switcher's names (Labels, Borders), a colour square per My
layers layer, and graphics as a line in the layer's colour: none of it explained
the map.
- **The key, only what's on the page** (`fork/ui/key/legend.ts` `keyLegend`): the Key
  panel's rows (upstream's and the modules', read from its DOM: label, swatch, and
  what it draws, `swatchSpec` / `data-hide`), kept when a feature they draw is drawn
  in the printed area (`specConditions`, moved out of `FeatureHider`, turned into a
  `queryRenderedFeatures` filter over the area), under the Key's own headings, with
  their swatches (inline SVG, sprites fetched).
- **My layers by layer** (`userlayers/map/legend.ts`): a section per layer shown, by
  its name, in the list's order, listing what of it is in the printed area, each kind
  once: a unit's symbol, a graphic drawn small by the real renderer from made-up
  points in its usual shape (`graphics/svg.ts`; in its own colour, else the
  renderer's, as on the map), lines, areas and markers in their colour by name.
  Copies are left to the key; pictures and measurements explain themselves.
- Legend sources get the printed area (`addLegend((map, area) => …)`).
- The PDF's built-in font has no ≥ or ≤: written >= and <= (`printable`).

## Three-point graphics drawn square (2026-11-05)

Of the 31 graphics in the catalogue drawn from exactly three points, the renderer
squares none up itself: a third point off to one side drew a skewed Contain, Block or
Bypass. Checked one by one (each drawn with its third point skewed):
- **Square, third point on the perpendicular through the middle of points 1-2**:
  Block (task and obstacle effect), Penetrate, Contain, Clear, Breach, Bypass (and
  easy, difficult, impossible), Canalize.
- **Disrupt**: its arrows run along the line from one end of the base to point 3
  (the task: from point 2; the obstacle effect: from point 1): point 3 on the
  perpendicular through that end.
- **Ambush, Attack by fire position**: point 1 (the arrow's tip) on the perpendicular
  through the middle of points 2-3.
- Left free (their angle means something, or the renderer already fixes it):
  Search area, Dummy, Principal direction of fire, Turn, Delay, Withdraw and
  Retirement, roadblocks, fords, infiltration lane, minimum safe distance zones.

`squareUp(sidc, points)` (`graphics/graphics.ts`, table `SQUARE` by 2525C code) moves the
free point onto the perpendicular, keeping its distance from the base. Used while
drawing (the preview and the stored points), when a point is dragged (the free one
stays on the perpendicular, or follows when the base moves), for the handles, and
when drawing on the map, so items drawn before are square too.
Filled shapes the renderer gives no outline colour (an obstacle Disrupt's
arrowheads) are outlined in their fill (`normalise`), not in the layer's colour the
map falls back to (they had red edges in a red layer). Obstacles are green: the
standard's colour for friendly obstacles.

Each graphic's points mean something of their own (the standard's, per graphic), so
there's no one rule: `graphics.test.ts` draws every graphic in `SQUARE` through the
real renderer with its free point skewed, squares it up, and checks its main stroke
(the longest line not along the base) is at a right angle to the base. (The task
Disrupt was first squared through point 1: that check fails on it.)

## Place names and satellite zooms: rules instead of numbers (2026-11-06)

- **Place names** (`map-sources/labels.ts`): one rule read from the style: a
  place-name layer that ends after zoom 10 (towns, neighbourhoods: the name of where
  you are) is kept to the closest zoom, from where the style starts it; countries and
  regions (ending at 8) keep upstream's end. Before: each layer's zooms copied in
  by hand (5.5 and 13), after three tweaks.
- **Satellite zooms** (`select_satellite`, `scripts/lib/satellite.sh`): each imagery
  file is shown over the zooms its own header gives (satellite.py writes them); the
  tier's usual zooms are only a fallback when a header can't be read. Before: fixed
  0–8 and 9–… per tier, and aerial photos forced to start at 14 at least.

## Printed text: one font with every character (2026-11-06)

The PDF used jsPDF's built-in Helvetica, which only knows Latin-1; characters it
lacked were swapped one by one (`printable`: ≥ → >=, ≤, −, thin spaces), and the
next one (œ, Cyrillic, →) would have printed wrong. Now the PDF embeds DejaVu Sans
(`print/fonts/`, its free licence beside it; fetched only when printing, from the
app, so offline too): one font because jsPDF can't switch fonts inside a text.
Noto Sans (the map's) was tried first: it has no ≥ ≤ →. The rule is tested
(`fonts.test.ts`): the font must have every character of the app's strings
(`locales/en.json`), the symbol catalogue and the key's ≥ ≤ → (emoji excepted: on
screen only). `printable` is gone.

## Measurement marks: one rule, like a ruler (2026-11-06)

The marks had two rules that fought: labels about 80 px apart, and "at least four
labelled steps along the measurement, else none". On a short measurement, or just
under a zoom where the step jumps (2 km labels 79 px apart: 5 km steps), they
couldn't both hold and every mark went; a first fix (smaller steps down to 45 px)
only moved the gap. Now one rule (`tickSteps`, `measure/ticks.ts`): the step is the
smallest round distance (1, 2 or 5 × 10ⁿ m, at least 10 m) whose labelled marks are
at least 60 px apart, so they're always 60 to 150 px apart; a measurement shorter
than two steps (tiny on screen) has none. A test checks it at every zoom from 6 to
18. Labels that would overlap the legs' own labels give way (MapLibre); the marks
stay.

## A layer's items, in groups (2026-11-06)

An open layer lists its items under small headings that fold (`ui/outliner/groups.ts`,
`ITEM_GROUPS`): friendly units, hostile units, neutral and unknown units, friendly
graphics, hostile graphics, other graphics, measurements, drawings and markers,
pictures, copies of map features (empty groups not shown; friendly includes assumed
friend, hostile includes suspect). Inside a group: present first and planned at the
end, then by shape (arrows, lines, areas, points), then by type (the same graphics
one after another), then by name (numbers in order: 2 before 10). Folded groups are
yours (`foldedGroups` in the personal settings); while searching, every group is
open. Items were in the order they were made before. The groups have no eye: a
layer is shown or hidden as a whole. The groups go by side (friendly units and
graphics, then hostile ones, then the others).

Selecting in the list: a click selects one item, Ctrl / Cmd-click adds or takes one
out, Shift-click adds everything shown between the item clicked last and this one
(across groups and layers; `tools.selectAll`). On the map, Shift-click still adds
one item.

## Satellite menu: two independent steps (2026-11-06)

The menu's Sentinel-2 question ended the menu when answered "None", so the aerial
photos were never offered; and it offered the built region again ("+204 MB to zoom
12") without saying it was already there, to zoom 13. Now: step 1 (Sentinel-2) says
what's there and defaults to keeping it ("Keep what you have (France to zoom 13)");
step 2 (aerial photos) always follows, for the area chosen in step 1 or else the
region built, or says no agency's photos cover it (`regional_have`, menu.py).

With one aerial source, step 2 asks the zoom straight away ("Download France (IGN)
up to which zoom? [15/16/17, Enter: none]"); with several, which ones, then the
zoom. An answer that doesn't fit is said so and asked again (`ask`, `ask_numbers`),
never dropped: a zoom typed where a source number was asked used to vanish.

The catch-up only touches files that start above the lowest zoom their area can
have (`lowest_zoom`, tiles.py: where it spans half a tile; Luxembourg 8, France 5):
`lower-zooms --list-needed` says which. Before, Luxembourg (which GDAL can't take
below 8) was redone on every run.

## Picker: one row per graphic type (2026-11-06)

A graphic with two versions (Block, Disrupt, Fix: task or obstacle; Main attack,
Supporting attack, Aviation: axis or direction of attack) is one row in the picker,
its first version, with its versions noted under its name ("Task / Obstacle"); the
card switches between them (variants.ts). Searching either name finds it ("obstacle"
finds Block), and favourites or recent picks of a second version show as the first
(`offeredAs`, palette.ts). Before, both versions were rows after several patches
(hidden, then shown when the first wasn't listed). Closes 9.29.

## Distances in real metres everywhere (2026-11-06)

The map's coordinates (EPSG:3857) stretch away from the equator by 1/cos(latitude):
10 map units are 10 m at the equator, 6.9 m in France, 5 m in Oslo. Distances and
areas had been written in those units, tuned for France ("15 ≈ 10 m", "725 ≈ 500 m",
"roughly 4–7 km in Europe"), or scaled by hand in one place (grid_check.py). Now one
rule: every distance and area is written in real metres, converted by
`schema/distances.sql` (`oim_units`, `oim_metres`, `oim_ground_area`, and
`oim_max_stretch()`, the region's largest stretch from the table statistics: the
constant radius that lets an indexed search find candidates before the exact check
at the point). France keeps the same results: the values are the ones they meant
there (grid snapping 65 / 170 m, open-data duplicates 10 / 17 / 100 / 500 m and
900 m², search's town 10 km, sites' sizes 220,000 / 90,000 / 5,000 m², grid routing
5 / 40 / 65 km, a plant's substation 650 m). Checked on France in a rolled-back run:
the grid 272,670 lines (272,357 before), sites' importance within a few dozen.
The frontend's search merges the same name within 5 km on the ground
(`groundDistance`, core/geo.ts), not 0.05°. `distances.sql` is in `SCHEMA_FILES`,
run by builds and imports; a test fails if a build SQL file measures with a bare
number.

## Data layers: the layer list and the key in one panel (2026-11-06)

The Layers button opens **Data layers** (`fork/ui/data-layers.ts`); the Key button
is gone. Upstream's groups (Overlays, Infrastructure, Critical sites...) are
headings; each entry has its tick box and unfolds (▸) to the key sections of what
it draws, each key row with its tick box as before. A key section goes under the
entry of the same name, else the entry whose map layers its rows draw (by layer
prefix), else under "Other" (`assignSections`, tested). Statuses' key stays a key:
no tick boxes on its rows. Which entries are unfolded is kept in this browser.

Upstream's list is rebuilt when the address changes, so it isn't moved: the tick
boxes here call its switcher (`setVisibility`) and are redrawn from it (on opening,
on `hashchange`). The key is built once, so its sections are moved into the panel,
whose body keeps the class `oim-key-body` (the printed legend reads the rows there;
`keyRows` now finds them at any depth). "Show all" moved to the panel's header and
looks for the key's tick boxes anywhere on the page. Background stays in Settings.

Open data isn't a group of its own: the distribution and gas networks have no entry
and follow Power and Oil & Natural Gas (`modules/extra/follow.ts`: their map layers
take the category's visibility whenever the style changes); ICPE is under Critical
sites (groups of the same title from several modules are one: `mergeGroups` in
`fork/index.ts`). Search results of open data switch on Power (P) or Oil & gas (O)
instead of their old entries (X, Y; `schema/search.sql`).

## Satellite downloads all at once (2026-11-06)

`download_satellite` ran its steps one after another (Blue Marble, then Sentinel-2,
then the aerial photos), each waiting for the last though they come from different
servers and write different files. Now they all start together (`run_parallel` in
`lib/ui.sh`: one live line per step with its time and latest progress, then each
one's result); each still keeps its own server's speed limit and waits for a lost
connection on its own.

## The background map's colours (2026-11-06)

Upstream's background style draws most areas at the same lightness from zoom 6 on
(93%), told apart only by a faint tint: fields (farmland) were the very colour of
parks and grass, and towns, industry and hospitals another single one, so it was
hard to see where a town or a field stops. One palette now (`modules/map-sources/
palette.ts`, `PALETTE`), still pale and washed out (saturation 35% at most,
lightness 82–94%), a shade per kind of area: unmapped land 94% warm off-white,
fields 91% pale straw, grass and parks 88% soft green, woods 84% deeper green,
housing 89% cool grey, industry, shops and airports 87% mauve-grey, hospitals and
universities 90% pale rose, farmyards 88% tan, water 82% blue, sand, glaciers.
Zoomed out (zoom 2 to 6) each is 8% darker, as upstream's are. A paint override of
upstream's layers (style_base.ts unchanged); a test fails if one of them is renamed.

Buildings keep upstream's warm pinkish beige, a little darker (87% at zoom 12 to
81% at 16, so they stand out of the housing around them) and airports have their own pale blue-grey
(93%), lighter than the land, so the runways stand out as upstream's do. Roads
are white with a grey edge (74%) and footpaths a mid grey: upstream's light grey
roads (89%) stood out of its darker towns (82%) but were lost on this palette's
lighter housing (89%).
**Settings → Background** chooses *Map, high contrast* (this palette, the default),
*Map, original colours* (upstream's paint, restored from what the override saved) or
satellite imagery; the choice is kept in this browser (`services/map-colours.ts`,
`oim-map-colours`).

## Refactor 5: My layers' map tools split (2026-11-07)

docs/plans/refactor-5e.md. First a safety net: `map/tools.test.ts` (17 tests, a fake
map and renderer, a real store) for what clicking, dragging, scrolling and the
keyboard do, none tested before. Then `map/tools.ts` (768 lines) became the class
that wires the map's events and keeps what the rest of My layers calls (242), and
its parts in `map/tools/`: `drawing.ts` (points one click at a time, refusals,
finishing, the draft and ghost), `dragging.ts`, `resize.ts` (Shift + scroll),
`copy.ts`, `selection.ts`; they work on `ToolsContext` (`map/tools.types.ts`),
which `Tools` is. The tests didn't change.

Then the list: a safety net first, `ui/outliner/list.test.ts` (14 tests through its
outside only: what it draws, as a snapshot, the search, long layers, clicks,
renaming, the right-click menus, as a snapshot, drag and drop). `outliner/index.ts`
(849 lines) became the class keeping the list's state and drawing the tree (161),
and its parts: `rows/` (`item.ts`, `layer.ts`, `folder.ts`), `menus.ts`,
`editing.ts`, `drag.ts`, `footer.ts`, `widgets.ts`, on `OutlinerContext`
(`outliner/types.ts`), which the `Outliner` is. The snapshots didn't change; checked
in the browser too (a layer made, a line drawn into it, its menu).

## Refactor e: the backend's largest files split (2026-11-07)

docs/plans/refactor-5e.md. Each file moved as is first, then improved apart, each
step checked against the recorded answers (`tests/fork/test_answers.py`), all 1.5
million tower numbers (renumbered each time) and the grid check's list:
- `search.py` → `search/`: `matching.py`, `ranking.py`, `stations.py` (substations
  and plants, which were near-copies, now one `search_stations` with what differs
  in `STATIONS`), `places.py`, `features.py`, `towers.py`;
- `grid.py` → `grid/`: `route.py` (`find_node` and `route` cut into named steps),
  `line.py`, `tower.py`;
- `tower_numbers.py` → `tower_numbers/`: `numbering.py`, `labels.py`, `register.py`,
  `write.py` (`write` cut into its steps), `__main__.py` (`python -m
  src.fork.tower_numbers` as before);
- `line_trace.py` → `line_trace/`: `network.py`, `names.py`, `trace.py`, where
  `_continuing`'s 85 lines are now `RULES`, one small function per rule tried in
  order (a new rule is one more function).
What other files import keeps its name (each package re-exports it).

## The backend's answers, compared on the real database (2026-11-07)

`tests/fork/test_answers.py` (opt-in, `OIM_TEST_REAL_DB=1`): 50 questions to the
backend on the database built (18 searches, 10 routes, 12 lines, 10 towers, picked
the same way each time) and the 1.5 million tower numbers' fingerprint, recorded in
`data/test-answers/<region>.json` on the first run, compared on the next: the safety
net for splitting the backend's large files (docs/plans/refactor-5e.md). Its first
use found two answers that changed from one request to the next: a search's equally
ranked results (towers on the same line, "tower 5 graffenstaden") taken in the
database's order, which varies, and a route's pieces along parallel lines likewise.
Each search query now ends its order with the feature's id, and `build_graph` takes
the edges in their id's order. Later the same day the grid check (`grid_check.py`)
gave 222 or 223 loose ends from one run to the next: the network was loaded in the
database's order, so where two ways tie at a junction a different one could win.
`load_index` now loads the stretches by id (the tower numbers didn't change).

## A test for the fork's routes (2026-11-07)

The fork's routes come before upstream's (`main.py`), so a fork route at an address
upstream serves replaces it. `tests/fork/test_routes.py` lists the five meant
(`/about`, `/search/typeahead`, `/api/circuit|line|substation/{id}`) and fails on
any other shared address (same methods), or a fork mount covering an upstream
route: after a merge, a new upstream route the fork would hide shows up there.

## My layers' schema: numbered migrations (2026-11-07)

`userdata.sql` was run whole whenever its newest table was missing: it could add
tables, never change or drop anything (the statuses' tables were dropped by hand).
Now `userdata/migrations/NNN_name.sql`, run once each in order by `ensure_schema`
(under an advisory lock, so two requests don't both run them), each recorded in
`userdata.schema_version`. `001_userdata.sql` is the old file ("if not exists"
throughout, so a database from before migrations, version 0, runs it safely);
`002_no_statuses.sql` drops the statuses' tables and account right, also in a
database restored from an older export. Checked on a new empty database (13 tables,
versions 1 and 2) and on this one.

## Backend: upstream's Wikidata files untouched (2026-11-07)

The offline Wikidata cache (entity JSON and pictures from `scripts/fetch_images.py`)
was edits in upstream's `config.py`, `data.py` and `views/wikidata.py`. They're back
to upstream's; `src/fork/wikidata_offline.py` does the same by wrapping upstream's
functions when the fork's routes load (`install()`): `get_wikidata` reads the cache
first and gives None without a network, `get_commons_thumbnail` gives the picture
downloaded for the item being shown (`wikidata_json` wrapped to say which) and None
without a network. It replaces the functions where upstream defines them and where
it imported them (`views/wikidata.py`, `views/area.py`); a test checks they're the
same everywhere. The cache folders are in `src/fork/paths.py`.

## Statuses removed (2026-11-06)

The status system (docs/plans/feature-status.md) is gone, to be rebuilt simpler
later (SPECIFICATIONS 10.11): statuses of map features (the ⚠ status board, the
form, the badges on the map, the per-feature history and its playback, searching
by status), the power supply mode built on them (the grid's red, orange and "at
risk" colours, the grey of what's connected to nothing, My layers copies coloured
the same), Shift-click selection of map features (only used to set statuses) and
the "Can set statuses" account right. Gone: `modules/status/`,
`services/supply.ts`, `services/selection.ts`, the backend's `userdata/status.py`
and `grid_supply.py` (`/userdata/status*`, `/grid/supply*`), the "status" live
event, `search_statuses`. `userdata.sql` no longer makes `feature_status`,
`status_change` or `app_user.can_set_statuses`; a database that already has them
keeps them, unused (the code no longer reads or writes them).

## Aerial photos from zoom 12 (2026-11-06)

Every aerial source (`TIERS["detailed"]`, IGN's départements too) now starts at
zoom 12, a town on screen, instead of 14: scaled down, the photos are sharper and
truer in colour than Sentinel-2's 10 m there already (about 8% more). Files made
before get the two zooms without downloading anything: `lower-zooms` now takes any
imagery file (`--file fr-75.sat-detailed-fr_ign`; Sentinel-2's too) and
`--list-needed` lists aerial photo files starting above 12 as well as Sentinel-2's
starting above their area's lowest; `catch_up_lower_zooms` (was
`catch_up_regional`) runs it after every satellite download. Paris: 1 min 10 s.

## Refactors: the satellite menu, one rule for more detail, Background (2026-11-06)

- `satimagery/menu.py`: `command_choose` was one 320-line function (presets, the
  Sentinel-2 step, the tile sources, IGN's départements), where the menu's bugs
  came from. Now a `Planner` with a method per step (`presets`, `step_sentinel`,
  `search_area`, `world_zoom`, `area_zoom`, `step_aerial`, `choose_tile_sources`)
  and the prompts in `read_answer` / `ask` / `ask_numbers`.
- More detail later: one rule for every aerial source. A tile source's file used
  to get its new zooms in a second file (`…-z16-17.pmtiles`, `--minzoom`, an
  estimate "from zoom N"); now, like IGN's départements, the file is made again up
  to the new zoom and replaces the old one when finished (the zooms below are
  about a third more work). `detailed_file(folder, area, source)` is the one file.
- `fetch_images.py` and `extradata/cli.py`: each `main()` was 200 lines. Now a
  function per step (`wikidata_ids`, `step_entities`, `step_thumbnail_urls`,
  `step_images`) and per command (`command_offer`, `command_dedupe`,
  `command_remove`, `command_list`, `command_import` with `wanted_sources` and
  `import_source`; the duplicates total in one place, `total_duplicates`).
- `userdata/changes.py`: `apply_change` (117 lines) is now who may
  (`check_layer_access`, `check_feature_access`), what changes (`change_layer`,
  `change_feature`) and the history entry (`log_change`); the SQL is unchanged.
  Checked through the API (create, change, rename, delete, a missing geometry, an
  unknown change, changing a deleted layer) and in the change log. The other half
  of refactor 6, splitting `grid_supply.supply`, went with the statuses.
- Settings → Background is its own module (`modules/background/`): it chose the
  map's colours too but lived in `modules/satellite`. The choice is kept in
  `services/background.ts` (replacing `services/map-colours.ts`; what browsers kept
  is read the same), which `map-sources/palette.ts` and `modules/satellite` follow;
  the satellite module only draws the imagery and says what there is
  (`offerImagery`: its last zoom, where it covers). Strings `satellite.*` of the
  section became `background.*`.

## A download speed cap (2026-11-11)

`netsafe.RateLimit`: at most so many bytes a second for every download sharing it
(threads too), given to `fetch_file` (`limit=`). IGN's archives are fetched three
parts at once under one cap: `satellite.py bdortho --max-rate 10` (MB/s), default
`OIM_MAX_RATE`, else none. Measured: 4.00 MB/s asked, 4.00 MB/s got, on a line
doing 29.

## IGN's photos: Bas-Rhin, and what it taught (2026-11-07)

The first whole département (Bas-Rhin, 4,761 km², 251 images): 22.8 GB downloaded,
1.17 GB kept to zoom 17 (7.5 KB a tile, 245 KB/km²; Paris, all city, 11 KB), so the
menu's sizes now use 8 KB a tile (`WEBP_TILE_BYTES`): all of France to 17 is ~130
GB. Making its tiles on all 32 cores, `gdal raster tile` failed to write a tile
every few thousand ("Unable to create WEBP file", three tries in a row); with 8
threads (`TILE_THREADS`) it never did. A conversion that stops goes on where it was
(the reprojected image and the tiles made are kept).

## France's aerial photos from IGN's files (2026-11-06)

IGN's tile server blocked this computer after a thousand tiles (below), so France's
photos no longer come from it: `DETAILED_SOURCES["fr_ign"]` is `"files": "bdortho"`
and `satimagery/bdortho.py` downloads IGN's BD ORTHO, the files IGN publishes for
bulk use, one département at a time: the latest colour 20 cm edition from IGN's
download service (an Atom listing, `latest_edition`), its 7z archive in 4 GB parts
(3 at once, `netsafe.fetch_file`: resumed with HTTP Range, a connection closed
early is not taken for the end; each part checked against IGN's md5, fetched again
once if damaged), the JPEG 2000 images extracted (7-Zip, else in Docker) and the
archive deleted, then GDAL makes WebP tiles (quality 75) from zoom 12 to the zoom
asked (15 to 19), and the images are deleted. The tiles (`pipeline`): the images
reprojected into one image at the last zoom's resolution (`gdalwarp` on every core,
reading each JPEG 2000 at the reduced resolution it needs; JPEG inside, a
transparency band outside the photos), then each zoom straight from it with GDAL
3.11's `gdal raster tile` on every core (`TILER_IMAGE`), packed into MBTiles
(`pack`, with the tiles' bounds) for `pmtiles convert`. Paris to zoom 17: 1 min 30 s
in all. A virtual mosaic reprojected on the fly took over 15 min (every image read
whole at 20 cm), and tiles made from the zoom above failed (read while being
written). One file per département
(`fr-67.sat-detailed-fr_ign.pmtiles`): no copy of a whole country's file to make
at the end (which would need twice its size), a département already there is
skipped, and the work folder (`data/basemap/.bdortho-67/`) is kept between runs so
a stopped download goes on. The menu asks the zoom, then which départements of the
area (`departements.py`: the 96 of metropolitan France with their area, bounds and
Geofabrik region, made once from france-geojson's outlines). The tiers in
`VITE_SATELLITE_TIERS` now carry each file's bounds (from its header) and the
frontend gives them to its sources, so the map only asks the files that cover
what's on screen; the scripts sum the départements up as "IGN photos of N
départements". The partial download from IGN's tile server was deleted.

## A server that stops answering, the internet working (2026-11-06)

IGN's aerial photo server (data.geopf.fr, behind a web firewall) stopped answering
this computer altogether after about a thousand tiles at 20 a second: not even a
connection, while every other site answered. IGN documents no limit for its WMTS,
so it's the firewall's bot protection. The downloads took it for a lost connection,
waited 15 min and said "No internet connection". Now (`netsafe.py`, `lib/net.sh`,
the same rule): while waiting, a few big sites are checked (`INTERNET_PROBES`); if
they answer and the server hasn't for `NET_SERVER_GRACE` seconds (2 min), the
download stops at once with `ServerStopped`, exit status 76 (`SERVER_STOPPED`),
saying the server stopped answering this computer and to try again later; every
other thread stops with it, what's downloaded is kept. `run_parallel` also cuts
each live line to the terminal's width: a longer one wrapped, and the redraw left a
copy of it behind every second.

## Sentinel-2 from zoom 7 (2026-11-06)

For every area, Sentinel-2 is made from zoom 7 and shown from 7 at the earliest
(`TIERS["regional"]` from `sources/sentinel2.py`; `REGIONAL_FIRST_ZOOM` in lib/satellite.sh, which
clamps any file's range, a test keeping the two equal); further out, Blue Marble.
At zoom 5 or 6 a country is a patch of a few dozen pixels: not worth it. France's
file, made when it started at 5, keeps its zooms 5 and 6 unused (a few MB). Below:
how it got lower zooms at all.

## Sentinel-2 from zoom 5, at first (2026-11-06)

Sentinel-2 imagery started at zoom 9, under Blue Marble's 500 m pixels until then.
It now starts at zoom 5 (`TIERS["regional"]`): the download adds the lower zooms
(GDAL's overviews, a few hundred tiles more); GDAL stops where the whole area fits in
about one tile. Files made before get them with `satellite.py lower-zooms --region
ID`: their tiles read back from the local imagery server, the lower zooms computed
the same way, the file replaced once the new one is complete; nothing downloaded.
The imagery server (basemap service) caches each file's index: restart it after a
file is replaced.

The scripts do it themselves: `download_satellite` (satellite.sh, build-region.sh)
ends with `catch_up_regional`, which runs `lower-zooms` on any Sentinel-2 file still
starting above zoom 5 (with its outline), then restarts the imagery server.
satellite.sh runs it even when nothing new is chosen.

## Debug info; no Edit button (2026-11-06)

- **Debug** (`modules/debug/`): Settings → Debug → "Show debug info" (kept in this
  browser) shows a box at the bottom right, of a fixed size so it never moves or
  resizes as values change: zoom, centre, scale and metres per
  pixel, whether tiles are loading, how many style layers are drawn, the screen, and
  under the pointer its position and each feature there (style layer, tile layer,
  id).
- **The Edit button** (upstream's, bottom right: OpenStreetMap's online editors) is
  removed, with its code (see "Merging from upstream").

## No header: settings, print and the account among the map's buttons (2026-11-06)

- Upstream's header (title, about, stats, a paid export) is removed by the layout
  module (`document.querySelector('header')?.remove()`; index.html unchanged). The
  search box sits at the top left.
- At the bottom of the top-right buttons (`fork/ui/map-button.ts`, line icons from
  `fork/ui/icons.ts`, ordered with CSS `order`): **print** (the printer opens the
  print window, whether My layers is open or not), **Settings** (the gear: the
  app's settings only: background, map sources, accounts) and **your account** (the
  person: who is logged in, Log out, in the right-click menu's look).
- **About this map** opens from the map's credits (bottom right): the credits
  control is replaced by one with that link (`modules/layout/about.ts`), put back in
  the corner.
- **My layers' settings** (colour of new items, unit and graphic labels, bearings)
  are in their own window, opened only from My layers' ⚙ (no longer a section of
  Settings).

## My layers' panel, cleaner; dead code removed (2026-11-06)

- **The panel:** as tall as its content, down to the bottom of the left column
  (it was capped at 45% of the window); only the list scrolls. The header holds the
  title, the situation, ⚙ and ×. Search and a **Filter** button share a line (the
  chips show only when it's open; it says how many are on). A footer that doesn't
  scroll: + Layer, + Folder, import ⤓, export (the same arrow turned round).
- **Right-click menus** (`fork/ui/context-menu.ts`, `withContextMenu`; also the
  Menu key / Shift+F10, arrows to move, Escape to close): a layer's (draw into it,
  zoom, rename, lock, share, move to folder, export, delete) and a folder's (new
  layer in it, rename, lock its layers, export, remove the folder: its layers stay).
  The ⋯ menu is gone (clicking it also opened the layer, which redrew the list and
  closed the menu), and so are the row's lock, colour and folder buttons. Rows: an
  eye (`fork/ui/icons.ts`, crossed out when hidden), the name, 🔒 when locked, ✎
  where you draw, the count.
- **Settings:** My layers' preferences moved to the Settings window
  (`ui/preferences.ts`; ⚙ opens it there, `openSettings`): the colour of new items,
  unit labels ("Labels on the map" before), graphic labels, bearings.
- **No layer colour:** a layer no longer has a colour. What has no colour of its own
  is black (`DEFAULT_COLOR`); new drawings, markers, measurements and graphics get
  the colour chosen in Settings (`map/new-colour.ts`, kept in this browser). Layers
  saved with a colour keep it in their data, unused.
- **The typed author name, removed:** "Saved as" in My layers and "Set by" on a
  status (and `core/author.ts`). Every request comes from a logged-in account and
  the backend signed saves, situations and statuses with its name anyway; its
  fallback to a typed name is gone too.
- **Dead code removed:** unused helpers (`isSquare`, `labelOf`, `describeNorth`,
  `SECTIONS` and every field's `section`, `region_in`, `StreamReader`), styles of
  removed elements (the old menus' `menus.css`, the colour input, old panel classes),
  50 unused strings. Found by scans of exports nobody imports, CSS classes no code
  names, strings no code uses, Python (vulture) and shell functions never called.

## Setup scripts tidied; safe downloads (2026-11-06)

**Every download goes through one safe function.** Shell: `download URL FILE`
(`lib/net.sh`, curl, through `FILE.part`, resumed) and `safely URL command...` for
another downloading command (`pmtiles extract`). Python: `scripts/netsafe.py`
(`safely(call, url)`, `fetch(url)`), used by the satellite tiles and Sentinel-2's
GDAL pipeline, the extra data (Agence ORE, Géorisques, the départements) and the
Wikidata cache. What they do when a download fails:

- the server still answers (a drop, a busy server): tried again a few times;
- it doesn't: wait for the connection (checked every 15 s, `NET_CHECK_EVERY`) for
  up to 15 minutes (`NET_WAIT_SECONDS`), then go on where it stopped;
- a download that hangs (curl: under 1 kB/s for 2 minutes; pmtiles: its progress
  stops for 2 minutes, `run_with_timer --stall`) counts as failed;
- the connection doesn't come back: stop, keeping what's downloaded, with exit
  status 75 and "run again to go on". The build stops on the OSM extract; the
  background map, satellite imagery, extra data and Wikidata cache are skipped
  with a warning (the map works without them).

Small files fetched while asking the questions (`download --quick`: the Geofabrik
index, checksums, Protomaps' build list; extra data's estimates) are retried but
never waited for: the questions have an offline fallback.

The crash this fixes: the server hanging up mid-download (`RemoteDisconnected`)
wasn't caught, and the world's Blue Marble download stopped with a traceback.

**The scripts, easier to read** (behaviour, options and questions unchanged; the
real Luxembourg build, export and import pass):

- `build-region.sh` (977 lines, now ~900 with more comments): "what the build will
  do" at the top, every variable the steps share with its meaning; choices as
  `yes` / `no` / `ask` (one variable each: `--no-extra` was two flags); each step
  does one thing (`find_region_source`, `decide_download`, `check_space`,
  `check_docker_space`, `import_extra_data` split out of the steps that hid them);
  the long question steps split (`find_kept_extra_data`, `find_extra_offer`,
  `choose_extra_datasets`, `find_basemap_area`, `choose_basemap_detail`,
  `region_menu_line`).
- Shared helpers instead of copies: `choose_number` (every numbered menu),
  `room_for` (disk space), `banner` / `done_banner` / `duration`, `json_get` /
  `json_write` (manifests; 6 inline Python snippets gone), `pmtiles_header_byte`
  (3 copies), `run_schema` with each step's label (`SCHEMA_LABELS`).
- Building and importing share `fresh_database` (My layers and extra data saved,
  the wipe), `put_back_my_layers` and `restart_map_services` (`lib/db.sh`).
- Helpers moved out of `build-region.sh`: the Geofabrik index and lookups to
  `lib/geofabrik.sh`, the background map's download to `lib/basemap.sh`.
- Fixed on the way: a failing "Putting back the extra data" or "Numbering towers"
  stopped the build instead of warning (the warning was unreachable).
- Note: an extract download left unfinished by the old script (`.osm.pbf.part`)
  starts again; new ones resume from `.osm.pbf.new.part`.

## Code tidied (2026-11-06)

A pass over the fork's frontend for repeated logic and long files. Behaviour is
unchanged: today's exact values (arrow widths, path lengths, map scale, metres per
pixel, size snapping) were locked in `userlayers/locked-values.test.ts` first and
still pass.

- **Folders:** tactical graphics in `userlayers/graphics/`; shared state and
  registries (live updates, map mode, selection, supply colours, the print legend)
  in `fork/services/`, out of `ui/`. Folder rules in `structure.test.ts`.
- **One helper instead of copies** (`core/`): `geo.ts` (metres per pixel,
  degrees/radians, the Earth's circumference), `math.ts` (`clamp`), `colour.ts`
  (`parseHex`), `map-style.ts` (`geometryIs`), `storage.ts` (local storage read
  and written with the try/catch in one place; 8 files used their own). In My
  layers: `positionsOf` / `pointOf` (`model/shapes.ts`) for a geometry's positions,
  one distance-unit table, the mouse wheel's numbers named (`map/tools.constants.ts`),
  the arrows' flat-earth constants named (same formula: saved arrows depend on it).
- **Long files split:** `map/render.ts` (1187 lines) into `render.ts` (the
  Renderer), `layers.ts` (style layers), `geometry.ts` (pure geometry); the outliner
  into `ui/outliner/` and the card editor into `ui/editor/`, their longest
  functions (a 340-line `buildEditor`, a 203-line `layerRow`) broken into named
  parts.
- **Types and constants in small files** next to their code (`X.types.ts`,
  `X.constants.ts`): render, tools, fields, sidc, labels, graphics, palette,
  formats, api, measure ticks and features, supply, grid route.

## Printing reworked: the map fills the page (2026-11-05)

The map took about a third of an A4 page: it was the screen's picture (twice as wide
as tall) fitted in a much squarer box, under 10 mm margins, a header and a footer
for a line each, and a 62 mm legend column even for two entries.
- **The page** (`layout.ts`): the map fills it but quarter-inch (6.35 mm) margins,
  what nearly every printer can print to (lasers about 4 mm, inkjets 3-5), so at
  actual size nothing is cut off; the written scale holds only at actual size
  ("fit to page" shrinks it, the bar shrinks with the map), which the box says
  under the scale. A box over the map's bottom-right corner
  (about a fifth of the page wide, only as tall as it needs, at most 70 % of the
  map) has the title, when and by whom, the legend (what doesn't fit: "…and N
  more"), the scale and its bar, the centre and its MGRS, the credits (`parts.ts`
  `drawInfo`, laid out twice: measured, then drawn). North in the top-right corner.
  About 90 % of the page is map.
- **What's printed** (`printedArea`): the biggest area of the paper's map's shape that
  fits on the map on screen, a little in from its edges, at the screen's zoom.
  While the print window is open, a frame shows it and dims the rest (`frame.ts`);
  the window is no longer modal (`makePanel`, floating top left), so the map can be
  moved and zoomed under the frame. Paper and orientation change the frame.
- **Sharper**: drawn again at 300 dpi for the paper (`printRatio`: `setPixelRatio` up
  to what the graphics card can draw, 8192 px a side at most) and cropped to the
  frame (`images.ts` `capture`). A4 landscape: 3358 × 2330 px. The map's WebGL canvas
  is read with `toDataURL`, then cropped: `drawImage` straight from it swapped red
  and blue with some graphics drivers (friendly light blue symbols printed yellow).
- `makeModal` (`fork/ui/panel.ts`) is Settings' only.

## Unsaved changes in IndexedDB (2026-11-02)

My layers' unsaved changes (and their bases) were kept in localStorage, which
holds about 5 MB per site: a big imported file went past it, and the copy was
silently not kept. `userlayers/state/local.ts` now keeps them in IndexedDB
(database `oim-userlayers`, written 300 ms after the last edit and at once when
the page is hidden or closed); localStorage where there's no IndexedDB. The first
time, what localStorage had is moved over. They're read back at the store's first
`load()`, and nothing is written before: an edit made meanwhile would have
overwritten them (both are kept, the older first). When they can't be kept
(storage full or blocked), the My layers panel says so: Save now. Tested: a 3 MB
GPX-size import kept across a reload; an old localStorage copy moved over.

## The map mode (2026-11-02)

`fork/services/map-mode.ts`: one tool at a time takes the map over. `mapMode.enter({name,
cursor, doubleClickZoom, click, dblclick, contextmenu, mousemove, keydown, exit})`
gives it the map's events (right-click without the browser's menu), the cursor and
double-click; Escape ends it (unless its `keydown` uses the key); entering a mode
ends the one before (its `exit` runs). Meanwhile upstream's click router opens no
feature details: `mapMode.install` wraps its `handleClick` once (fork/index.ts),
replacing the wrappers measuring and My layers each had, and `claimClicks` lets a
module keep some clicks without a mode (My layers, on its own items). My layers'
drawing, placing and measuring tools are modes. Replaces `ui/map-clicks.ts`.

## My layers: kinds of item (refactor, 2026-11-02)

What each kind of item is (symbol, graphic, image, marker, drawing, copy) was
spread over a dozen `kind === ...` tests (the map, the list, the card, the history,
files). Now each kind is a file in `userlayers/kinds/` (`ItemKind`, `kinds/types.ts`)
saying how it's named, drawn (standard, graphic or copy), its icon and how that's
drawn (`images`: prefix and maker; `map/icons.ts` adds them to the map by prefix,
replacing `ensureImage`'s list in `symbols.ts`), its thumbnail, what the card
offers (size, colour, line width, military fields), whether it moves, its filter
chips. The rest asks `kindOf(properties)`. No change in behaviour; a new kind is a
file and two lines (recipe in `docs/ARCHITECTURE.md`). Left as they are: the
toolbar's tools (they make items) and the card's MIL-STD fields (they depend on the
symbol code, not the kind).

## My layers' list, polished (2026-11-05)

- **Fixes:** a folder's 🔒 only locks your own layers (only an owner may lock: the
  others were refused at Save) and is greyed out when there's none; while a
  situation is shown, a folder's + and ✎ are greyed out (they changed the live
  layers); counts in the singular ("1 layer"): `tn()` in `fork/core/i18n.ts` (i18next
  plurals, `key_one` / `key_other` in en.json; `scripts/fork-strings.mjs` collects
  both forms), used wherever "(s)" was.
- **Search** also finds layers and folders by name (then all their items).
- **Order:** drag a layer above or below another (the row shows where); the order is
  yours (`personal.ts` `order`; new layers first, newest first) and the map draws the
  layers in it, the top one on top (`Renderer.orderOf`, `layerOrder` in the outliner;
  map layers moved only when the order or the layers change).
- **Names typed in place:** double-click a layer's or folder's name, or Rename,
  ✎, a new layer or folder (named "New layer", "New folder 2"... ready to type); no
  more pop-up boxes.
- ⋯ → **Zoom to its items**; the place to drop a layer out of its folder shows only
  while one is dragged; a layer shows its first 200 items ("Show the other N"), so a
  big import doesn't make every change slow; rows are reached with Tab, Enter opens or
  selects, the focus survives the list being drawn again.

## My layers: drawing on the map, polished (2026-11-05)

- **While drawing** a line, an area or a graphic, a dashed line goes on to the cursor
  (an area: and back to its start), without a point at the cursor
  (`Renderer.draft(points, closed, cursor)`).
- **A graphic being drawn** (an arrow, a boundary...) shows as it will look once
  done, faint, through the points so far and the cursor, once it has enough points
  for a shape (an arrow: two): the same drawing as finished graphics
  (`Renderer.graphicDraft`, `graphicSpecs` with an opacity), at most once per frame.
- **Shift + scroll** while placing a marker, a symbol or a picture: its size (10 % a
  notch, within the resize handle's limits); while drawing an arrow: its width (a
  factor of the automatic one, a fifth of its length, so it keeps growing with it).
  The preview follows and the hint shows the size. Without Shift the map zooms as
  before. (`Tools.wheel`: a capturing wheel listener on the map's container, before
  MapLibre's own; Shift turns the wheel sideways in most browsers, so either axis.)
  The same on an item selected on the map (one, which you may change): a marker,
  symbol or picture's size, an arrow's width in metres; shown as it changes
  (`renderer.preview`), kept as one change 0.5 s after the last notch, or at once on
  a click, another selection or another tool (`Tools.resizeSelected`, `keepResize`).
- **Right-click** opens only the quick-actions menu: the item isn't selected and its
  card stays closed (Rename opens it; Delete deletes that item).
- **While placing** a marker, a symbol or a picture, it shows faint under the cursor
  (`Renderer.ghost`, an overlay kept with the draft); range rings show as a draft.
  Both go when the mouse leaves the map or the tool changes.
- **Hints:** every drawing tool says how to take a point back (Backspace) and start
  again (right-click); placing tools that right-click stops.
- **Names for people:** the kinds' labels (`ItemKind.what`, the list, the tooltip, the
  card) are "Marker", "Line" or "Area", "Picture", "Distance: …"; the lower-case
  words stay for sentences (`noun`).
- **The card** shows the item's own small picture in its header (not only symbols).
- **The right-click menu** has Lock / Unlock.
- **The selection shows the item itself.** A graphic glows under its own lines (a
  `_highlight` line layer first in each graphics source's layers, filtered on the
  selected `fid`s: `Renderer.highlightGraphics`), not a line through its control
  points; a picture, symbol or marker gets a thin box around its image
  (`Renderer.outline`, worked out on screen like the resize handle) instead of a
  circle; the box and the resize handle fit the image's visible pixels, its empty
  margins left out (`visibleBox`, cached per image: a hostile diamond's square
  image is mostly empty).
  Every handle (points, size, an arrow's width) is the same yellow.
- **Dragging moves the item**, not only its highlight: every drag (a point, an
  item's point, a size, a width) redraws it as it goes (`renderer.preview`); it's
  saved on mouseup as before.
- **A selected line, area or graphic moves whole** when dragged by its body (not a
  point handle), like a symbol; the cursor shows it (`dragging.move`, `translateGeometry`).

## The header and the about page (2026-11-03)

- **Removed from the header** (`fork/modules/layout/index.ts`, at start, so
  `index.html` keeps upstream's): "stats" (upstream's statistics of OpenStreetMap's
  completeness by country, for its contributors; a power plant's own page, linked
  from its details, stays) and "export (online)" (a paid online export; the map has
  its own, My layers' Export).
- **The about page** (`web-backend/src/fork/about.py`, replacing upstream's at
  `/about`, which described the public website): what this map is; its data
  (region, OpenStreetMap extract date, build date and source, version: the
  `oim_build_info` table; the outside datasets with items, import date, licence:
  `extra.source`; Wikidata entries kept offline); how to use it (search, the
  buttons, My layers' keys); credits and licences. Its template
  (`fork/templates/fork_about.html`) is found first, then upstream's for the layout
  (`_base.html`), with upstream's filters. Upstream's footer (with its export link)
  is left as is: it's in upstream's layout.

## One look for the panels; Settings

Upstream's controls each had their own look and placement: the layer list opened
while the pointer was over its button, level with it and over the other buttons;
the key opened over the buttons too; the Map sources panel was another button.

- **Right-hand dock** (`web/src/fork/ui/dock.ts`): Layers, Key and My layers open
  **on click** (again to close), next to the buttons rather than over them, one at
  a time, as tall as the map allows and scrolling inside. The open panel's button
  is outlined. Upstream's key and layer list are moved into the dock as they are
  (the layer list's hover handlers are removed), so their code is unchanged.
- **Shared look** (`web/src/fork/ui/panel.css`, `panel.ts`): every panel, left or
  right, has the same light grey title bar with square buttons (×, –), the same
  section titles and a body that scrolls, after the feature details panel.
- **Search box in the top bar** (`web/src/fork/modules/layout/search-bar.ts`): upstream's
  search control is moved out of the left column to just right of the header
  (kept there on screens 720 px and wider; narrower, it stays on the left). It sets
  `--oim-top-bar-left` on the map container: My layers' toolbar and symbol picker
  stay centred on the map, moved right only as far as it takes to clear the search
  box (the panel measures the toolbar: `--oim-ul-toolbar-half`). No upstream file changed.
- **Settings** (`web/src/fork/ui/settings.ts`): a "settings" link in the header,
  after about / stats / export, opens a window with the map sources (background
  map tiles, Photon), which used to have their own map button. Escape, × or a click
  outside closes it.

---

## One look for what's on; selections and statuses (2026-11-05)

- **`oim-on`** (`fork/ui/panel.css`): the one look for anything chosen, switched on
  or selected, app-wide: a highlighted background (`--oim-on-background`, the map
  selection's yellow), the border, text and size unchanged (nothing moves). It
  replaces each module's own: My layers' chips (status, identity, filters,
  palette groups), identity frames, tool and toolbar buttons, the selected item in
  the list; the status board's counts; the grid route's chosen path. Not the map's
  buttons on the right: the open panel's keeps its dark ring (`oim-dock-active`), a
  coloured background would hide its icon. The layer you draw into keeps its blue
  row: it means something else ("drawing here").
- **Range rings and measurements** selected glow under their own lines and rings
  (`_m_highlight` in each measurement source, like graphics' `_g_highlight`;
  `Renderer.highlightItems`), not a circle at their centre.
- **Copies stay at every zoom** (`withoutMinZoom` in `copyLayers`): a copied
  plant, substation or line keeps the original's look, but the original's "only
  once zoomed in" conditions (small plants, low voltages) are left out of its
  filter; its other ones (a point while zoomed out, the area closer) are kept.
  Upstream's own layers still thin out when zoomed out.
- **A click on a status opens its feature** (`modules/status/click.ts`): zoomed
  out, a substation is drawn as a point while its status still outlines its area,
  and a click inside the outline hit nothing. The feature is found among what's
  drawn (same tile layer and id) and handed to the click router; the pointer is a
  hand there. Not drawn at all (its layer off in the layer switcher, e.g. Power):
  its layer is switched on, as when a search result is picked (`switcherLayersFor`),
  and it opens once drawn.
- **The coordinates** are next to the scale, bottom left.
- **Place names when zoomed in** (`modules/map-sources/labels.ts`): upstream shows
  town names up to zoom 12 and neighbourhood names at 13-14 only (online, the
  OpenStreetMap layer took over), so close in nothing said where you were. Town,
  village, hamlet and neighbourhood names now stay at every zoom (neighbourhoods
  from 13). Field names are never shown: OSM's place=locality (the cadastre's
  lieux-dits, "Holzweg", "Im Tal", dozens per village, very many in Alsace), which
  the background map files with towns as `kind_detail` "locality"
  (`LOCALITY_FILTER`, set on each style load).
