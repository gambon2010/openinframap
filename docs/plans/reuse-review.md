# Reuse review: parts written before "Reuse before writing" (2026-11-20)

CLAUDE.md's rule (reuse a package, else a larger project's method, before writing
our own) came after much of the fork was written. These are the parts that solve a
known problem with code of our own, what exists, and what was decided (looked at
2026-11-20). Only the fork's own code is concerned: upstream's files aren't changed.

## Replaced

- **Contour smoothing** (`web-backend/src/fork/terrain/contours.py`): a Gaussian
  blur written by hand became SciPy's `gaussian_filter` (OpenTopography smooths the
  elevations with a Gaussian before contouring); the depression and supplementary
  contours follow the USGS's US Topo specifications and FM 3-25.26 (no package
  draws them).

## Looked at, ours kept

- **PMTiles reading in the backend** (`background/__init__.py` `Archive`, reused by
  `terrain/files.py`): the `pmtiles` package's `Reader` re-reads the header and
  decodes the directories on every tile, with no cache: 5.2 ms a tile against 0.01
  ms for ours, warm, on France's background map. Ours uses the package's own
  decoding functions (`deserialize_directory`, `find_tile`); only the cache is ours.
  Noted in `Archive`'s docstring.
- **Grouping nearby sites** (`schema/fork/sites.sql`, `site_points`): integer grid
  cells per tile are the standard grid clustering (`ST_SnapToGrid` would give the
  same cells as points, then grouping by geometry); Supercluster is MapLibre's
  browser-side, hierarchical clustering of GeoJSON, and nothing keeps our per-kind
  counts (the key's hiding needs them).
- **Railways close together drawn as one** (`background/close_lines.py`): Planetiler's
  `FeatureMerge.mergeLineStrings` joins lines end to end, not side by side; nothing
  found collapses parallel tracks. Noted in its docstring.
- **Buildings zoomed out** (`background/zoomed_buildings.py`): we keep each building
  big enough to see (Planetiler's minimum pixel size, as an area); Planetiler's
  `mergeNearbyPolygons` merges buildings into blocks, what the background map's own
  tiles already do and what this replaces. Cited in the code.
- **Tile maths in the scripts** (`scripts/offline_maps/tiles.py`): OpenStreetMap's
  slippy map formulas, as mercantile writes them; the scripts use the standard
  library only (they run before any environment is set up). Cited in the code.
- **Retries** (`scripts/netsafe.py`): linear waits, gentler than urllib3's `Retry`
  (exponential); same standard-library constraint. Cited in the code.
- **The download lock** (`scripts/offline_maps/inventory.py`): `filelock` is the
  standard; same constraint.
- **Hiding key rows by filter** (`web/src/fork/ui/key/feature-hider.ts`): MapLibre has
  no per-value toggle; legend plugins hide whole layers only.
- **Contour lines from coarser zooms** (maplibre-contour's `overzoom`): tried against
  the fragments on flat ground; it changed nothing (the background map's buildings
  were cutting the lines), so not kept.

## Second pass (2026-11-20): candidates, not changed yet

Most to gain first; each waits for the owner's go.

| Part | What we wrote | What exists | Proposal | Size |
|---|---|---|---|---|
| The Earth's geometry (`web/src/fork/core/earth.ts`: bearing, destination, great circles, circles, path length; `core/geo.ts` `groundDistance`) | Spherical formulas by hand (mean radius 6,371,008.8 m) | Turf's modules (`@turf/bearing`, `destination`, `great-circle`, `circle`, `distance`, `length`, `along`; 7.4, maintained, same radius; `@turf/boolean-point-in-polygon` is already used) | Replace, the tests unchanged as the check; the measuring marks (`measure/ticks.ts`) then use `along` | Small |
| KML export (`modules/userlayers/io/formats.ts`) | KML written by hand | `@placemarkio/tokml` (by togeojson's author, which we use for import; maintained) | Replace, keeping our ExtendedData; GPX stays ours (no maintained writer: `togpx` is abandoned) | Small |
| My layers' drawing and editing on the map (`map/tools.ts`, `tools/drawing.ts`, `interactions.ts`, `geometry.ts`: about 870 lines) | Clicks, drafts, dragging points and shapes, by hand | Terra Draw (1.40, active, a MapLibre adapter: points, lines, areas, selecting, dragging points, snapping) | Prototype first: tactical graphics' control points and the symbols' placing may need Terra Draw's custom modes; worth it only if most of ours goes | Large, to check |
| Merging others' saved changes with yours (`state/merge.ts`, `reconcile.ts`) | A field-by-field three-way merge | CRDTs (Yjs, Automerge) | Keep: a CRDT would change the whole sync design, which the owner wants to discuss first (live sharing is in the backlog) | — |
| The tooltip and the right-click menu (`ui/tooltip.ts`, `context-menu.ts`) | Positioning by hand | Floating UI | Keep: little to gain for two small pieces | — |

## Already reused (no change)

LOOM for tram and metro lanes; Planetiler's way of drawing roads zoomed out
(`zoomed_roads.py`); osmium for OpenStreetMap extracts; pmtiles (go and Python) for
tile files; `mapbox_vector_tile`; contourpy (marching squares); SciPy; polygon-clipping;
mgrs; magvar; togeojson; jsPDF; the armyc2 renderer for military symbols; PostGIS
and `pg_trgm` for search; MapLibre's hillshade and terrain; Horn's slope (GDAL's
`gdaldem slope` method).

## Our own, nothing to reuse

Domain rules with no library: military site names (`site-rules.sql`), power line
tracing and tower numbering (`line_trace/`, `tower_numbers/`), stand lead-ins
(`stand_lead_ins.py`), the offline maps menu (`ui.py`, `offers.py`), vector tile
layers taken apart undecoded (`mvt.py`: decoding with `mapbox_vector_tile` was the
slow part it replaced).
