# Plan: satellite imagery, offline, chosen in the build script

Status: implemented 2026-10-30 (see FORK_CHANGES.md "Satellite imagery"). Measured
sizes turned out much smaller than estimated below for the regional tier.

## Goal

An optional satellite background, chosen in `scripts/build-region.sh` like the
offline background map, served locally (works offline, included in exports), in
three tiers so the zoomed-out view costs almost nothing and detail is only paid for
where it's wanted:

| Tier | Zooms | Source | Resolution | Licence | Size (France) |
|---|---|---|---|---|---|
| 1. Overview | 0–8 | NASA Blue Marble Next Generation (NASA GIBS) | 500 m | NASA imagery: free to use, credit NASA | ~20 MB for the world at z0–5, plus the region at z6–8: ~50–150 MB total |
| 2. Regional | 9–13 (14 optional) | Sentinel-2 cloud-free yearly composite, 10 m (ESA WorldCover S2 RGBNIR 2021) | 10 m | CC BY 4.0 per AWS Open Data (to confirm on the product page) | ~2 GB to z13; ~+6 GB with z14 |
| 3. Detailed (optional, per area) | 15–17 (18) | France: IGN orthophotos (BD ORTHO / Géoplateforme), 20 cm | 20 cm | Licence Ouverte Etalab 2.0 | ~5 GB per département to z17 |

Facts checked: NASA GIBS serves `BlueMarble_NextGeneration` (also `_ShadedRelief`,
`_ShadedRelief_Bathymetry`) in EPSG:3857 as JPEG with tile matrix set
`GoogleMapsCompatible_Level8`, i.e. zoom 0–8, no key needed. The WorldCover
composites are in the public `esa-worldcover-s2` bucket (eu-central-1, no AWS
account needed). BD ORTHO is 20 cm JPEG2000, downloadable per département
(e.g. Doubs 2020: ~24 GB raw), Licence Ouverte.

Not used: Esri / Google / Bing imagery (terms forbid storing it for offline use);
EOX Sentinel-2 cloudless 2018+ (CC BY-NC-SA, non-commercial, and bulk-copying their
tile server isn't allowed; their 2016 edition is CC BY but older); scraping any tile
server without an open licence.

## How it fits the existing pieces

- **Files:** `data/satellite/<tier>-<area>.pmtiles` (raster, WebP or JPEG tiles).
  `data/` is gitignored already.
- **Serving:** the existing `basemap` Compose service (`pmtiles serve`) also serves
  raster PMTiles; mount `data/satellite/` next to `data/basemap/` (or serve both
  from one folder). No new service, no Tegola change (Tegola only does vector).
- **Frontend (`web/src/fork/satellite/`, a new fork module):**
  - One raster source per tier, each with its own `minzoom`/`maxzoom`. The
    overview layer has no layer `maxzoom`, so MapLibre over-zooms it under the
    regional one: outside the region (or past the last tier) you still see the
    coarser image instead of a hole.
  - Choice in **Settings**: Background = Map / Satellite / Satellite with labels
    and roads (the Protomaps labels, roads and boundaries drawn over the imagery).
    Stored per browser like the other settings; a quick toggle button can come
    later.
  - Attribution added automatically for each tier in use.
  - Infrastructure stays drawn on top; lines may need a light casing on imagery
    (check legibility on dark forests).
- **Config:** `web/.env` gets `VITE_SATELLITE_URLS` (tier URLs, written by the build
  script like `VITE_BASEMAP_URL` is by `select_basemap`); Settings shows them in the
  map sources section with the same "change for this tab" controls.

## Build script (`scripts/build-region.sh`)

All questions stay at the start, before the long steps (as now):

```
Satellite imagery (optional, works offline):
  1) None
  2) Overview only: NASA Blue Marble, zoom 0-8           ~100 MB, ~2 min
  3) + Regional: Sentinel-2 10 m, zoom 9-13 for <region>  ~2.1 GB, ~40 min
  4) + Regional to zoom 14                               ~8 GB,   ~2 h
Detailed imagery (France only, 20 cm, IGN): départements to include?
  [none] / list (e.g. 67,68) / "region"                  ~5 GB each to z17
```

Estimates are computed from the region's area (the Geofabrik outline the basemap
step already downloads): tiles per zoom = area / tile area at that latitude, times
an average tile size measured in the prototype.

Steps, after the database and the background map (so a failure here doesn't lose
the build):

1. **Overview** (`scripts/satellite.py overview`): fetch Blue Marble tiles from
   GIBS: the whole world at z0–5 (1,365 tiles), the region's bounding box at z6–8.
   Written straight into an MBTiles file, converted with `pmtiles convert`. Reused
   across regions (one world file + per-region extra).
2. **Regional** (`satellite.py regional`): list the WorldCover 3°×3° tiles that
   touch the region outline; read only the RGB bands, through GDAL (`/vsicurl/` /
   `/vsis3/` range reads of the COGs, so only the needed tiles and bands are
   transferred); stretch the 16-bit reflectance to 8-bit with one fixed curve (the
   same everywhere, so tiles match); warp to EPSG:3857; cut tiles z9–13 clipped to
   the outline (`gdal_translate -of MBTILES` + `gdaladdo`, or `gdal2tiles` then
   pack); WebP quality ~75; `pmtiles convert`. GDAL runs in its official Docker
   image (`ghcr.io/osgeo/gdal`), so nothing new to install on the host.
3. **Detailed** (`satellite.py ign --dept 67`): for France, either download the
   BD ORTHO département archive (complete, ~24 GB raw, then tiled like step 2) or
   fetch tiles from the IGN Géoplateforme WMTS (`ORTHOIMAGERY.ORTHOPHOTOS`, open,
   no key) for the département's outline only, throttled to stay within fair use.
   The prototype decides which (WMTS is far less to download; the archive is the
   official bulk route).
4. Record what was built in the export manifest and `oim_build_info`;
   `select_satellite` writes `VITE_SATELLITE_URLS` (like `select_basemap`).

Downloads are kept in `data/satellite/src/` and reused (like `data/osm/`); a
`--satellite none|overview|regional|regional14` flag for unattended builds;
`--refresh` re-fetches.

**Export / import:** `export-db.sh` asks whether to include the imagery (it can be
far bigger than the database) and copies the `.pmtiles` next to the dump;
`import-db.sh` restores them and runs `select_satellite`.

## Open questions for the prototype

- WorldCover RGBNIR: exact value range and the stretch that looks natural; data
  volume actually transferred for France with range reads (target < 10 GB).
- Seams and colour jumps between the 3° tiles and against Blue Marble at the z8/z9
  switch (a slight colour match on the Blue Marble side may be needed).
- Tile format: WebP (smaller) vs JPEG (faster to encode); MapLibre handles both.
- Whether a newer open 10 m mosaic is worth it: Copernicus Data Space Ecosystem
  publishes quarterly Sentinel-2 cloud-free mosaics (free account needed); 2021
  WorldCover needs no account but is older.
- IGN: WMTS fair-use limits for a whole département; years available per
  département.

## Steps

1. Prototype on Luxembourg: overview + regional, served by `basemap`, Settings
   switch. Measure sizes and times.
2. Build-script questions, estimates, reuse, flags; export/import.
3. France: regional at z13 for the whole country; IGN for one département.
4. Docs: `LOCAL_DEVELOPMENT.md` (choosing imagery, sizes), `FORK_CHANGES.md`,
   attributions on the About page.
