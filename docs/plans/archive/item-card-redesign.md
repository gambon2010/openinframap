# The item card, redone (2026-11-22)

Asked (spec 10.98): the card of a selected My layers item was cobbled together:
a picture of the item at the top (already on the map), a title unlike the other
panels', choices in four different controls (identity buttons plus a "More…"
dropdown, status and condition chips mixed in one row, a mobility dropdown), rows of
different widths, "+ Add detail" a menu inside the card (it scrolls), no way to
remove a detail added by mistake, a date that stays an input after it's left,
"Additional information" beside a Notes box, a lock button alone at the top, a
"100 %" button that means reset, a hint saying points can be dragged.

The owner's choices: every choice a dropdown; only Notes (no "Additional
information": it printed on the map); units of measure chosen beside the value;
Lock in the title bar.

## The card

- **Title bar** (the details panel's, as every other panel: `.oim-popup-header`):
  the item's name, or what it is when it has none ("Main attack"); under it, what it
  is and its layer ("Main attack · My layer"). A padlock button at its right, before
  minimise and close (🔒 locked, 🔓 not). No picture of the item.
- **One form**, every row the same: a label on the left (one column width), its
  control filling the rest (`.oim-ul-row`):
  - Name (the unique designation for military items);
  - Identity, Status (present, planned), Condition (fully capable, damaged,
    destroyed, full to capacity; not for graphics), Drawn as (a graphic's two
    versions: axis of advance, direction of attack…), Echelon, Mobility: dropdowns;
  - Headquarters, task force, dummy: tick boxes in one row (they're on or off, not
    a choice among several);
  - the details: text, numbers with their unit chosen beside them (speed km/h, kn,
    mph; distances m, km, nm; altitude m, ft; directions °, mils), dates shown in
    words and edited on click (back to words when left), each with a × to remove it;
  - "+ Add detail…": a dropdown grouped by question (its groups as the browser
    shows them), the chosen detail added and focused.
  - Notes.
- What the item's kind adds (a line of sight's answer, range rings' distances).
- **Appearance** (folded): size with a Reset button, colour, line width.
- **Footer:** layer, Duplicate, Delete, Done. No hint on dragging.
- The card for several items: identity and status as dropdowns too.

## Units

Stored as the map draws them: a speed, distance or altitude is a label on the
symbol, kept as written with its unit ("30 kn"); a direction turns the symbol's
arrow, so it's kept in degrees and shown in the unit chosen. The last unit chosen
for each detail is kept in this browser (per-viewer convenience).

## Reuse

Native `<select>` with `<optgroup>` for "+ Add detail" (opens outside the card, as
the browser draws it, no scrolling inside the card); the conversions are plain
factors (1 kn = 1.852 km/h, 1 mph = 1.609344 km/h, 1 nm = 1852 m, 1 ft = 0.3048 m,
6400 NATO mils to the turn, as the measuring tools' mils: `core/north.ts`).
