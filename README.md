# Open Infrastructure Map, offline

A fork of [Open Infrastructure Map](https://github.com/openinframap/openinframap) that
runs **entirely on your own computer, without the internet**: the map of the world's
power, telecoms, oil, gas and water infrastructure from OpenStreetMap, built for the
region you choose (a country up to the whole world), with layers, terrain and tools
of its own. A built map can be exported and copied to a computer that never goes
online.

## The map

- **Infrastructure** from OpenStreetMap, as upstream draws it: power lines and
  substations (each tower numbered along its line), telecoms, pipelines, water.
- **Critical sites**: hospitals and fire stations; police, gendarmerie and customs;
  town halls, prefectures and public services; places of worship; fuel stations and
  storage tanks; airports, ports and rail yards; military sites sorted by what they
  are (air, naval and army bases, schools, depots, ranges, forts, radar and radio
  stations, research centres, disused fortifications in grey); food supply; dams,
  landfills and weather stations. Nearby sites are grouped into a numbered bubble
  zoomed out.
- **Open data from outside OpenStreetMap**, drawn like the rest and never duplicating
  it. For France so far: every low and medium voltage power line and street
  substation, the gas distribution network, biomethane injection points, and the
  regulated industrial sites (ICPE, Seveso).
- **Roads, railways, trams and metro** in the same look at every zoom, each tram and
  metro line in its own colour and lane; **buildings**, raised to their height in 3D.
- **The background map** (streets, places, buildings) and **satellite imagery** (NASA
  Blue Marble for the world, Sentinel-2 at 10 m, IGN's 20 cm aerial photos in
  France), downloaded per region.
- **Terrain**: hill shading, contour lines as on military maps (index, intermediate,
  supplementary and depression contours, each part with its tick box), the relief in
  the 3D view.
- **A key that hides things**: untick any kind of line, icon or area to take it off
  the map.
- **Search** for places and every named thing on the map, offline.

## Working on it

- **My layers**: your own layers on the map: military symbols and tactical graphics
  (MIL-STD-2525), markers, pictures, lines, areas, copies of map features. Saved in
  the database, shared with other accounts, updated live, with a history you can play
  back and saved situations; conflicts between two people's changes resolved side by
  side.
- **Measuring**: distances, areas, range rings, bearings from true, magnetic or grid
  north; **line of sight** between two points over the terrain, with its profile.
- **Where the cursor is**: latitude and longitude, the military grid reference (MGRS),
  the ground's height and slope, the magnetic declination, the distance and bearing
  from your last click. A clicked thing's details show its height too.
- **Printing** a map as a PDF with its legend; **import and export** of your layers
  (GeoJSON, KML, GPX).

## Offline and secure

- **One command builds a region**: download its OpenStreetMap data, filter it to
  infrastructure, import it, add the extra data; a menu downloads its offline maps.
- **Export and import**: a built map (database and Docker images) saved to a file and
  restored elsewhere in minutes, offline.
- **A login for the whole app**: every request goes through one gate that needs a
  logged-in account; the other services only listen on the computer itself.

## What you need

Docker (with Compose v2), Node.js and npm, curl, python3, unzip and
[uv](https://docs.astral.sh/uv/). For computers without the internet, installers of
Docker (every large Linux distribution and Windows, Intel/AMD and ARM) and of the
development tools can be kept in `data/installers/`
(`uv run --project scripts scripts/fetch_installers.py`).

Disk space, measured (November 2026):

| | France | Europe |
|---|---|---|
| OpenStreetMap download (can be deleted after the build) | 4.8 GB | 33 GB |
| The built database | 7.7 GB | about 53 GB |
| Background map | 5.1 GB | 49 GB |
| Terrain (to 6.6 m) | 5.6 GB | 67 GB |
| Satellite imagery, Sentinel-2 (to 10 m) | 0.5 GB | about 10–42 GB |
| IGN aerial photos (20 cm, France only) | about 1.5 GB a département (zoom 17) | — |

## Getting started

```bash
# First time: pick a region, build (or import) the database, create the settings,
# then start the app and open it in your browser
bash scripts/launch.sh

# Every time after that: start everything and open the map
bash scripts/start.sh

# Offline maps: background map and terrain, satellite imagery, aerial photos
bash scripts/offline-maps.sh
```

## Where things are documented

- [docs/LOCAL_DEVELOPMENT.md](./docs/LOCAL_DEVELOPMENT.md): the user's guide.
- [docs/FORK_ARCHITECTURE.md](./docs/FORK_ARCHITECTURE.md): how the fork is built,
  every module, script and SQL file.
- [docs/STYLE.md](./docs/STYLE.md): how the application looks.
- [docs/SPECIFICATIONS.md](./docs/SPECIFICATIONS.md): everything asked for, and its
  status.
- [docs/HISTORY.md](./docs/HISTORY.md): what changed, when and why.
- [docs/FORK_CHANGES.md](./docs/FORK_CHANGES.md): every upstream file the fork changes.
- [docs/plans/](./docs/plans/): the plans for bigger features.

## Upstream

The upstream project is [Open Infrastructure Map](https://openinframap.org), a map of
the world's infrastructure from [OpenStreetMap](https://www.openstreetmap.org)
([its architecture](./docs/architecture.md),
[contributing](https://github.com/openinframap/openinframap)).

[![IRC](https://img.shields.io/badge/IRC-%23osm--infrastructure-brightgreen)](https://webchat.oftc.net/?channels=osm-infrastructure)
[![Matrix](https://img.shields.io/matrix/osm-infrastructure:matrix.org?server_fqdn=matrix.org&logo=matrix)](https://matrix.to/#/#osm-infrastructure:matrix.org)
