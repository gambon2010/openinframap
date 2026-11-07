"""Fork: where the offline caches are (scripts/fetch_images.py fills them): the
repository's data/ folder, mounted at the same place in the backend's container."""

from pathlib import Path

LOCAL_DATA_DIR = Path(__file__).resolve().parents[3] / "data"
IMAGES_DIR = LOCAL_DATA_DIR / "images"
WIKIDATA_JSON_DIR = LOCAL_DATA_DIR / "wikidata_json"
