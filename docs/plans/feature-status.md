# Plan: a status on anything on the map, and "what if" on the power grid

Status: **proposal, waiting for review** (2026-10-31). Nothing is built yet.

## What it does

1. **A status on any map feature.** Power lines, substations, transformers,
   hospitals, places of worship, supermarkets, fuel depots, pipelines, masts... can
   be marked:

   | Status | Meaning | On the map |
   |---|---|---|
   | Operational | works, checked | green tick (or nothing, see question 3) |
   | Suspected damage | reported, not confirmed | orange ring, "?" |
   | Damaged | partly working | red ring, "!" |
   | Destroyed / out of service | not working | red cross |
   | Unknown | not known (the default: no mark) | grey ring, when set on purpose |

   Each status has who set it, when, a note, and optionally a source (seen, reported,
   imagery). This is separate from My layers' military symbols: it's about the
   real features already on the map, not items you draw.

2. **Extra fields by kind**, on top of the status:
   - stores, supermarkets, depots, fuel stations: **stock**, as Full, Half, Low,
     Empty or Unknown, and optionally what's short (food, water, fuel...);
   - hospitals and clinics: **capacity** (Normal, Saturated, Closed) and, optionally,
     beds;
   - fuel stations and depots: fuel available (yes, no, rationed).

   The list is a table in the code, one line per field, so more can be added.

3. **"What if" on the power grid.** With the statuses as they are, or a hypothetical
   scenario ("what if this substation and these two lines are lost?"):
   - which substations, and so which areas, lose their supply;
   - which lines are no longer energised;
   - the map shows them, and a list gives names, voltages and counts.

## Which features

Anything clickable that has an id:
- OSM layers: power, telecoms, water, petroleum, critical sites;
- extra data (Agence ORE, ICPE).

A feature is identified by its tile layer's source table and id (the same mapping
as copying a feature into My layers, `map_data.py`), so the status survives a
rebuild of the region as long as the OSM object exists.

Ordinary shops (convenience stores, bakeries...) aren't on the map today: critical
sites have supermarkets, wholesale and distribution centres. Adding "food shops" is
a small extra category (`imposm/sites.py`), if you want them (question 5).

## Setting a status

- **In a feature's details** (the left panel): a "Status" row with the five choices,
  a note, and the extra fields for its kind. It goes through `addDetailsExtra`, like
  "Route from here".
- **Several at once:** select features on the map (Shift-click, as in My layers)
  and set them together, e.g. a whole line or a district's stores.
- **A transformer or switch** is inside a substation. Its status is its own; for "what
  if", a damaged or destroyed transformer counts as its substation losing that
  voltage level (simplified: the substation is out, question 4).

## Seeing statuses

- **On the map:** a "Status" overlay above the infrastructure: rings and badges on
  points, coloured dashes along lines, outlines on areas. It can be turned on and
  off in the layer list, and it's in the key.
- **A Status board** (a panel in the right dock): every feature with a status,
  filtered by status, kind and area, sorted by date. Clicking one goes to it.
  Counts: "12 damaged substations, 3 empty supermarkets".
- **Search** finds features by status ("damaged hospital").

## Storing it

Statuses are shared, like My layers, and saved in the same `userdata` schema:
- `feature_status`: the feature's id, status, extra fields, note, source, author and
  time;
- every change is logged in the existing change log, as new kinds of change
  (`status_set`, `status_clear`).

So they come with:
- **the history:** play back how the damage spread;
- **situations:** "the situation at 14:00" also shows the statuses then;
- **undo;**
- **live sync and users** (`plans/sync.md`): who set what, and later, who may.

The geometry shown on the map is the feature's own, fetched with
`/userdata/source-feature`, so the overlay draws even where the tile has it cut.

## "What if" on the grid

Uses the grid network already built for routes (`grid_node`, `grid_edge`:
substations, plants, junctions, lines of 10 kV and more; France: 33,137
substations, 267,323 line segments) and networkx in the backend.

1. **Where power comes from:**
   - power plants above a size (e.g. 10 MW);
   - the points where lines leave the built region (power comes from outside: without
     these, a region with few plants would look cut off everywhere).
2. **What's lost:**
   - lines, substations and plants that are Damaged or Destroyed;
   - Suspected damage counts too if you choose ("pessimistic");
   - a scenario adds or removes items without changing their real status.
3. **Who loses supply:** substations connected to a source before the loss and not
   after. Their lines are de-energised.
4. **Shown as:**
   - the cut-off substations and dead lines highlighted on the map;
   - a list by voltage (e.g. "4 × 225 kV, 18 × 63 kV substations");
   - "Show on map" for each.
5. **Scenario mode:** a "What if…" panel. Pick items on the map ("lose this") without
   changing their status, run it, compare. A scenario can be saved and named, like a
   situation.

The whole grid fits in memory (France: about 280,000 nodes), and one run takes about
a second. The graph is kept in the backend and rebuilt only when the database
changes.

**Later, France only (estimated):** which hospitals, stores and towns are
affected. The Agence ORE distribution data links street substations, through
medium-voltage lines, to their source substation, so "this source substation is
cut" can become "these 37 street substations, so these hospitals and
supermarkets". Outside France there's no such link in open data. The nearest
substation would be a guess, and would be labelled as one.

## Building it, in steps

1. **Statuses:**
   - the table and the change log;
   - setting one in the details panel (status, note, source);
   - the map overlay and the key.
2. **Extra fields by kind** (stock, capacity, fuel), and setting several at once.
3. **The Status board** (list, filters, counts), search by status, statuses in the
   history and situations.
4. **What if:**
   - the cut-off substations and dead lines from the statuses;
   - then scenario mode;
   - then saved scenarios.
5. **Later:** effects on hospitals and stores (France, estimated), and N-1 ("still
   supplied, but by a single line": fragile).

Each step can be used on its own. Steps 1 and 4 are the core.

## Questions for you

1. **Statuses:** are Operational, Suspected damage, Damaged, Destroyed / out of
   service and Unknown right, or do you want others (e.g. "Repaired", "Under
   repair", "Threatened")?
2. **Who sees them:** statuses are shared with everyone, like My layers today. With
   users (`plans/sync.md`), should they belong to someone and be shared on purpose,
   or always be seen by all?
3. **"Operational" on the map:** a green mark on everything checked, or nothing (only
   problems shown) to keep the map clean?
4. **Transformers:** treat a damaged transformer as its whole substation being out
   (simple), or as one voltage level lost (more exact, more work)?
5. **Shops:** add ordinary food shops (convenience stores, bakeries, butchers) to the
   critical sites, so their stock can be marked, or are supermarkets and
   distribution centres enough?
6. **What if, sources:** count lines leaving the region as supplied (recommended), or
   only the power plants inside it?
