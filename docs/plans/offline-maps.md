# Plan: offline maps, one clear menu (satellite, aerial photos, background map)

Status: **agreed** (2026-11-11): no zoom steps for Blue Marble and Sentinel-2 (their
most, or nothing); aerial photos from zoom 17, more on request. **Steps 1–2 done**
(2026-11-11): sources as files; the inventory and coverage rules.

## Why

The satellite / map download part grew piece by piece: long paragraphs before each
question, each kind of source handled its own way (Blue Marble, Sentinel-2, tile
servers, IGN's files), the background map in another menu, and "what's already
there" guessed from files each time. It offered things that make no sense (Sentinel-2
zoom 13 over France, where IGN's photos take over at 12) and would list every
département one per line.

Goals: **short screens** (KISS), **never offer what's pointless or already there**,
and **a new source or area is one small file**.

## The four ideas

### 1. Sources: one file each

`scripts/satimagery/sources/<id>.py`, each declaring:

| Field | Example (IGN) | Example (Sentinel-2) |
|---|---|---|
| name, credit | "IGN 20 cm", "© IGN" | "Sentinel-2 10 m", "© ESA" |
| detail (m/pixel) | 0.2 | 10 |
| zooms: from, useful up to, max | 12, 17, 19 | 7, 13, 13 |
| coverage | France, by département | anywhere (any Geofabrik area, or the world) |
| units | départements (`departements.py`) | one unit: the area chosen |
| fetch | files + converter (`bdortho.py`) | ESA cells + GDAL |
| size per km² per zoom, download per km² | measured (Bas-Rhin) | measured |

Kinds of fetch: *tiles* (a tile server), *wms*, *files by unit* (IGN; later Spain's
sheets, German Länder), *cells* (Sentinel-2), *extract* (the background map, from
Protomaps). The menu, sizes, inventory, progress and the map's tiers all work from
these fields: adding a country is one file. A contract test checks every source
has them.

**Useful up to** is the zoom past which a source adds nothing: Sentinel-2's pixel
is 10 m; zoom 13 is ~13 m a pixel in France (finer near the equator), so 13 is its
end (14 would only stretch it). Blue Marble ends at 8.

**Zooms offered** (no steps to choose between where they'd only confuse):
- Blue Marble and Sentinel-2: their most (useful up to, after the coverage rules
  below), or nothing. One line, one size, yes or no.
- Aerial photos: zoom 17 (cars and small details), or their own most if lower; more
  (18, 19) offered as extras with their sizes, for a few units rather than a country.

### 2. The inventory: what's there

`data/basemap/inventory.json`, one entry per file:

```json
{"source": "fr_ign", "area": "france", "unit": "67", "zooms": [12, 17],
 "edition": "2024", "bytes": 1165816981, "file": "fr-67.sat-detailed-fr_ign.pmtiles",
 "done": "2026-11-07"}
```

- **Files are the truth, the inventory is notes.** On start it's checked against
  `data/basemap/`: a file without an entry gets one (read from its header and name:
  everything downloaded before this exists); an entry without its file is dropped.
  Copying `data/basemap/` to another computer carries it.
- **Partial work** is recorded (`"status": "stopped", "reason": "server blocked",
  "have": 31e9, "of": 48e9`) from the work folders (`.bdortho-33`), and offered
  first: *Resume*.
- **Editions** (IGN re-photographs a département every ~3 years): stored, so an
  *Update* can offer only the départements with newer photos (needs the network;
  the rest of the menu works offline).
- **Settings** (speed cap, default zoom) in `data/basemap/settings.json`, asked once.
- A **lock**: a second menu while a download runs shows its progress instead of
  starting another.

### 3. Coverage: no pointless offers

Zooms stack: Blue Marble 0–8, Sentinel-2 7–13, aerial photos 12–17/19. A coarser
source is only worth its zooms where no finer one takes over:

- **Where aerial photos cover an area** (IGN: all of France, available even if not
  downloaded yet), Sentinel-2's most is **zoom 11** (12+ is IGN's). Its line says
  so: `to 11 (IGN from 12)`.
- **Partly covered** (France while IGN is half done): Sentinel-2 is still offered
  to 11; the gaps show Sentinel-2 at 11 stretched until IGN arrives there, rather
  than downloading zooms that become useless.
- **Areas inside areas**: Sentinel-2 of Alsace when France is there to the same
  zoom: not offered (`covered by France`); to a higher zoom: offered for the
  difference.
- **The world**: Blue Marble (0–8, 285 MB) and Sentinel-2 for the whole world at
  its most (13, ~190 GB, days to make): shown with its size so the choice is clear;
  a country's own Sentinel-2 is the usual choice.

Already-downloaded files that coverage makes redundant (this France file's zooms
12–13) are shown as *could free 400 MB* in Remove, never deleted by themselves.

### 4. Short screens, one question each

All questions through one helper (`ui.py`: `table`, `choose`, `codes`, `confirm`),
so every screen looks the same: short labels, numbers in aligned columns, the
default in brackets, Enter to go back.

**Home**: what you have, grouped by area and source (one line each, however many
units), anything stopped, and four actions:

```
Offline maps                                         270 GB free

 Area        Source             zoom    size
 World       Blue Marble        0–8     285 MB
 France      Sentinel-2 10 m    5–13    512 MB
 France      IGN 20 cm          12–17   1.3 GB   2/96 départements
 France      IGN 20 cm          …       33 Gironde: 31/48 GB, stopped
 Luxembourg  Sentinel-2 10 m    8–12      1 MB
 Luxembourg  Background map     0–15     70 MB

 1 Resume   2 Add   3 Remove   4 Settings      Enter: quit
```

**Add** → which area (the one built, or a search: country, region, *world*) →
what that area can have, with what's left:

```
France                              have        add
 1 Sentinel-2 10 m                  z5–13       —  (IGN from 12)
 2 IGN 20 cm (by département)       2/96        94 left
 3 Background map                   —           1.2 GB
```

Sentinel-2 or Blue Marble picked: no zoom question, straight to the plan (`to 13`,
or `to 11` where aerial photos take over).

→ a source with units: its zoom, then which units:

```
IGN zoom    [17]    more: 18    19
kept, GB    132           528  2110        download 2.6 TB
> 

Départements (94 left)   [Enter: all]   or codes: 33 40 2A   ? : list
> 
```

The list (`?`) shows units in columns, marked ✓ done, ◐ stopped, ↑ newer edition:
only when asked.

→ **Plan**, then start:

```
Plan
 IGN 20 cm   94 départements   z17
 kept ~130 GB · download 2.6 TB · ~3 days at 10 MB/s
 needs up to 100 GB free while converting (270 GB free)
Start? [Y/n]
```

**Progress**: one line per job, a bar, speed, time left; the current unit and how
many are left:

```
IGN 20 cm  33 Gironde  download  ████████░░░░  31/48 GB  10 MB/s  28 min
           1 of 94 · then 40 Landes
```

**Remove** → area → source → (units): shows the space freed; the map's tiers are
updated after.

## Edge cases

| Case | What happens |
|---|---|
| Server blocks the computer (IGN) | The job stops (*stopped: server blocked*); Resume later or through a VPN. |
| No network | Home, Remove, Settings work; Add shows estimates; network actions say so. |
| Disk too small for the plan | Plan says how much is missing; big units first so the peak comes early. |
| Units at different zooms | Home shows the range (`z15–17`); the list shows each. |
| Newer IGN edition | *Update* in Add for that source: only those units, replaced when done. |
| A file copied by hand / from an old build | Read into the inventory on start. |
| A download running in another window | The lock: Home shows its progress. |
| Sentinel-2 of an area inside one already there | Not offered at the same zoom ("covered by France"). |
| Several regions built over time | Home lists every area; Add starts from the one built. |
| The scripts run unattended (`--yes`) | Same plan from options (`--source fr_ign --units 33 40 --zoom 17`). |

## Work, in steps (each tested)

1. Sources as files (move Blue Marble, Sentinel-2, the tile servers, IGN, the
   background map), with the contract test.
2. The inventory, built from what's on disk; coverage rules; tests.
3. The screens through `ui.py`; the scripts' tests drive them with typed answers.
4. `build-region.sh` and `satellite.sh` call the one menu; old options kept.

About a day and a half. Nothing changes for the IGN download running now; it's read
into the inventory at step 2.
