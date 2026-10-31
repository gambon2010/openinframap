# Plan: a status on anything on the map, and power supply ("what if") on the grid

Status: **agreed** (2026-10-31). Steps 1 and 2 are built (statuses, their history
per feature, the look on the map; extra fields, several at once, convenience stores). Answers so far are marked ✔.

## What it does

1. **A status on map features.** Large infrastructure (power lines, substations,
   plants, transformers, pipelines, masts...) and critical sites (hospitals, places of
   worship, supermarkets, convenience stores, fuel depots...) can be marked:

   | Status | On the map |
   |---|---|
   | Operational | not shown ✔ (only problems are) |
   | Repaired | not shown (it's working again; the history keeps it) |
   | Threatened | yes |
   | Suspected damage | yes |
   | Damaged | yes |
   | Destroyed / out of service | yes |
   | Under repair | yes |
   | Unknown | not shown (the default) |

   Each status has who set it, when, a note, and a source (seen, reported, imagery).
   This is separate from My layers' military symbols: it's about the real features
   on the map. The look on the map is open (see "How a status looks").

2. **Extra fields by kind:**
   - stores, supermarkets, convenience stores, depots: **stock**, as Full, Half, Low,
     Empty or Unknown, and what's short;
   - hospitals and clinics: **capacity**, as Normal, Saturated or Closed;
   - fuel stations and depots: fuel available, as Yes, No or Rationed.

   Convenience stores are added to the critical sites ✔ (not bakeries). That's a
   change to the OSM import, so it takes effect at the next rebuild of the region.

3. **Power supply mode** ✔. A toggle, off by default. When it's on, the power grid is
   coloured by what the statuses mean for supply:

   | Colour | Meaning |
   |---|---|
   | green | supplied as normal |
   | orange / yellow | still supplied, but with less (see "Less power") |
   | red | no supply |

   This applies to lines, substations and plants on the map, and to the power lines,
   substations and transformers **copied into My layers** ✔. A copy looks normal (its
   own style) while the mode is off, and gets the supply colour of the feature it was
   copied from while it's on. A scenario ("what if these are lost?") can be run in
   this mode without changing any real status.

4. **A status history of its own** ✔. Separate from My layers' history:
   - every status change is logged, and the Status board can play the log back, the
     map (and the supply colours) showing the statuses as they were at each step;
   - copies in My layers follow the original feature's status, so they change too
     during this playback;
   - My layers' own history stays about the layers.

## How a status looks: C ✔

Only problems are shown ✔. Suggestions:

- **A. Colour only:** a coloured ring around points, and a coloured casing (a halo
  along each side) on lines and area outlines. The cleanest, but colour alone can't
  be read by everyone (colour-blind), and some colours are close (orange and red).
- **B. A small badge:** a round sign at the corner of the icon, or every so often
  along a line, with a symbol:

  | Status | Badge |
  |---|---|
  | Threatened | yellow, `⚠` |
  | Suspected damage | orange, `?` |
  | Damaged | red, `!` |
  | Destroyed | black, `✕` |
  | Under repair | blue, `🔧` |

  Readable in black and white; adds a little clutter.
- **C. Both (chosen ✔):** the coloured ring or casing, plus the badge from zoom 12
  (closer in, where there's room). From afar only the colour shows, so the map stays
  clean; closer, the badge says exactly what it is.

The same colour and symbol appear wherever the feature is listed: in its details
(next to its title), on the Status board, and in search results.

The power supply mode's green / orange / red is a different thing: it colours the
lines themselves, not a badge, and only while that mode is on.

## Setting a status

- In a feature's details (left panel) ✔: a "Status" row with the choices, a note, a
  source, and the extra fields for its kind (through `addDetailsExtra`). Statuses are
  set there, not by clicking on the map; a substation's panel also lists its levels
  and transformers.
- **On a copy in My layers:** its card shows the original's status and can change it.
  It's the same shared status, not a copy of it.
- **Several at once:** select features on the map (Shift-click) and set them together.

## Storing it

The statuses are shared with everyone, as they're about features of the map ✔:
- `feature_status`: the current status of each feature (its tile layer's source table
  and id), with the extra fields, note, source, author and time;
- `status_change`: every change, in order, for the status history.

They're separate from My layers' change log ✔. **Only some users may set statuses** ✔:
with users (`plans/sync.md`), a right "can set statuses" given per user; everyone
can see them. Until accounts exist, anyone using the app can. A copy in My
layers points to its original (source table and id): its status is read from there.

## Power supply

Uses the grid network already built for routes (`grid_node`, `grid_edge`: substations,
plants, junctions, lines of 10 kV and more) and networkx in the backend.

1. **Where power comes from** ✔:
   - power plants (above a size, e.g. 10 MW);
   - the points where lines leave or enter the built region, since power comes from
     outside too.
2. **What's lost:** what is Destroyed or Damaged, and also Suspected damage with the
   "pessimistic" switch. A scenario adds or removes items on top of that.
3. **No supply (red):** substations, and the lines between them, no longer connected
   to any source.
4. **Less power (orange / yellow):** still connected, but weakened. Proposed: either
   - **(a)** it lost a feed: fewer independent ways to a source than before. A
     substation fed by two lines, one now cut, is still on, but one more loss
     cuts it. Or
   - **(b)** it's fed only through lower voltages than before: e.g. a 225 kV
     substation now reached only through 63 kV lines (much less can get through).

   **Chosen: (b)** ✔. With the detailed model (below), losing one of two
   transformers between the same levels also makes it orange (less can get through).
5. Shown as colours on the map and on copies (see 3 above), plus a list ("4 × 225 kV,
   18 × 63 kV substations without supply; 12 weakened").

The whole French grid (about 280,000 nodes) fits in memory, and one run takes about
a second. The graph is kept in the backend and rebuilt when statuses change.

### Substations: the detailed model ✔

- **Simple:** a substation is one point of the network. A damaged or destroyed
  transformer (or the substation itself) takes the whole substation out: every line
  meeting there is cut from every other.
- **Detailed:**
  - each substation is split into one point per voltage level (its "busbars": one at
    225 kV, one at 63 kV, one at 20 kV...);
  - each line joins the busbar of its own voltage;
  - each transformer is a link between two busbars (OSM often gives its voltages:
    `voltage=225000;63000`).

  Then:
  - losing a transformer only cuts the levels it joins;
  - two 225/63 kV transformers side by side: losing one keeps the 63 kV side
    supplied, but weakened (orange), and losing both cuts it (red);
  - the 225 kV lines passing through stay energised whatever happens to the
    transformers;
  - substations without their transformers mapped (common in OSM) keep their levels
    joined as one (the simple way), so they're never wrongly cut off.

  Chosen ✔. It's more work (the grid build, and routes go through the busbars), and
  how much it adds depends on how well transformers are mapped in the region.

  **Setting statuses inside a substation** ✔: from the substation's details panel,
  not by clicking things on the map. Below its "Circuits" table (the lines
  arriving, which gets a status column too), a "Voltage levels and transformers"
  section lists its levels (400 kV, 225 kV...) and its transformers from OSM
  ("3 × 400/225 kV"), each with its status, so a substation can be damaged as a
  whole, or only one transformer or one level.

## Building it, in steps

1. **Statuses:** the tables and their history, setting one in the details panel,
   and the look on the map (once chosen).
2. **Extra fields** (stock, capacity, fuel) and setting several at once; convenience
   stores in the critical sites (at the next rebuild).
3. **The Status board:** the list, filters and counts, playing back the status
   history, and search by status.
4. **Power supply mode:**
   - red, from the statuses, on the map and on copies in My layers;
   - then orange (weakened);
   - then scenarios.
5. **The detailed substation model** ✔: levels and transformers in the grid
   network, and their statuses in the substation's panel.
6. **Later, France only, estimated:** which hospitals and stores lose power. The
   distribution data links street substations to their source substation.

Each step can be used on its own.

## Questions left

None for now; the look of the status row in the details panel will be checked on
screenshots before building.
