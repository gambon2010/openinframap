# Plan: My layers, version 2 (tactical graphics, layout, symbol details)

Status: plan (2026-10-30). Nothing is implemented yet.

## 1. ODIN's "actions": tactical graphics

What ODIN offers (read from its MIL-STD-2525C catalogue, `src/renderer/symbology/2525c.json`):

| Kind | Count in ODIN | In our My layers today |
|---|---|---|
| Point tactical graphics (checkpoints, task points, fire support points...) | 199 | none: left out of our catalogue |
| Lines (phase lines, boundaries, obstacles...) | 66 | none |
| Areas (assembly areas, objectives, fire support areas...) | 73 | none |
| Arrows and corridors (axis of advance, direction of attack, block, breach, bypass, canalize...) | 43 | none |
| Shapes from a few points (circles, rectangles, "task" graphics like clear, contain, seize) | 12 multipoint + 34 special | none |

**Points:** `@syncpoint/signs`, which we already use, draws 361 point tactical
graphics; our catalogue script just skipped them. Adding the 199 ODIN offers is a
catalogue change only (`scripts/make_symbol_catalog.py`).

**Lines, areas, arrows:** checked `@armyc2.c5isr.renderer/mil-sym-ts` 2.10.9
(Apache-2.0, the US Army C5ISR renderer, updated 2026-10-23):

- It renders MIL-STD-2525 D and E (not C), including all multipoint control
  measures, as GeoJSON (or SVG) from the points you click, with labels.
- It includes a 2525C → 2525D lookup (`C2DLookup`). **All 228 of ODIN's
  line/area/arrow/multipoint graphics map to a 2525D code, and each mapped code is in
  its 2525D tables** (checked against the package's data, without running it). All
  199 point graphics map too.
- Size: the browser build (`mil-sym-ts-web`) is a 7.4 MB script, 1.4 MB gzipped,
  loaded only when the graphics palette is opened (like signs is now).

So we don't need to write our own renderer. Remaining risk, for a short spike before
building on it: actually render a handful (axis of advance, phase line, assembly
area, block, breach) in the browser and check the output fits MapLibre (GeoJSON lines
and polygons plus label points), and how it behaves when a point is dragged.

If the spike fails, the fallback is our own renderer for the graphics people use
most, following the same approach as ODIN (geometry built from the control points:
arrow heads and tails, corridors of a given width, teeth along obstacle lines) but
written from the standard's drawings, not from ODIN's AGPL code.

Storage: a graphic is a feature with `kind: 'graphic'`, its SIDC (2525C as in ODIN,
converted to D only for drawing), its control points as the geometry, and its
modifiers. The rendered GeoJSON is computed in the browser and not stored.

## 2. Layout (agreed)

- **My layers panel, three tabs: Layers | Add | History.**
  - *Layers:* one row per layer: eye (show/hide), colour, name, item count, ⋯ menu
    (rename, colour, export, delete). Expanding a layer lists its items; clicking
    one selects it and zooms to it. The active layer (where new items go) is
    marked.
  - *Add:* icon buttons Symbol, Graphic, Picture, Marker, Line, Area, Copy from map.
    The symbol/graphic picker: search box, category chips, "recently used" row;
    standard identity as the four frame shapes (friend/hostile/neutral/unknown),
    present/planned as a toggle.
  - *History:* opens the timeline bar (below) and lists saves.
- **Unsaved changes:** a bar at the bottom of the panel only while there are any:
  "3 unsaved changes · Discard · Save".
- **Tool hints** as a small note at the bottom centre of the map ("Click to place ·
  Esc to stop").
- **History playback** in a bar along the bottom of the map: play/pause, speed,
  step back/forward, a slider, and the current step's description.
- **Editing** in the left side panel, like the details of any map feature (below).

## 3. Symbol details (ODIN's descriptive fields)

ODIN shows, per kind of symbol, the MIL-STD-2525C text and graphic modifiers. These
come from the standard (letters in brackets), so we implement them from it:

| Section | Field | Units | Equipment | Installations | Activities | Graphics |
|---|---|---|---|---|---|---|
| Identity | Standard identity: pending, unknown, assumed friend, friend, neutral, suspect, hostile, joker, faker | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Status: present / planned (and operational condition: fully capable, damaged, destroyed, full to capacity) | ✓ | ✓ | ✓ | ✓ | present/planned |
| | Echelon (team ... army group); headquarters, task force, feint/dummy | ✓ | | | | |
| | Mobility (wheeled, tracked, towed, rail, amphibious...) | | ✓ | | | |
| Labels | Name / unique designation (T) | ✓ | ✓ | ✓ | ✓ | ✓ (also T1) |
| | Higher formation (M) | ✓ | | ✓ | | |
| | Type (V), quantity (C) | | ✓ | | | |
| | Additional information (H) | ✓ | ✓ | ✓ | ✓ | ✓ |
| | Staff comments (G) | ✓ | ✓ | ✓ | ✓ | ✓ |
| Assessment | Reinforced / reduced (F) | ✓ | | | | |
| | Evaluation rating (J): reliability A–F, credibility 1–6 | ✓ | ✓ | ✓ | ✓ | |
| | Combat effectiveness (K) | ✓ | ✓ | ✓ | ✓ | |
| Time | Date-time group (W) | ✓ | ✓ | ✓ | ✓ | |
| | Effective from / to (W, W1) | | | | | ✓ |
| Movement | Direction of movement (Q, degrees: drawn as an arrow) | ✓ | ✓ | | ✓ | |
| | Speed (Z) | ✓ | ✓ | | ✓ | |
| Geometry | Altitude / depth (X, X1) | | | | | ✓ (airspace) |
| | Width, radius, length (AM), attitude (AN) | | | | | ✓ (corridors, circles, rectangles) |
| Position | Coordinates (lat/lon; MGRS once that's added) | ✓ | ✓ | ✓ | ✓ | |

How it would work here:

- **Editor in the left side panel** when one of your items is selected: the symbol
  at the top (live preview), then collapsible sections Identity, Labels,
  Assessment, Time, Movement, Geometry, Position. Only the fields that apply to that
  kind of symbol are shown (the table above). Plus our own: layer (move to
  another), size, notes, delete.
- **Drawn on the map:** the label fields appear around the symbol where the standard
  puts them (signs draws point-symbol modifiers; mil-sym-ts draws graphics' labels).
  A map setting chooses how much is shown: none / name only / all, since full labels
  clutter a zoomed-out map.
- **Stored** in the feature's properties (`modifiers: {T: ..., M: ..., W: ...}`, plus
  the identity in the SIDC as now), so saving and the change log need no change;
  the history step then says what changed ("Changed "2nd Bn": status planned →
  present, higher formation").
- **Effective from/to and date-time group** become the base of the "time on items"
  backlog item (a timeline that shows the situation at a chosen date).

## 4. Order of work

1. Point tactical graphics in the catalogue (small).
2. Spike: mil-sym-ts multipoint rendering in MapLibre.
3. Layout rework (tabs, save bar, hints, history bar).
4. Details editor in the left panel, with modifiers drawn on the map.
5. Graphics tool (click control points, drag to edit) on top of the spike.
