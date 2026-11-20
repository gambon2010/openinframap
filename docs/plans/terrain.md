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

## 1. Download it offline (scripts) (done, 2026-11-20)

- `scripts/offline_maps/terrain.py`: the area's outline cut out of each Mapterhorn
  file whose bounds meet it (`planet.pmtiles` to zoom 12, the zoom 6 files at 13;
  `download_urls.json` lists them), the empty parts dropped, the rest merged
  (`pmtiles merge`, go-pmtiles 1.31) into `data/offline-maps/<area>.terrain.pmtiles`.
  Luxembourg: 43 MB in 8 s.
- Not an option (the owner): it comes with an area's background map (`basemap`
  command, so `build-region.sh --basemap full` and the menu's background map), its
  size in the background map's estimate ("Background map and terrain"). A
  background map without terrain (made before, or the download failed) gets a
  "Terrain" line in Add, like the zoomed out buildings; removing the background map
  removes it.
- Served by the `pmtiles serve` service that serves the imagery (same folder):
  `/satellite/<area>.terrain/{z}/{x}/{y}.webp`. (Its name, `satellite`, then says
  less than it serves: a clean-up to report.)

## 2. Hill shading (frontend)

A module `web/src/fork/modules/terrain/`, its look written in `docs/STYLE.md` first:

- A `raster-dem` source (Terrarium, 512-pixel tiles, to zoom 13), the terrain file;
  the same source for the 3D relief.
- MapLibre's `hillshade` layer, drawn by the graphics card from the elevations
  (light from the north-west, `multidirectional`), above the background's land cover
  and water, below roads, buildings, labels and the infrastructure; over the map and
  over imagery alike (its own strength for each); whether it stays over imagery,
  the owner decides after seeing it. Light and bold looks.
- The layer switcher: a "Terrain" group with "Hill shading" (and "Contour lines",
  step 4), remembered as the others; greyed out where no terrain file covers the view.
- Credit in the map's attribution while shown; Settings → Map sources: the terrain
  file's URL, like the imagery's.

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

## 4. Elevations and contour lines in the backend

The project computes map data before the browser (PostGIS, the backend's zoomed out
layers); contour lines too, as tiles are asked for (decided 2026-11-20), with the
elevation reader the radio mode will use.

- `web-backend/src/fork/terrain/`: reads the terrain file (the PMTiles package),
  decodes its WebP tiles (Pillow) into elevation grids (numpy), cached:
  `elevation(lon, lat)`, `profile(a, b)`, and a tile with its neighbours' edges.
- **Contour tiles** (`/terrain/contours/{z}/{x}/{y}.mvt`, zoom 9 to 16, past 13 from
  zoom 13's elevations): marching squares on the tile and a margin of its
  neighbours, the lines clipped to the tile, kept in a cache folder; served through
  the gate like the background map.
- **As on US military maps** (FM 3-25.26 / TC 3-25.26, Map Reading and Land
  Navigation, ch. 10; the Army's 1:50,000 topographic line maps):
  - brown;
  - **index contours**: every fifth line, heavier, its height in metres written on
    it, the number's top facing uphill where MapLibre allows;
  - **intermediate contours**: the four fine lines between, no number;
  - the interval as on the maps' scales: 100 m at zooms 9–10 (1:250,000), 50 m at
    11, 20 m at 12–13 (1:50,000; index lines every 100 m), 10 m from 14 (1:25,000).
- Drawn by the terrain module, "Contour lines" in its group; labels avoid the
  infrastructure's.
- Tests: decoding a Terrarium tile (a small fixture), contours of a known cone
  (rings, heights, index levels), the interval by zoom.

## 5. Supplementary and depression contours (backend)

- **Supplementary contours**: lines at half the interval, kept only where the ground
  is flat (the slope from the same elevations: regular lines there would be more
  than about 60–80 px apart on screen), cut where it steepens, short scraps dropped;
  drawn dashed. Threshold tuned by eye.
- **Depression contours**: a line's lower side is known from the marching squares'
  direction; a closed line with its lower side inside is a depression (a doline, a
  quarry, a crater). Drawn with ticks on its downhill side (an icon along the line,
  pushed off it: MapLibre turns the offset with the line), index ones too. Seen
  whole when they fit in the tile and its margin (about a tile wide); bigger ones
  stay ordinary lines.
- Tests: a bowl (a depression ring, ticks inward), a plain with a gentle rise
  (supplementary lines only on the flat).

## 6. Heights on the map

- The height under the cursor in the coordinates box, and in popups ("Elevation
  312 m"), from the backend's reader.
- A line-of-sight check between two points, with its profile drawn (the
  battle-tracking backlog's terrain and line of sight).

## Next: signal propagation (not built now)

What it needs, and what the steps above already lay down:

- **Terrain**: the backend's elevation reader (step 4), from the same file (6.6 m: finer than radio
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
  only place elevations are read in Python.

## Decided (2026-11-20)

- Detail: zooms 0–13 (France 9.3 GB); no zoom 14.
- Hill shading over the map and over imagery; over imagery to be judged once seen.
- 3D: true heights (exaggeration 1).
- Contour lines: as on US military maps (above), made in the backend as tiles are
  asked for (not in the browser: the project computes map data before it).
- Hill shading and 3D relief: MapLibre's own, from the elevation tiles.
- Terrain isn't an option: it comes with a region's offline maps.
