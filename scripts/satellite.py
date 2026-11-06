#!/usr/bin/env python3
"""
Offline satellite imagery for the built region, in three tiers (one PMTiles file
each, in data/basemap/, served by the `basemap` Compose service like the offline
background map). Run by scripts/build-region.sh; see docs/plans/satellite-imagery.md.

  overview   zoom 0-8   NASA Blue Marble Next Generation (NASA GIBS, 500 m):
                        the whole world to zoom 8 (--world, one file for every
                        region), or the world to zoom 5 and a region's box to 8.
  regional   zoom 7-12  Sentinel-2 10 m yearly composite (ESA WorldCover 2021,
             (or 13)    CC BY 4.0), read straight from the public COGs with GDAL
                        (only the needed parts are downloaded), cut to the region.
  detailed   zoom 14-17 IGN orthophotos, 20 cm (France only, Licence Ouverte),
                        from the Géoplateforme WMTS, cut to the region; throttled.

    python3 scripts/satellite.py estimate --outline AREA.geojson
    python3 scripts/satellite.py overview --outline AREA.geojson --out FILE.pmtiles
    python3 scripts/satellite.py overview --world --out FILE.pmtiles  (to zoom 8, ~330 MB)
    python3 scripts/satellite.py regional --outline AREA.geojson --out FILE.pmtiles [--maxzoom 13]
    python3 scripts/satellite.py detailed --outline AREA.geojson --out FILE.pmtiles [--maxzoom 16]
    python3 scripts/satellite.py lower-zooms --region france   (Sentinel-2 made before it
                        started at zoom 7: its lower zooms added, nothing downloaded)

The outline is the region's GeoJSON (Geofabrik's, as for the background map). GDAL
and pmtiles run in Docker (GDAL_IMAGE, and the basemap service's image).
Standard library only.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The code is in scripts/satimagery/ (sources, tiles, estimate, download, gdal,
# menu, cli). Run as a script (python3 -I), Python doesn't look next to it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from satimagery import *
from satimagery.cli import main

if __name__ == "__main__":
    main()
