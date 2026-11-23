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

## 2. Railways ranked, from OpenStreetMap (done, 2026-11-17)

- First built in the database (an Imposm table, Tegola): dropped before committing,
  as it was a second source of map lines and needed France rebuilt. Instead, in the
  offline maps step like the roads: osmium cuts the area's railway lines out of its
  OpenStreetMap extract (the region build's, downloaded if missing) into
  `<area>.railways.osm.pbf` (scripts/offline_maps/railways.py); the zoomed out build
  ranks them (main, branch, minor, service: from zooms 6, 8, 11, 14) and adds a
  `railways` layer at zooms 6 to 15 (zoomed_railways.py). The map draws only it.
- Close tracks drawn as one up to zoom 14 (close_lines.py), the same for a motorway's
  carriageways in the roads zoomed out; only what runs alongside is left out, never
  a crossing.

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
