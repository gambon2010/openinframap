# Plan: buildings at zoom 12–14 in the background map

Status: **proposed** (2026-11-16), not started.

## Goal

Buildings drawn from zoom 12, from one source: the background map
(`/background/{z}/{x}/{y}.mvt`). At zoom 12–14, the background map's tiles carry
the buildings big enough to see at that zoom, with the same size rule as the
large buildings removed on 2026-11-16 (about 4 pixels across: ≥ 10,000 m² at 12,
2,500 m² at 13, 600 m² at 14). From zoom 15, Protomaps' own tiles as today. No
database table, no Tegola map, no second layer in the frontend.

## Why the tiles must be edited

Protomaps' tile build leaves buildings out below zoom 15, apart from a few
landmarks. The map draws only what is in the tile for the zoom shown, and it can't
assemble a zoom 12 view from zoom 15 tiles (64 tiles for each one). So the zoom
12–14 tiles need buildings added, made from the zoom 15 tiles we already have.

## How: a side file merged when a tile is served (recommended)

Each downloaded background map `<area>.pmtiles` gets a companion file,
`<area>.buildings.pmtiles`. It holds only zoom 12–14 tiles, each with a single
layer, `buildings`. When the backend serves a zoom 12–14 tile, it appends the
companion's tile to Protomaps' tile.

**Why appending works.** A vector tile is a protobuf message whose layers are a
repeated field, so two tiles' bytes laid end to end (uncompressed) form one valid
tile with the layers of both. Appending costs a fraction of a millisecond, with no
decoding. Protomaps' tiles already have a small `buildings` layer of landmarks at
these zooms. When two layers share a name, MapLibre keeps the last one
(`@mapbox/vector-tile`: `layers[layer.name] = layer`, checked). Ours comes last,
so it replaces the landmarks. It holds them anyway, since landmarks are big.

**Why a side file rather than rewriting the downloaded file:**

| | Side file (recommended) | Rewrite `<area>.pmtiles` |
|---|---|---|
| Work per area | Write only the new tiles (~200 MB for France) | Decode and re-encode every zoom 12–14 tile (~370,000 for France) and copy the other 5 GB |
| Time, France | ~10–15 min | ~40 min, plus 5 GB of free space while it runs |
| Downloaded file | Untouched: still Protomaps' file of that edition, so the menu's "newer edition" check holds | Changed: no longer Protomaps' file |
| Undo or redo | Delete or remake one small file | Download the area again |
| Serving | One extra tile lookup and appending, zoom 12–14 only | Nothing extra |

## Making the side file

Code: `web-backend/src/fork/background/zoomed_buildings.py`. It goes in the
backend's image because that already has `pmtiles`, `mapbox-vector-tile` and
`shapely`, and the scripts run it there the way they ran `large_buildings.py`.

For one area, it works through **one zoom 12 block at a time** (64 zoom 15 tiles),
in parallel over blocks (8 processes):

1. Decode the block's zoom 15 tiles and keep `kind == "building"` features.
2. Join each building's pieces by id within the block, then measure it on the
   ground. A building crossing the block's edge is measured from its part inside;
   the rare one that falls under the threshold that way can be caught by also
   reading the ring of tiles around the block (+56% reading), which is optional.
3. From that one list of buildings, write 1 zoom 12, 4 zoom 13 and 16 zoom 14
   tiles. Each keeps the buildings over that zoom's size, simplified to about a
   pixel of the zoom and clipped to the tile with a small buffer. Properties are
   `kind`, `height`, `area_m2` and the building's id. The id stays Protomaps'
   own, so copies and `/background/building/{id}` keep working.
4. Write the tiles in tile-id order with `pmtiles.writer`, gzip, into
   `.<area>.buildings.pmtiles.part`, then rename it into place. A stopped run
   leaves no half file.

`main(area)` does one area: `python -m src.fork.background.zoomed_buildings --area france`.

## Where it runs

- **When a background map is downloaded:** `command_basemap` in
  `scripts/satimagery/extract.py` runs it right after the download, when the file
  has zoom 15. The world to zoom 8 doesn't, so it is skipped. This covers the
  offline maps menu, `build-region.sh` (its downloads go through the menu's queue)
  and `--maps`. A newer edition downloaded later replaces the companion too.
- **For an area already downloaded** (France today): `satellite.py
  zoomed-buildings --area france`. The menu's background map row also shows
  "zoomed-out buildings missing" and offers to make them, so nobody needs the
  command.
- **Removing an area** in the menu deletes its companion too.

## Changes, file by file

| File | Change |
|---|---|
| `web-backend/src/fork/background/zoomed_buildings.py` | New: the build step above |
| `web-backend/src/fork/background/__init__.py` | `is_background_map` ignores `*.buildings.pmtiles`. `Archive` opens its companion if there is one. In `tile()`, for zoom 12–14, appends the companion's tile from the **same area** as the base tile (decompress both, append, gzip again) |
| `scripts/satimagery/extract.py` | After the download, run the step (Docker, as before); new `command_zoomed_buildings` |
| `scripts/satimagery/cli.py` | `zoomed-buildings --area` |
| `scripts/satimagery/inventory.py` | The companion counted with its area's background map (size, missing or present); `identify` doesn't take it for imagery |
| `scripts/satimagery/offers.py`, `maps.py` | Offer it when missing; delete it with its area |
| `web/src/fork/core/buildings.ts`, `modules/buildings/index.ts` | `BUILDINGS_MINZOOM` 15 → 12, same source and layer (one layer, no second source); details use `area_m2` when the tile has it (zoomed out), otherwise measure the outline as today; label "Buildings" |
| `docs/…` | `ARCHITECTURE.md`, `LOCAL_DEVELOPMENT.md` (offline maps), `SPECIFICATIONS.md` 10.9, `HISTORY.md`, `CLAUDE.md` (background service line) |

No upstream file changes. No database, Tegola, schema or export change: the
companion lives in `data/basemap/`, copied with the rest.

## Tests

- Backend (`tests/fork/`): blocks to tiles on a small fake area (a building cut
  across four zoom 15 tiles comes out whole, a small one only at zoom 14, a tiny
  one never); appending (a tile from the background map plus the companion has
  both layers, ours last); `is_background_map` ignores companions; zoom 11 and 15
  tiles come out unchanged.
- Scripts (`scripts/tests/`): a downloaded area queues or runs the step, the world
  to zoom 8 doesn't, removing an area deletes its companion, the inventory shows
  "missing".
- Frontend: the buildings layer's min zoom; details use `area_m2`.
- By hand on France: time and size of the step; tile times over Paris at zoom 12–14
  (target under 10 ms more than today); a look over Paris and a village.

## Estimates

- **Work:** about a day, tests included.
- **Running it for France:** ~10–15 min, about what the old step took. The reading
  is the same; there's no database to write, only tiles.
- **Size for France:** ~150–300 MB. The removed table was 382 MB at full detail;
  the tiles are simplified for their zoom.

## Steps

1. The step on Luxembourg, then Paris (one zoom 10 block): check tile sizes and the
   look.
2. Appending in the backend, and the frontend from zoom 12: check it draws, then
   clicks and copies.
3. Hooks in `extract.py`, the menu and the inventory.
4. Full France run; times and sizes into `HISTORY.md`; docs; re-export
   (`data/basemap/` to copy).
