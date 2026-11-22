# Indoor maps (plan, 2026-11-22)

Asked (spec 10.104): building interiors where they're mapped, floor by floor. Not
started.

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

1. **Import** (imposm mapping, `imposm/`): `osm_indoor` (rooms, corridors, areas,
   walls, columns, doors, stairs and lifts with their `level`, `name`, `ref`,
   `repeat_on`), polygons and points. Small: tens of thousands of rows. Rebuild.
2. **Tiles** (`tegola/layers.fork.yml`): an `indoor` map with indoorequal's layer
   names, from zoom 17.
3. **The map** (a module `modules/indoor/`): the plugin's level control (shown only
   where something indoor is in view), its style redone in our look (STYLE.md: rooms
   in the panels' light grey, walls in the dark grey, doors as gaps, names in the
   label style); a "Building interiors" entry in Data layers, off at first.
4. **Details:** a room's name, reference and level on click; rooms in the search
   ("Salle 204", "Quai 3").
5. **My layers:** an item can be on a level (a property), shown only on that level
   while the control is on it (later, once the rest works).
6. **Checked on** Paris Gare du Nord, Lyon Part-Dieu and Rennes, and on a building
   with nothing indoor (no control shown).

About two days for steps 1 to 4.
