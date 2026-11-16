# Roads and railways: one look in every mode (2026-11-16)

Asked for: the roads and railways shown at each zoom the same over the map and over
imagery; small roads, paths and railways from further out; long-distance railways
like motorways, smaller ones like main roads; tunnels marked at every zoom.

## 1. One set of road and railway layers (frontend)

- The fork's road, railway and border layers (were `modules/satellite/hybrid.ts`,
  only over imagery) become a module of their own, `modules/roads/`, drawn in every
  mode but "satellite" (imagery with names only).
- Which roads at which zoom, widths, minimum widths, tunnels dashed, railways in use
  only: the same everywhere. Only colours (and the fading zoomed in, over photos)
  follow the background (`followBackground`): over the map the high contrast
  palette's white roads with a grey edge, grey railways with white dashes; over
  imagery orange, yellow and white roads, black and white railways.
- Upstream's road, railway and border layers are hidden from fork code (no upstream
  edit); the palette's road colours (`map-sources/palette.ts`) go.
- Street names white on a dark halo over imagery move with them.

## 2. Railways from the database

- `imposm/railways.py`: railway lines (rail, light rail, narrow gauge, subway, tram,
  funicular, monorail) with `usage`, `service`, `highspeed`, tunnel, bridge, name, ref,
  operator; generalised copies for zooming out.
- A Tegola layer (`tegola/layers.fork.yml`); `modules/roads` draws it: main and
  high-speed lines like motorways from zoom 6, branch lines like main roads from 8,
  service tracks, trams and subways from 12. The background map's railways where the
  database has none (a region built before).
- Tested on Luxembourg; France at its next rebuild.

## 3. Small roads, paths and tunnel marks zoomed out (done, 2026-11-16)

- Below zoom 12 the background map merges each road into one line without its tunnel
  mark: a dashed copy over it would still look solid. So the companion carries every
  road at zooms 8 to 13, copied down from zoom 15 (small roads from 12, paths from 13,
  tunnels marked, the stretches of big roads Protomaps keeps for zoom 15), as a layer
  named "roads": the backend drops the background map's own there. The frontend
  needs no change.
- The companion, renamed `<area>.zoomed-out.pmtiles` (was `.buildings.pmtiles`), made
  by `zoomed_out.py` (buildings: `zoomed_buildings.py`, roads: `zoomed_roads.py`), a
  zoom 10 block per worker, each zoom 15 tile decoded once (only its buildings and
  roads).
