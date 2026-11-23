# Plan: splitting the largest files (refactor 5: My layers; refactor e: the backend)

Status: **done** (2026-11-07): refactor e, then refactor 5 (docs/FORK_CHANGES.md). Nothing changes for whoever uses the
map: the same behaviour, in smaller files, each about one thing. Done one file at a
time, each its own commit, with the tests below passing before and after.

## The rule for both

1. **A safety net first.** Where behaviour isn't tested yet, tests that record what
   it does today, written and passing *before* anything moves. They're the proof
   nothing changed.
2. **Move, don't rewrite.** Code moves into new files as it is; improvements (a
   duplicate merged, a long function cut into steps) are separate commits after,
   each with the net still passing.
3. **The outside stays the same.** What other files call keeps its name and
   signature, so callers don't change.
4. Docs (ARCHITECTURE, FORK_CHANGES) updated with each step.

## Refactor 5: My layers (frontend)

### What's there

| File | Lines | What it does | Tested today |
|---|---|---|---|
| `userlayers/map/tools.ts` | 768 | One class, `Tools`: what a click does on the map in every mode: select, place a symbol, draw a line / area / graphic, copy a map feature, drag a symbol or a point, resize with the handle or Shift + scroll, the keyboard (Delete, Escape) | only its small helpers (`map/geometry.test.ts`); the clicking, dragging and keys not at all |
| `userlayers/ui/outliner/index.ts` | 849 | One class, `Outliner`: the whole list: folder, layer, group and item rows, renaming in place, drag and drop, the right-click menus, the filter chips, the buttons under the list, keyboard focus | search and filters (8 tests), grouping (3) |

Four files use `Tools` (`index.ts`, `ui/workspace.ts`, `map/interactions.ts`, the
outliner through actions): `setTool`, `select`, `toggle`, `selectAll`, `selection`,
`refreshSelection`, `deleteSelected`, `capturesClick`, `enabled`, `tool`,
`selected`, `message`, `onChange`. The sidebar uses `Outliner`'s `el`, `footer`,
`draw()`, `startEditing`, `newFolder`. These stay as they are.

### Step 0: the safety net (about half the work)

- **Tools.** A fake map (it only needs `on`, `getContainer`, `queryRenderedFeatures`,
  `project`/`unproject`, `getCanvas`) and a real `Store`, to drive what a person
  does, in happy-dom like the other tests, and check what the store ends up with:
  place a symbol; draw a line (clicks, double-click); draw an area, and one whose
  outline would cross itself (refused, with the message); a graphic with its
  minimum and maximum points; select, then drag a point; drag a whole item; resize
  with the handle and with Shift + scroll; Delete; Escape while drawing; Shift-click
  to select several; tools off while the history is shown.
- **Outliner.** A `Store` with folders, layers (one shared, one locked), and items
  of several kinds; `draw()`'s list written down (row kinds, names, counts, what's
  folded) and compared; then the actions: rename (Enter, Escape), drop an item on a
  layer, a layer above another and onto a folder, each menu's entries for an owner
  and for someone with view access only, keyboard focus kept across a redraw.
- A run in the browser of the scripts used so far (draw, select, drag, list), for
  what happy-dom can't show.

### Step 1: `map/tools.ts`, split by what each part does

`Tools` stays the one class callers know; it wires the map's events and hands each
to the part that deals with it. The parts don't import `tools.ts` (they get what
they need: the map, the store, the renderer, the shared state), so nothing loops.

| New file | What moves there | ~lines |
|---|---|---|
| `map/tools.types.ts` | `Tool` and the drag state (the rule: types in `X.types.ts`) | 50 |
| `map/tools/drawing.ts` | adding points (lines, areas, graphics), `finishDrawing`, the draft and ghost, `cancelDrawing`, closing an area, the crossing check | 250 |
| `map/tools/dragging.ts` | `mousedown` / `mousemove` / `mouseup`: moving a point, a whole item, the resize handle | 150 |
| `map/tools/resize.ts` | Shift + scroll and the handle's size: `wheel`, `resizable`, `resizeSelected`, `wheelPixels` | 90 |
| `map/tools/copy.ts` | copying a map feature into the layer (`copyAt`) | 50 |
| `map/tools/selection.ts` | select, toggle, select several, draw the selection, delete it | 60 |
| `map/tools.ts` | the class: events in, the click and key dispatch, the tool's hint | 150 |

### Step 2: `ui/outliner/index.ts`, split by kind of row and by job

The rows become functions that build a row from what they're given (the store, the
actions, your personal settings, the outliner's state, a `redraw`), next to the
small files the outliner already has (`filter.ts`, `groups.ts`, `order.ts`).

| New file | What moves there | ~lines |
|---|---|---|
| `outliner/rows/item.ts` | an item's row, its thumbnail, Shift-click ranges | 90 |
| `outliner/rows/layer.ts` | a layer's row, its label, the "shared" tag, its items and their groups | 230 |
| `outliner/rows/folder.ts` | a folder's row; folder names; moving a layer into one; a new folder | 90 |
| `outliner/menus.ts` | the right-click menus of layers and folders, export entries | 90 |
| `outliner/drag.ts` | drop targets, the "out of the folder" row, placing a layer | 80 |
| `outliner/editing.ts` | renaming in place, a free name for a new layer or folder | 60 |
| `outliner/footer.ts` | the buttons under the list, the filter chips | 80 |
| `outliner/index.ts` | the class: its state, `draw()`, the tree, focus | 200 |

Estimate: about a day, half of it the safety net.

## Refactor e: the backend's large files

### What's there

| File | Lines | What it does | Tested today |
|---|---|---|---|
| `grid.py` | 489 | three features in one file: routes between two stations (`/grid/route`), a line's details and where it goes (`/grid/line`), a tower's details (`/grid/tower`) | 25 tests |
| `search.py` | 410 | the search box: one search per kind (substations, plants, places, named features, towers), the ranking, the route | 14 |
| `tower_numbers.py` | 390 | numbering towers along their lines (a build step) and keeping the numbers people saw (the register) | 11 |
| `line_trace.py` | 376 | following a line through the network (used by the three above and by `circuits.py`, `grid_check.py`) | 27 |

What other files import keeps its name: `line_trace`'s `load_index`, `trace_line`,
`GridIndex`, `Trace`, `line_ends`, `place`, `voltages_of`, `CIRCUIT`; the routes
lists; `python -m src.fork.tower_numbers` (the build calls it) and `python -m
src.fork.grid_check`.

### Step 0: the safety net

The unit tests are good; what's missing is the answers as a whole. An opt-in test,
like the scripts' real build (`OIM_TEST_REAL_DB=1`), asks the real database's
backend a fixed list of questions and compares the JSON with what it answered
before: about 20 searches (a substation, a plant, a town, a tower "23 marlenheim",
an ICPE site, nonsense), 10 routes (near, far, through a 65 kV access leg, none
possible), 10 lines and 10 towers. Answers saved once before the refactor; the
same after each step. Tower numbering: its output for France compared row by row
(the register's numbers must not move).

### The steps, from the most separate to the most delicate

1. **`search.py` → `search/`**: `ranking.py` (how well a name matches, the order of
   results: `name_match`, `match_rank`, `plain`, `result_tier`, `sort_key`,
   `PLACE_ORDER`), one file per kind (`stations.py`, `places.py`, `features.py`,
   `towers.py`), `__init__.py` (the route, the query's parameters). Then, apart:
   `search_substations` and `search_plants` share 28 of their ~41 lines: one
   function, the table and what differs as parameters. `indexes.py` stays in step
   with it (its test checks).
2. **`grid.py` → `grid/`**: `route.py` (finding the stations, the backbone graph,
   access legs, several distinct paths, describing a route), `line.py` (a line's
   details), `tower.py`, `__init__.py` (the routes). Then `find_node` (53 lines) and
   `route` (63) cut into steps.
3. **`tower_numbers.py` → `tower_numbers/`**: `numbering.py` (the pure part: the
   start station, a line's name, numbering along it, labels), `register.py`
   (keeping the numbers people saw), `write.py` (writing them: `write` is 93 lines,
   cut into its steps: the search text, the towers' places, the register's numbers
   and the new ones), `__main__.py` (so `python -m src.fork.tower_numbers` still
   works).
4. **`line_trace.py` → `line_trace/`**, last: it's what everything follows.
   `index.py` (the network in memory: `Edge`, `Node`, `GridIndex`, loading it, its
   version), `trace.py` (following a line). `_continuing` (85 lines) is a list of
   rules tried in order (a way already taken, an open end, a tap, a way starting
   here, the way into a station named after the line, the straightest): each rule
   becomes a small function with its name, tried in order, so a new rule is one
   more function.

Estimate: about a day; the database comparison is what makes it safe.

## Order

Refactor e first (better tests already, the answers can be compared exactly), then
refactor 5. Either can wait; neither blocks other work.
