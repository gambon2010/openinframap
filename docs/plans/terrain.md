# Terrain: contour lines, hill shading, 3D relief (2026-11-20)

Asked for: contour lines, shading on hills, and the relief seen in the 3D view, all
offline. Next step after it (kept in mind here, built later): a signal propagation
mode, how far a radio reaches given the terrain and buildings.

## The data: Mapterhorn's terrain tiles

One file of elevation tiles gives all three (and the elevations the radio mode
needs): MapLibre draws hill shading and 3D relief from a `raster-dem` source, and
contour lines are computed from the same tiles in the browser.

**Mapterhorn** (https://mapterhorn.com, an open project with Protomaps' backing)
publishes terrain tiles for the world as PMTiles, our imagery's format:

- Terrarium encoding (MapLibre reads it), 512-pixel tiles, **lossless WebP**
  (checked: `VP8L`; a tile decodes to exact elevations, 1/256 m steps): good for
  calculations, not only pictures.
- **France is IGN's own data**: RGE ALTI 1 m and 5 m, and the newer LiDAR HD
  (0.5 m) where it's out, all Licence Ouverte 2.0; the rest of the world Copernicus
  GLO-30 (30 m), with other countries' agencies' models in Europe (its
  `source-catalog`). Credit: "Mapterhorn; IGN; Copernicus" (plus the countries in
  view).
- Split: `planet.pmtiles` holds zooms 0 to 12 (356 GB for the world); zooms 13 to
  17/18 are in files per zoom 6 tile (`6-32-22.pmtiles`...), listed with their
  bounds and md5 in `download_urls.json`. `pmtiles extract --bbox` cuts an area out
  of each, over HTTP, without downloading the whole.

Measured for metropolitan France (bounding box, so some neighbours and sea; dry runs
of `pmtiles extract`, 2026-11-20):

| Zooms | Pixel in France | Size | Use |
|---|---|---|---|
| 0–12 | 13 m | 2.3 GB | shading, contours to 20 m, 3D at a distance |
| + 13 | 6.6 m | + 7 GB (9.3 GB) | contours to 5 m, 3D close up; matches RGE ALTI 5 m |
| + 14 | 3.3 m | + 28 GB (≈ 38 GB) | not needed (below) |
| + 15 | 1.6 m | ≈ + 120 GB | not needed |

Chosen (2026-11-20): zooms 0 to 13 for the region (France 9.3 GB). Zoom 14 isn't
offered: the radio mode doesn't need it (radio models are used with 30 to 90 m
terrain; what blocks a signal at street level is buildings, which come from their
outlines and heights, not the terrain file). It can be added later as a choice if a
use shows up.

Considered and not taken: IGN's RGE ALTI files direct (1 m only per département,
7 GB of text grids each: we'd convert all of France with GDAL to get what Mapterhorn
already made from them); BD ALTI 25 m (coarser than the planet file's zoom 12);
Copernicus GLO-30 direct (30 m, already inside the planet file); AWS Terrain Tiles
(older, coarser).

## 1. Download it offline (scripts)

- A source file `scripts/offline_maps/sources/mapterhorn.py`: a new layer "terrain"
  (beside overview, regional, detailed, basemap), fetched as "extract" like the
  background map: the area's box cut out of `planet.pmtiles` (zooms 0–12) and of
  each zoom 6 file it touches (13), merged (`pmtiles merge`) into
  `data/offline-maps/<area>.terrain-mapterhorn.pmtiles`. Sizes from the table
  (measured per km², like the other sources), md5 from `download_urls.json`.
- Not an option (the owner, 2026-11-20): downloading a region's offline maps
  downloads its terrain too, always, zooms 0 to 13. It comes with the region's
  background map (`build-region.sh`'s `--basemap full`, the offline maps menu's
  background map step): no menu line or question of its own; its size is added to
  the background map's in the estimates. Resumed and checked like the others; the
  inventory lists it.
- Served by the `pmtiles serve` service that serves the imagery (same folder, same
  URL scheme): no new container. (Its name, `satellite`, then says less than it
  serves: renaming it is a clean-up to report, not part of this.)
- The export/import scripts copy nothing new (`data/offline-maps/` is copied apart).
- Tests: the source's sizes and zooms, the menu's line, the extract's commands with
  the fake docker.

## 2. Hill shading and contour lines (frontend)

A module `web/src/fork/modules/terrain/`, its look written in `docs/STYLE.md` first:

- One `raster-dem` source, the terrain file, through **maplibre-contour**
  (onthegomap, `DemSource`): it fetches each elevation tile once and shares it
  between the shading, the 3D relief and the contours (`sharedDemProtocolUrl`),
  computing contour lines into vector tiles in a web worker. Offline: it reads only
  our tiles.
- **Hill shading**: MapLibre's `hillshade` layer (light from the north-west,
  `multidirectional` method), above the background's land cover and water, below
  roads, buildings, labels and the infrastructure; over the map and over imagery
  alike (its own strength for each); whether it stays over imagery, the owner
  decides after seeing it. Light and bold looks.
- **Contour lines, as on US military maps** (FM 3-25.26 / TC 3-25.26, Map Reading
  and Land Navigation, ch. 10; the US Army's 1:50,000 topographic line maps):
  - brown;
  - **index contours**: every fifth line, heavier, its height written on it
    (metres), the number's top facing uphill where MapLibre allows;
  - **intermediate contours**: the four fine lines between, no number;
  - the interval (height between two lines) as on the maps' scales: 20 m around
    zoom 12–13 (the 1:50,000 sheets' usual interval; index lines every 100 m), 10 m
    from zoom 14 (1:25,000), 50 m at zoom 11, 100 m at zooms 9–10 (1:250,000);
  - **supplementary contours** (dashed, half the interval, for flat ground) and
    **depression contours** (closed lines with ticks pointing downhill): wanted
    too, but maplibre-contour draws neither; dashed half-interval lines from zoom 14
    are easy, depressions would need the lines' direction (a later step, possibly
    in the backend);
  - labels avoid the infrastructure's.
- The layer switcher: a "Terrain" group, "Hill shading" and "Contour lines", each
  its own entry (remembered as the others). Greyed out with a hint where no terrain
  file covers the view (as imagery does).
- Credit in the map's attribution while either is shown.
- Settings → Map sources: the terrain file's URL, like the imagery's.
- Tests: the contour intervals by zoom, the layer order helper, the source's URL.

## 3. Relief in the 3D view

- The 3D button (`modules/view3d`) also turns on `map.setTerrain` with the terrain
  source (true heights: exaggeration 1, the owner's choice), and a sky and haze at
  the horizon; off again with it. Without a terrain file, 3D stays as now (flat,
  buildings rising).
- The steepest tilt goes up from 60° to 75° in 3D (MapLibre allows 85°): looking
  along a valley needs it.
- Buildings (fill-extrusion) stand on the ground by themselves; to check: My layers'
  drawing and clicking (MapLibre unprojects onto the relief), the sites' and towers'
  symbols, the measuring tools, the print module (prints flat).
- Speed: terrain costs GPU; it's on only in 3D.

## 4. Elevations in the backend (also the radio mode's base)

- `web-backend/src/fork/terrain/`: reads the same PMTiles (the file, not the HTTP
  service), decodes the WebP tiles (Pillow) into elevation grids, cached:
  `elevation(lon, lat)` and `profile(a, b, step)` (elevations along a line).
- First uses: the height under the cursor in the coordinates box, and in popups
  ("Elevation 312 m"); a line-of-sight check between two points, with its profile
  drawn (it's in the battle-tracking backlog: terrain and line of sight).
- Tests: decoding a terrarium tile (a small fixture), a profile across a known
  slope.

## Next: signal propagation (not built now)

What it needs, and what the steps above already lay down:

- **Terrain**: the elevations of step 4, from the same file (6.6 m: finer than radio
  models are usually given). Mapterhorn is bare ground (a terrain model), so:
- **Buildings**: heights from the background map's buildings (Protomaps' `height`
  and `min_height`, already used by the 3D view), or IGN's BD TOPO buildings (a
  height for every building in France, Licence Ouverte) if those are too often
  missing; IGN's LiDAR HD surface model (ground plus buildings and trees) is another
  way, heavy.
- **Clutter**: forests and built-up land (the background map's land cover) as an
  added loss.
- **Models**: line of sight with Fresnel zone clearance (VHF/UHF radios), the
  Longley-Rice / ITM model (NTIA's public domain code; 20 MHz to 20 GHz, terrain
  aware) for range, ITU-R P.2108 for clutter. Inputs: frequency, power, antenna
  heights and gains, the receiver's sensitivity.
- **Computing**: in the backend, along radials from the transmitter (several
  hundred, one sample per terrain pixel, out to tens of km) with numpy; a coverage
  grid back to the map as an image or contours of received strength, in My layers'
  style so it can be kept. Fits the big picture's radio emulator.
- Decisions now that keep this open: lossless elevation tiles (Mapterhorn's are);
  one terrain file for drawing and for computing; the backend reader (step 4) as the
  only place elevations are read.

## Decided (2026-11-20)

- Detail: zooms 0–13 (France 9.3 GB); no zoom 14.
- Hill shading over the map and over imagery; over imagery to be judged once seen.
- 3D: true heights (exaggeration 1).
- Contour lines: as on US military maps (above).
- Terrain isn't an option: it comes with a region's offline maps.
