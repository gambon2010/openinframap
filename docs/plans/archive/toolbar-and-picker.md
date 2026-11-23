# My layers' toolbar and symbol picker, redone (2026-11-22, built)

Asked (spec 10.101): the toolbar's icons are too generic (a dashed square for
"Symbol", unicode shapes, emoji), there are twelve tools in a row, and some belong
together (the four measuring tools); the symbol picker looks disorganised (wrapping
chips of categories, a hint and a credit line, tooltips repeating what's written).
Not built yet: to be agreed first.

## The toolbar

Today: `↖ ⬚ ➚ ╱ ▱ 📍 🖼 ⧉ 📏 ⬠ ◎ 👁 | Into [My layer ▾] | ↶ ↷ 🕘 | Save (9) ⋯`

Proposed: six tools, four of them groups that open a small list.

```
[↖] [▭▾] [➚▾] [✎▾] [⧉] [📐▾]  │  ✎ My layer ▾  │  ↶ ↷  🕘  │  Save (9)  ⋯
 │    │    │    │    │    └ Measure: distance (D), area (E), range rings (O), line of sight (I)
 │    │    │    │    └ Copy from the map (C): click, Shift + drag a box
 │    │    │    └ Draw: line (L), area (R), marker (M), picture (P)
 │    │    └ Graphic (A): arrows, areas, lines of the standard (the picker)
 │    └ Symbol (S): units, equipment, installations (the picker)
 └ Select (V)
```

- A group's button does the tool used last in it (one click, as now); its small ▾,
  or holding the button, opens the list: each tool with its icon, its name and its key.
  The keys stay as they are.
- Icons from one drawn set, not emoji or unicode: [Lucide](https://lucide.dev) (ISC
  licence, an npm package of SVGs; reuse, not drawn by hand). Symbol: a small friendly
  frame drawn by the symbol library itself; Graphic: the standard's main attack arrow
  (the graphics renderer); the others Lucide's (mouse-pointer, pen-line, copy, ruler,
  eye...).
- "Into [My layer ▾]" becomes a chip "✎ My layer ▾": the same choice, less room, the
  same pencil as the list's "you draw here" mark.
- Each button's tooltip: its name and key ("Line of sight (I)").

## The symbol picker

```
┌──────────────────────────────────────────────────────────────┐
│ [ Search symbols (fire, hospital, infantry...)           ]   │
│ Identity  [▭][◇][□][✿]                       ☐ Planned      │
├───────────────┬──────────────────────────────────────────────┤
│ ★ Favourites  │  ▭ Infantry       ▭ Armour        ▭ Artillery │
│ 🕘 Recent      │  ▭ Engineers      ▭ Reconnaissance ▭ Medical  │
│ ───────────── │  ▭ Signals        ▭ Supply        ...         │
│ Units      ◀  │                                              │
│ Equipment     │                                              │
│ Installations │                                              │
│ Incidents     │                                              │
│ Air · Sea ... │                                              │
└───────────────┴──────────────────────────────────────────────┘
```

- Categories in a column on the left (Favourites and Recent first), the symbols on
  the right in a grid of equal tiles (the symbol, its name under it): one place to
  look, nothing wrapping.
- Typing searches every category; the column shows how many match in each.
- No hint text, no credit line (the credit goes in the docs: LOCAL_DEVELOPMENT.md's
  credits), no tooltip repeating the name written on the tile.
- The same layout for graphics (the Graphic tool), its categories the standard's.
