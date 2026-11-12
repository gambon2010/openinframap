#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build-region.sh — build the local OpenInfraMap database for one region
#
# Interactive:
#   bash scripts/build-region.sh
#
# Unattended (e.g. for building the downloadable database dumps):
#   bash scripts/build-region.sh --region europe --yes
#   bash scripts/build-region.sh --pbf ~/planet.osm.pbf --yes
#
# All the questions come first (the region, a ready-made export to import
# instead, replacing the database, extra data, the background map, satellite
# imagery); then it runs on its own: download the region (resumable, checksum-
# verified) → keep only the infrastructure (osmium) → a fresh database (My layers
# and extra data kept) → import (imposm) → the SQL steps (schema/) → country
# boundaries → extra data → Tegola → background map and satellite imagery →
# Wikidata images → export again if the ready-made one is out of date.
#
# Downloads and filtered extracts are kept in data/osm/ and reused. Downloads
# wait for a lost connection (scripts/lib/net.sh). The steps are the functions
# below, run in order at the end of the file.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

# The regions offered first (Geofabrik ids), and the one for a quick test.
CONTINENTS=(africa antarctica asia australia-oceania central-america europe north-america russia south-america)
TEST_REGION=luxembourg

usage() {
    cat <<EOF
Usage: bash scripts/build-region.sh [options]

  --region ID     Geofabrik region id, e.g. europe, africa, france, california,
                  or "planet" for the whole world (very slow: ~95 GB download)
  --pbf FILE      Use an .osm.pbf file you already have instead of downloading
  --images        Also cache Wikidata images (slow: can take hours)
  --no-images     Don't cache Wikidata images and don't ask about it
  --extra         Also download open data from outside OpenStreetMap that covers
                  the region (e.g. French distribution networks; see
                  scripts/extra_data.py). Extra data already imported for the
                  region is kept across rebuilds anyway (saved in data/extra/)
  --extra-only LIST  Only these extra datasets, e.g. gas,icpe (choices: electricity,
                  gas, biomethane, icpe; see: uv run scripts/extra_data.py offer)
  --no-extra      No extra data at all, and don't ask about it
  --no-filter     Import the extract as-is, without the osmium pre-filter
  --basemap MODE  Offline background map for the region: full or none. Default:
                  the offline maps menu (with --yes: none). Downloaded after the build.
                  The world's to zoom 8 (borders, names; 560 MB) comes unless none
  --maps "ID ..."  Offline maps to download for the region after the build, without
                  questions: sentinel2, fr_ign, protomaps... (python3
                  scripts/satellite.py maps --help lists them). Default: the
                  offline maps menu (with --yes: none)
  --rebuild       Build from scratch even if data/exports/ has a ready-made export
  --no-export     Don't export the region again when its ready-made export in
                  data/exports/ is out of date (by default it is, at the end)
  --refresh       Download a newer Geofabrik extract if there is one (by default
                  an extract you already downloaded is reused, and you're asked)
  --yes, -y       Don't ask questions; accept the defaults (wipes the database!)
  -h, --help      Show this help
EOF
}

# ---------------------------------------------------------------------------
# What the build will do. The options set some of it; the questions (the ask_*
# steps) the rest. Choices are yes / no, or ask (not decided yet).
# ---------------------------------------------------------------------------

# The region
REGION_ID=""          # Geofabrik id, or the local file's name (--pbf)
REGION_NAME=""        # shown, and stored in oim_build_info
PBF_SOURCE=""         # the .osm.pbf read: data/osm/<id>-latest.osm.pbf, or --pbf
PBF_URL=""            # where it's downloaded from ("" for a local file)
DOWNLOAD_SIZE=0       # bytes to download (0: nothing to download)
DOWNLOAD=no           # yes: download the extract (missing, or a newer one)
REMOTE_MD5=""         # Geofabrik's checksum of the extract, to verify it
REFRESH=no            # --refresh: a newer extract is downloaded without asking
REBUILD=no            # --rebuild: ignore a ready-made export
FILTER=yes            # --no-filter: import the whole extract
IMPORT_PBF=""         # what imposm reads: the filtered extract, or the whole one
OSM_TIMESTAMP=""      # how recent the OSM data is (the extract's header)

# The database being replaced
EXISTING_REGION_ID="" # its region, whose extra data is saved before the wipe
EXISTING_EXTRA=0      # its extra data features

# What else goes in
HAVE_EEZ=0            # 1: the country boundaries (EEZ) zip is there
IMAGES=ask            # Wikidata images at the end (--images / --no-images)
EXTRA_KEEP=yes        # put back extra data kept from before (--no-extra: no)
EXTRA_KEPT=""         # what is kept, described ("" if nothing)
EXTRA_NEW=ask         # download extra data (--extra, --extra-only: yes; --no-extra: no)
EXTRA_CHOOSE=""       # which datasets (e.g. gas,icpe; "" = all that cover the region)
EXTRA_RESTORED=0      # 1: the kept extra data went back in
BASEMAP_MODE=""       # background map: full, none ("" = the offline maps menu)
MAPS_SOURCES=""       # offline maps to queue without questions ("" = the menu)
REEXPORT=yes          # --no-export: don't export again when out of date

# Disk space
DOCKER_ROOT=""        # where Docker keeps the database (checked twice)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --region)    REGION_ID="${2:?--region needs a value}"; shift 2 ;;
        --pbf)       PBF_SOURCE="${2:?--pbf needs a value}"; shift 2 ;;
        --images)    IMAGES=yes; shift ;;
        --no-images) IMAGES=no; shift ;;
        --extra)     EXTRA_NEW=yes; shift ;;
        --no-extra)  EXTRA_NEW=no; EXTRA_KEEP=no; shift ;;
        --extra-only) EXTRA_CHOOSE="${2:?--extra-only needs a list, e.g. gas,icpe}"; EXTRA_NEW=yes; shift 2 ;;
        --no-filter) FILTER=no; shift ;;
        --refresh)   REFRESH=yes; shift ;;
        --rebuild)   REBUILD=yes; shift ;;
        --no-export) REEXPORT=no; shift ;;
        --basemap)   BASEMAP_MODE="${2:?--basemap needs full or none}"; shift 2 ;;
        --maps)      MAPS_SOURCES="${2:?--maps needs source ids, e.g. \"sentinel2 fr_ign\"}"; shift 2 ;;
        --satellite|--satellite-detailed)
            die "$1 is gone: use --maps \"sentinel2 fr_ign\" (python3 scripts/satellite.py maps --help lists the sources)." ;;
        --yes|-y)    ASSUME_YES=1; shift ;;
        -h|--help)   usage; exit 0 ;;
        *)           usage; die "Unknown option: $1" ;;
    esac
done

# Check option values now, before any question or download.
case "$BASEMAP_MODE" in
    ""|full|none) ;;
    *) die "--basemap must be full or none." ;;
esac

# Unfinished builds are noted in data/osm/build-history.log.
BUILD_STARTED=0
BUILD_DONE=0
trap 'echo; warn "Interrupted. Re-run the script to continue — downloads resume where they stopped."; exit 130' INT
trap 'status=$?
      if [[ "$status" != 0 && "$BUILD_STARTED" == 1 && "$BUILD_DONE" == 0 ]]; then
          [[ "$status" == 130 ]] && log_build "$REGION_ID  interrupted during: ${CURRENT_STEP:-?}" \
                                 || log_build "$REGION_ID  FAILED during: ${CURRENT_STEP:-?} (exit $status)"
      fi' EXIT

# The questions and their helpers, then the long steps: one function each.
# shellcheck source=build/questions.sh
source "$REPO_ROOT/scripts/build/questions.sh"
# shellcheck source=build/steps.sh
source "$REPO_ROOT/scripts/build/steps.sh"

# ---------------------------------------------------------------------------
# The build: all the questions first, then it runs on its own.
# ---------------------------------------------------------------------------
check_prerequisites
choose_region
offer_ready_made
find_region_source
decide_download
check_space
confirm_replacing_database
ask_boundaries_and_images
ask_extra_data
prepare_background_map
ask_satellite
start_building
download_extract
filter_extract
check_docker_space
import_osm
import_boundaries
record_build
import_extra_data
start_tile_server
offline_background
cache_wikidata
finish
