# Indoor maps (plan, 2026-11-22)

Asked (spec 10.104): building interiors where they're mapped, floor by floor.

**Status (2026-11-23):** steps 1 to 3 built, a little differently from below:
- Read at build from the whole extract by `scripts/indoor.py` (osmium, like the
  buildings' names), not the Imposm mapping: no full rebuild needed, and keeping
  everything with a `level` in the import's filtered extract would have bloated it.
- Things with a floor that aren't part of an interior (shops, toilets, lifts) are
  kept where they touch an interior or stand in a building of the background map
  (`src/fork/indoor/link.py`): a centre mapped with shops on floors but no rooms
  keeps them; a bench on level 0 in a street goes.
- A piece with no level takes its floor outline's (`indoor=level`), else 0, its
  details saying the floor wasn't given.
- Not the indoorequal plugin: its level control is one floor for the whole map, and
  the owner chose a floor per building, in the building's details. Our own layers
  (`indoor_area`, `indoor_line`, `indoor_point`, `indoor_building`), our own floor
  chips.
Still to do: rooms in the search (step 4); a building copied into My layers keeping
its floors (step 5).

## What there is

No official open dataset of floor plans in France (SNCF publishes stations, their
equipment, level crossings and bridges, not plans). OpenStreetMap has them, in the
Simple Indoor Tagging scheme: the France extract of 2026-10-15 holds about 65,000
rooms (`indoor=room`), 7,000 corridors, 7,000 open areas (`indoor=area`), 4,000
walls, 3,600 columns and 3,500 doors, each on its `level`. Most are in north Paris,
Lyon, Rennes, Brest and Grenoble: big stations (SNCF Gares & Connexions has its
stations mapped in OSM from its architects' plans, for its Ma Gare SNCF app),
universities, shopping centres. (`indoor=yes/no`, 70,000 more, only says a place is
covered or not.)

## Reuse

- **[maplibre-gl-indoorequal](https://github.com/indoorequal/maplibre-gl-indoorequal)**
  (MIT): the MapLibre plugin behind indoorequal.org, a level control (the floors in
  view, one chosen) and a style. It reads a vector source with indoorequal's layers
  (`area`, `area_name`, `poi`, `transportation`): our tiles are made with those names
  and fields, so the plugin works on them unchanged, offline.
- Their tile schema (indoorequal's `indoorequal-tiles`, BSD) for the imposm mapping:
  which tags go into which layer, how a level range ("0;1", "-1--2") is split.

## Steps

Decided with the owner (2026-11-23): everything indoor OpenStreetMap has, the
points inside too (shops, toilets, ticket machines); floors chosen per building, in
its details card, not one control for the whole map; buildings with an interior a
slightly different colour while building outlines are on; a building copied into My
layers takes its floors with it, switched from the same card. No My layers items on
a floor (confusing fast).

1. **Import** (imposm mapping, `imposm/`): `osm_indoor` (rooms, corridors, areas,
   walls, columns, doors, stairs, lifts, escalators with their `level`, `name`,
   `ref`, `repeat_on`), polygons and points, and the points of interest inside
   (anything with a `level` inside an indoor area). Small: tens of thousands of
   rows. Rebuild.
2. **Tiles** (`tegola/layers.fork.yml`): an `indoor` map with indoorequal's layer
   names, from zoom 17.
3. **The map** (a module `modules/indoor/`): a building's floors chosen in its
   details card (the plugin's tile schema and style, not its map-wide control),
   only that building's interior drawn on that floor; its style redone in our look
   (STYLE.md: rooms in the panels' light grey, walls in the dark grey, doors as
   gaps, names in the label style); a "Building interiors" entry in Data layers,
   off at first; buildings with an interior tinted.
4. **Details:** a room's name, reference and level on click; rooms in the search
   ("Salle 204", "Quai 3").
5. **My layers:** a copied building keeps its floors (rooms, doors, stairs), one
   shown at a time, chosen in its card.
6. **Checked on** Paris Gare du Nord, Lyon Part-Dieu and Rennes, and on a building
   with nothing indoor (no control shown).

About two and a half days.
