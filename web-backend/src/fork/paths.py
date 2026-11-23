"""Fork: where the backend finds its data: the repository's data/ folder (the same
folders as scripts/data_folders.py and scripts/lib/common.sh: a test checks they
agree). In the container only data/map/ is mounted, read-only, at the same place
(/data/map); the rest is for the commands run on this computer (grid_check)."""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parents[3] / "data"

# What the app needs: the offline maps, the Wikidata cache (scripts/fetch_images.py).
MAP_DIR = DATA_DIR / "map"
OFFLINE_MAPS_DIR = MAP_DIR / "offline-maps"
IMAGES_DIR = MAP_DIR / "images"
WIKIDATA_JSON_DIR = MAP_DIR / "wikidata_json"

# This installation's own, and what can be downloaded again.
LOCAL_DIR = DATA_DIR / "local"
DOWNLOADS_DIR = DATA_DIR / "downloads"
OSM_DIR = DOWNLOADS_DIR / "osm"
