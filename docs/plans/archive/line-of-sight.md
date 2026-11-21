# Line of sight, redone (2026-11-21)

Asked for (spec 10.89): the line of sight stays a My layers object, drawn on the map
with what blocks it; its card simplified, with a button opening a split screen (the
chart large on the right, the line on the left, centred), hovering the chart showing
the place on the map; trees and buildings counted.

## What was wrong

- The chart drew the ground as measured and the eye's line straight, while the
  verdict lowers far ground for the Earth's curvature (about 570 m at 92 km): over
  long lines the chart couldn't explain its answer.
- No scale, no blocking point on the chart or the map.
- Bare ground only: IGN's model has no trees or buildings.
- A cramped card that scrolls.

## The design

**Backend (`web-backend/src/fork/terrain/sight.py`)** — one source for the physics:
each sample returns the ground, what stands on it (a building: OSM's height, else
8 m like the 3D view; a forest or wood: 20 m, a common canopy height for line of
sight studies), the surface (ground + that), the surface as seen from the eye
(lowered for curvature less refraction, as GDAL's viewshed), the eye's line there,
and whether it's seen. The answer also says what blocks the target first (where,
the ground or a building or trees, how high) and by how much the target is hidden
(or its clearance when seen). What stands on the ground comes from the background
map's own tiles (buildings at zoom 15, forest and wood areas), read once per tile
along the line (`terrain/obstacles.py`).

**On the map (`userlayers/map/render-measures.ts`):** the line, green where seen,
red where hidden (as now), and a marker where it's blocked, with what blocks it.

**The card (`userlayers/kinds/measure.ts`):** the verdict ("Hidden by trees
6.38 km away, 42 m short"), the two heights, and "Open the profile".

**The split screen (`userlayers/measure/sight-panel.ts`):** the right half of the
screen, the map's left half showing the line, fitted to it (MapLibre's padding).
The chart large, with height and distance on its axes: the ground, buildings in
grey and trees in green on it, the eye's line, the blocking point; hovering it
puts a marker at that spot on the map and says the distance, the ground's height
and what stands there. Closing it gives the map back its whole width.

## Steps

1. Backend: obstacles along the line, the richer answer; tests (a building and a
   forest on a synthetic line; curvature as before).
2. Map: the blocking marker.
3. Card simplified, the split screen with its chart and hover.
4. Docs (STYLE.md: the panel and the chart; LOCAL_DEVELOPMENT.md), checked in the
   app on a long line and a short one through a forest.

## Reuse

GDAL's viewshed for curvature and refraction (kept); obstacle heights from
OpenStreetMap through the background map's tiles; MapLibre's camera padding for the
split screen. A chart library was weighed against a hand-drawn SVG: the chart is a
polygon, a few lines and axes (the existing card already draws it by hand).
