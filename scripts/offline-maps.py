#!/usr/bin/env python3
"""
Offline maps into data/offline-maps/: satellite imagery, aerial photos and
background maps (the code: scripts/offline_maps/). Usually run from the menu,
bash scripts/offline-maps.sh, or by build-region.sh.

    python3 scripts/offline-maps.py maps            the menu (what's there, add, remove)
    python3 scripts/offline-maps.py maps --source ID --yes      add one, no questions
    python3 scripts/offline-maps.py zoomed-out --area AREA
    python3 scripts/offline-maps.py --help          every command (the menu's downloads
                                                    are commands too: overview, regional,
                                                    detailed, bdortho, basemap)

GDAL, pmtiles and the backend's image run in Docker (offline_maps/docker.py).
Standard library only.
"""

from __future__ import annotations

import sys
from pathlib import Path

# The code is in scripts/offline_maps/. Run as a script (python3 -I), Python doesn't look next to it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from offline_maps.cli import main

if __name__ == "__main__":
    main()
