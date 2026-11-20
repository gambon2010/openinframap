# Reuse review: parts written before "Reuse before writing" (2026-11-20)

CLAUDE.md's rule (reuse a package, else a larger project's method, before writing
our own) came after much of the fork was written. These are the parts that solve a
known problem with code of our own, what exists, and what to do. Nothing here is
changed yet: each line is a candidate, to look at in this order (most to gain
first). "To check" means the replacement hasn't been tried on our data.

## Worth replacing

| Part | What we wrote | What exists | Proposal | Size |
|---|---|---|---|---|
| Contour smoothing (`web-backend/src/fork/terrain/contours.py`, `smoothed`, `blurred`) | A Gaussian blur by hand (numpy convolutions, NaN-aware) | `scipy.ndimage.gaussian_filter` (the same normalised-convolution trick for missing heights); OpenTopography smooths the DEM with a Gaussian before contouring, maplibre-contour traces from a coarser zoom (`overzoom`) and averages pixel centres | Use SciPy (also useful to the radio mode); keep OpenTopography's method, cite it | Small (done in terrain step 5) |
| PMTiles reading in the backend (`background/__init__.py` `Archive`, reused by `terrain/files.py`) | Our own mmap reader over the `pmtiles` package's low-level functions, directories cached | The `pmtiles` package's `Reader` with an mmap source (`pmtiles.reader`), already a dependency | Try `Reader`; keep ours only if it's measurably slower (the background map's tiles are served per request) | Small, to check |
| Grouping nearby sites (`schema/fork/sites.sql`, `site_points`) | A grid of 12 × 12 cells per tile, counted per kind | PostGIS `ST_ClusterDBSCAN` / `ST_SnapToGrid`; Supercluster (MapLibre's own clustering, for GeoJSON sources) | Grid snapping is what Supercluster-less servers do; replace the hand-written cell maths with `ST_SnapToGrid`, keep the per-kind counts (no package keeps those) | Small |
| Tile maths in the scripts (`scripts/offline_maps/tiles.py`) | Web Mercator tile ↔ lon/lat, tiles covering an outline | `mercantile` (Mapbox), `supermercado` (tiles covering a shape) | Scripts use the standard library only on purpose (they run before `uv`); keep, but follow mercantile's formulas and cite them; revisit if the scripts get a venv | Small |
| Retries and resumed downloads (`scripts/netsafe.py`) | Retry rounds, waits, resuming by byte range | `urllib3`'s `Retry`, `tenacity` | Same standard-library constraint as above; compare our waits with urllib3's backoff and note it | Small |
| The download lock (`scripts/offline_maps/inventory.py`, `lock`) | A lock file with the holder written in it | `filelock` (standard for this) | Same constraint; keep | — |
| Railways close together drawn as one (`background/close_lines.py`) | Tracks within a distance merged | Planetiler's line merging (`FeatureMerge.mergeLineStrings`, with a minimum length and tolerance), JTS `LineMerger` | Compare with Planetiler's `mergeLineStrings` parameters (we follow Planetiler for roads already: `zoomed_roads.py`) | Medium, to check |
| Buildings zoomed out (`background/zoomed_buildings.py`) | Big buildings kept, from zoom 15 tiles | Planetiler's `FeatureMerge.mergeNearbyPolygons` (what Protomaps' own build uses) | Compare; use its buffer-and-merge parameters if ours differ | Medium, to check |
| Hiding key rows by filter (`web/src/fork/ui/key/feature-hider.ts`) | Filters rebuilt from each layer's icon or colour expression | MapLibre has no per-value toggle; `maplibre-gl-legend` and similar plugins hide whole layers only | Keep (nothing does it per value); note why in its header | — |

## Already reused (no change)

LOOM for tram and metro lanes; Planetiler's way of drawing roads zoomed out
(`zoomed_roads.py`); osmium for OpenStreetMap extracts; pmtiles (go and Python) for
tile files; `mapbox_vector_tile`; contourpy (marching squares); polygon-clipping;
mgrs; magvar; togeojson; jsPDF; the armyc2 renderer for military symbols; PostGIS
and `pg_trgm` for search; MapLibre's hillshade and terrain.

## Our own, nothing to reuse

Domain rules with no library: military site names (`site-rules.sql`), power line
tracing and tower numbering (`line_trace/`, `tower_numbers/`), stand lead-ins
(`stand_lead_ins.py`), the offline maps menu (`ui.py`, `offers.py`), vector tile
layers taken apart undecoded (`mvt.py`: decoding with `mapbox_vector_tile` was the
slow part it replaced).
