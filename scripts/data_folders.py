"""Fork: where the scripts keep their data (the same folders as lib/common.sh's and
the backend's src/fork/paths.py: scripts/tests/test_one_source.py checks they agree).

data/map/        what the app needs (copied to a drive, only read when running)
data/local/      this installation's own (never overwritten by an update)
data/downloads/  downloaded again when needed: can be deleted any time
data/installers/ Docker and the development tools, for computers without the internet
"""

from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

MAP_DIR = DATA_DIR / "map"
OFFLINE_MAPS_DIR = MAP_DIR / "offline-maps"
IMAGES_DIR = MAP_DIR / "images"
WIKIDATA_JSON_DIR = MAP_DIR / "wikidata_json"

DOWNLOADS_DIR = DATA_DIR / "downloads"
OSM_DIR = DOWNLOADS_DIR / "osm"
EXTRA_DIR = DOWNLOADS_DIR / "extra"

INSTALLERS_DIR = DATA_DIR / "installers"
