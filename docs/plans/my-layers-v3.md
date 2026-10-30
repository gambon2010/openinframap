# Plan: My layers, version 3 (a rework of the whole panel)

Status: proposal (2026-10-30), nothing built. Version 2 followed ODIN's panels
closely; the owner never liked that part of ODIN. This reworks the panel around
what people do with it rather than around the data model.

## 1. What's wrong now

What people do, most often first: **look** at the situation (what's this, where's
that unit, what changed), **update** it (move a unit, change its status, add a
note), **add** things (a symbol, an arrow, an area), and less often **organise**
(layers, visibility) and **review** (history).

How the current panel serves that:

| Problem | Where it hurts |
|---|---|
| Two panels on opposite sides: the list and tools on the right, the details on the left. The eye jumps across the map; both cover it. | Every edit |
| Tabs split by implementation (Layers / Add / History), not by task. Adding something means leaving the list; the list is gone while adding. | Adding, looking |
| The details are a long form of the standard's fields, mostly empty, in the standard's categories. Values are shown as codes (B2, 301200ZOCT26). | Looking, updating |
| Identity is three dropdowns; the result is only visible on the map. | Updating |
| Items in the list are text only: no symbol, no status, no time; no search or filter. With 50 units the list is useless. | Looking |
| The picker lives in a narrow panel: one column, lots of scrolling, categories named after the standard ("Command, control and manoeuvre"). | Adding |
| No undo. A wrong drag needs Discard, which throws away everything unsaved. | Every edit |
| One item at a time: no multi-select, no bulk change, no copy/paste. | Updating |
| History is a separate mode that takes over the panel. | Reviewing |

## 2. Principles

1. **One place.** Everything about My layers in one sidebar, on one side, with the
   map kept clear. Tools that act on the map sit on the map.
2. **Read first, edit second.** Selecting shows what's known, in words, compactly.
   Editing is one click on the value.
3. **Show only what's used.** Empty fields don't exist until added.
4. **Visual, not codes.** Identity, status, echelon chosen by seeing them.
5. **Direct manipulation.** Most changes happen on the map (drag, right-click,
   double-click), the sidebar is for what can't.
6. **Safe to try.** Undo / redo for everything not yet saved.

## 3. Layout

```
┌───────────────────────────────┐   ┌──────────────── map ────────────────────────┐
│ My layers            ↶ ↷  ⋯ ✕ │   │        ┌────────────────────────────────┐   │
│ ┌───────────────────────────┐ │   │        │ ↖ ⬚ ➚ ╱ ▱ T 🖼 ⧉ │ Grid ▾ │ 3 ● Save│   │
│ │ 🔍 Search…   [Hostile][Pl]│ │   │        └────────────────────────────────┘   │
│ └───────────────────────────┘ │   │                                             │
│ ▾ 👁 🔓 ■ Grid            12  │   │                                             │
│     [▣] 2nd Bn       Hostile  │   │                                             │
│     [▣] 1st Coy      planned  │   │                                             │
│     [➚] OBJ LION     attack   │   │                                             │
│ ▸ 👁 🔒 ■ Logistics        4  │   │                                             │
│ ▸ ◌ 🔓 ■ Old plan         9   │   │                                             │
│ + New layer                   │   │                                             │
│───────────────────────────────│   │                                             │
│ [ large symbol ]  2nd Bn      │   │                                             │
│   Infantry battalion · Grid   │   │                                             │
│  (◆ Hostile)(Present|Planned) │   │                                             │
│  echelon: ∅ • •• | || [|||] X │   │                                             │
│  ┌ HQ ┐ ┌ TF ┐ ┌ Dummy ┐      │   │                                             │
│ Higher formation  1st Bde  ✎  │   │                                             │
│ Seen       30 Oct 12:00 · 2h  │   │   ┌──────── history (when open) ────────┐   │
│ Moving     NE · 20 km/h       │   │   │ ⏮ ◀ ▶ ▶| ⏭ ──●──────── 12/40 …       │   │
│ Notes      Spotted by patrol… │   │   └─────────────────────────────────────┘   │
│ + Add detail                  │   └─────────────────────────────────────────────┘
└───────────────────────────────┘
```

- **The sidebar** (left, where feature details already open): an *outliner* on
  top (layers and their items) and an *inspector* below (the selection). When
  nothing is selected, the outliner takes the whole height. On a small screen the
  inspector slides over the outliner with a back arrow.
- **The toolbar** (top of the map, centred, only while My layers is open): the
  tools, the layer new things go into, the unsaved count and Save. Tools are one
  click (or one key) away whatever the sidebar shows.
- The right-hand dock keeps Layers (upstream's) and Key; My layers moves out of it.
  Clicking an ordinary map feature still shows its details in the sidebar, like
  now (the inspector shows it, read-only).

## 4. The outliner

- **Layers** as collapsible groups. Row: eye (show/hide), lock (no edits, no
  accidental drags), colour, name, item count, ⋯ (rename, duplicate, export,
  opacity, delete). Drag rows to reorder (draw order). The layer new items go into
  is marked, and set by clicking its name (or from the toolbar).
- **Items** with their actual symbol (small), designation, and one line of what
  matters: identity / status / time ("Hostile · planned", "seen 2h ago").
  Click selects and centres; double-click zooms; drag to another layer moves it.
- **Search and filters** across all layers: text (designation, type, notes), and
  chips for identity, present/planned, kind (units, equipment, graphics, pictures),
  changed recently. Filters also dim what doesn't match on the map.
- **Multi-select**: Shift / Ctrl-click in the list, Shift-drag a box on the map.
  The inspector then shows what they share and applies changes to all.

## 5. The inspector (an item, or several)

As in the previous message, deepened:

- **Header:** the symbol large (live preview), designation as the title (click to
  rename), the type in words, the layer.
- **Identity strip:** frame shapes for identity; a Present / Planned switch;
  damaged / destroyed / full as badges; the echelon as its actual marks; HQ / Task
  force / Dummy as toggles; mobility (equipment) as icons. All visible at once, one
  click each, the preview follows.
- **Details as a definition list, filled fields only**, in plain words with
  readable values: date-time group as a date and "2h ago" (with a "now" button when
  editing); direction as a compass point and degrees (or drag a direction arrow on
  the map); source rating spelled out ("B2: usually reliable, probably true");
  reinforced / reduced as +/−. The standard's letter shows on hover.
- **+ Add detail**: a short menu of the fields that apply and aren't used yet,
  each with one line of explanation, grouped by question: Who · What · When ·
  Where · How sure.
- **Notes** at the end, always visible.
- **Footer:** layer (move), duplicate, delete.
- **Arrows and other graphics:** the same header and strip; their details are the
  name(s), effective from/to, width shown as a number next to the handle on the map.
- **Pictures and markers:** name, size (slider and on-map handle), caption.
- **Copies of map features:** what it is, where it came from, "show the original".

## 6. Adding

- **Toolbar:** Select (↖), Symbol (⬚), Arrow / graphic (➚), Line, Area, Text label,
  Picture, Copy from map. Keys: V, S, A, L, R, T, P, C; Esc back to Select.
- **The picker** opens as a large popover from the toolbar (not in the sidebar):
  a grid of symbols *with their names*, 3–4 columns, identity chooser on top (it
  stays chosen). Sections: Recent · Favourites (star any symbol) · Search ·
  Browse. Browse uses plain categories: *Units*, *Equipment and vehicles*,
  *Installations*, *Incidents and emergencies*, *Tasks* (block, breach, seize...),
  *Movement* (axes, attacks), *Lines* (phase lines, boundaries), *Areas* (assembly,
  objectives...), *Obstacles*, *Fire support*. Pick, then click the map; Shift keeps
  the tool for placing several.
- **Quick add:** typing in the map's search box "/infantry" (or a key) opens the
  picker with that search.
- **Templates (later):** save a set of symbols as a template ("mech company") to
  place in one go.

## 7. Editing on the map

- **Hover:** a tooltip with designation, identity, time.
- **Right-click:** identity ▸, Present / Planned, duplicate, move to layer ▸, bring
  to front, delete.
- **Double-click a label:** rename in place.
- **Drag** (exists), **Alt-drag** to duplicate, arrow keys to nudge the selection.
- **Copy / paste** (Ctrl+C / V), also between layers.
- **Undo / redo** (Ctrl+Z / Ctrl+Shift+Z, and ↶ ↷ in the sidebar): every unsaved
  change can be undone one at a time. (The store already keeps them in order.)

## 8. Saving and history

- **Toolbar:** "3 ● Save" while there are unsaved changes; the ● menu lists them
  (undo any one).
- **History** keeps the timeline bar at the bottom of the map, with a mark per
  save; clicking a change in it selects that item. Later: compare two moments, and
  "restore this item as it was then".
- When **auto sync** comes (backlog 10.6b), Save may disappear: changes go out as
  they're made, the count becomes "synced / offline, 3 waiting".

## 9. Order of work

1. Sidebar on the left with outliner + inspector (move the existing pieces), and
   the map toolbar. Undo / redo.
2. Inspector rework: header, identity strip, filled-only details, + Add detail,
   readable values, inline edits.
3. Outliner: symbols in the list, search and filters, lock, drag between layers,
   multi-select and bulk edit.
4. Picker popover: grid with names, recents, favourites, plain categories.
5. Map interactions: hover, right-click menu, rename on the map, copy / paste.

Each step is usable on its own; 1 and 2 change the most for daily use.

## 10. Questions for the owner

- Left sidebar for My layers (with the feature details), or keep it on the right?
- Should the toolbar be on the map (always visible while My layers is open) or in
  the sidebar?
- Which fields matter most in practice (to show them without "+ Add detail")?
- Are layers enough to organise, or are folders / a "situation" (a named set of
  layers at a date) needed?
