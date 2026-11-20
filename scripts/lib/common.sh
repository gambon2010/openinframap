# shellcheck shell=bash
# ---------------------------------------------------------------------------
# Shared helpers for scripts/*.sh. Source it, don't run it. The paths and colours
# are here; the helpers are in the files below, by theme.
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# data/ in three parts (the same as scripts/data_folders.py and the backend's
# src/fork/paths.py: scripts/tests/test_one_source.py checks they agree):
#   map/        what the app needs: copied to a drive, only read when running
#   local/      this installation's own: never overwritten by an update
#   downloads/  downloaded again when needed: can be deleted any time
DATA_DIR="$REPO_ROOT/data"
MAP_DIR="$DATA_DIR/map"
LOCAL_DIR="$DATA_DIR/local"
DOWNLOADS_DIR="$DATA_DIR/downloads"
OSM_DIR="$DOWNLOADS_DIR/osm"
EEZ_NAME="EEZ_land_union_v4_202410"
EEZ_ZIP="$DOWNLOADS_DIR/$EEZ_NAME.zip"
EEZ_DOWNLOAD_URL="https://marineregions.org/download_file.php?name=$EEZ_NAME.zip"
EEZ_INFO_URL="https://marineregions.org/sources.php#unioneezcountry"
BUILD_LOG="$OSM_DIR/build-history.log"
# Offline maps: background maps (<area>.pmtiles), terrain and satellite imagery
# (<area>.sat-*.pmtiles), all served by the backend.
OFFLINE_MAPS_DIR="$MAP_DIR/offline-maps"
# The Wikidata cache for offline popups (scripts/fetch_images.py).
IMAGES_DIR="$MAP_DIR/images"
WIKIDATA_JSON_DIR="$MAP_DIR/wikidata_json"
# The gate's https certificate (gate/10-certificate.sh).
GATE_CERT_DIR="$LOCAL_DIR/gate"
# The services' ports on this computer (docker-compose.override.yml's: a test
# checks they agree, with the gate's and the frontend's too).
TEGOLA_PORT=7800
BACKEND_PORT=8001
WEB_ENV="$REPO_ROOT/web/.env"
# Ready-made databases made by scripts/export-db.sh, imported by import-db.sh.
EXPORTS_DIR="$MAP_DIR/exports"
DOCKER_IMAGES_TAR="$EXPORTS_DIR/docker-images.tar.gz"
# Extra data (scripts/extra_data.py) saved before a rebuild wipes the database,
# one file per region: data/downloads/extra/<region>.extra.dump (+ .json).
EXTRA_DIR="$DOWNLOADS_DIR/extra"
DB_USER=osm
DB_NAME=osm

# Set to 1 (e.g. via --yes) to accept the default answer of every prompt.
ASSUME_YES="${ASSUME_YES:-0}"

if [[ -t 1 ]]; then
    BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

# shellcheck source=lib/ui.sh
source "$REPO_ROOT/scripts/lib/ui.sh"
# shellcheck source=lib/net.sh
source "$REPO_ROOT/scripts/lib/net.sh"
# shellcheck source=lib/python.sh
source "$REPO_ROOT/scripts/lib/python.sh"
# shellcheck source=lib/json.sh
source "$REPO_ROOT/scripts/lib/json.sh"
# shellcheck source=lib/docker.sh
source "$REPO_ROOT/scripts/lib/docker.sh"
# shellcheck source=lib/db.sh
source "$REPO_ROOT/scripts/lib/db.sh"
# shellcheck source=lib/eez.sh
source "$REPO_ROOT/scripts/lib/eez.sh"
# shellcheck source=lib/extra.sh
source "$REPO_ROOT/scripts/lib/extra.sh"
# shellcheck source=lib/userdata.sh
source "$REPO_ROOT/scripts/lib/userdata.sh"
# shellcheck source=lib/exports.sh
source "$REPO_ROOT/scripts/lib/exports.sh"
# shellcheck source=lib/app.sh
source "$REPO_ROOT/scripts/lib/app.sh"
# shellcheck source=lib/basemap.sh
source "$REPO_ROOT/scripts/lib/basemap.sh"
# shellcheck source=lib/geofabrik.sh
source "$REPO_ROOT/scripts/lib/geofabrik.sh"
# shellcheck source=lib/offline-maps.sh
source "$REPO_ROOT/scripts/lib/offline-maps.sh"
