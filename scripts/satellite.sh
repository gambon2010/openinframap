#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# satellite.sh — download offline satellite imagery for the region already
# built, without touching the database (build-region.sh would rebuild it).
#
#   bash scripts/satellite.sh
#
# Asks what you want, with sizes (the same questions as build-region.sh): NASA
# Blue Marble for the whole world, Sentinel-2 10 m for this region, another
# country or the whole world, and aerial photos (8 to 60 cm) where a country
# publishes them. Downloads into data/basemap/ and points the map at everything
# there (Settings → Background → Satellite). Your map data and your own layers
# are left as they are; the frontend needs a restart to show new imagery. A
# download stopped half-way goes on where it stopped when run again.
#
#   --satellite MODE           overview (the world only), regional (Sentinel-2)
#   --area ID                  Sentinel-2 / photos for this Geofabrik region, or
#                              world (default: the region built)
#   --zoom N                   Sentinel-2 to zoom 9-13 (default 12; world: 10)
#   --satellite-detailed ZOOM  aerial photos to zoom 15, 16 or 17 (or none)
#   --sources "ID ..."         which aerial photo sources (default: all that
#                              cover the area; python3 scripts/satellite.py sources)
#   --yes, -y                  don't ask (needs --satellite)
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

SATELLITE_MODE=""
SATELLITE_DETAILED=""
SATELLITE_AREA_ID=""
SATELLITE_ZOOM=""
SATELLITE_SOURCES=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --satellite)          SATELLITE_MODE="${2:?--satellite needs overview, regional or regional13}"; shift 2 ;;
        --satellite-detailed) SATELLITE_DETAILED="${2:?--satellite-detailed needs 15, 16, 17 or none}"; shift 2 ;;
        --area)               SATELLITE_AREA_ID="${2:?--area needs a region id or world}"; shift 2 ;;
        --zoom)               SATELLITE_ZOOM="${2:?--zoom needs 9 to 13}"; shift 2 ;;
        --sources)            SATELLITE_SOURCES="${2:?--sources needs source ids}"; shift 2 ;;
        --yes|-y)             ASSUME_YES=1; shift ;;
        -h|--help)            sed -n '4,27p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)                    die "Unknown option: $1" ;;
    esac
done
case "$SATELLITE_MODE" in
    ""|overview|regional|regional13) ;;
    *) die "--satellite must be overview, regional or regional13." ;;
esac
case "$SATELLITE_ZOOM" in
    ""|9|10|11|12|13) ;;
    *) die "--zoom must be 9 to 13." ;;
esac
case "$SATELLITE_DETAILED" in
    ""|none|15|16|17) ;;
    *) die "--satellite-detailed must be 15, 16, 17 or none." ;;
esac
[[ "${ASSUME_YES:-0}" == 1 && -z "$SATELLITE_MODE" ]] && die "With --yes, say which tiers: --satellite regional (or overview, regional13)."

banner "offline satellite imagery"

docker info >/dev/null 2>&1 || die "Docker isn't running."
db_volume_exists || die "There's no map database yet. Build a region first: bash scripts/build-region.sh"
start_db
REGION_ID=$(build_info region_id)
[[ -n "$REGION_ID" ]] || die "The map database was never finished. Build it with: bash scripts/build-region.sh"
REGION_NAME=$(build_info region_name)
ok "Region: $REGION_NAME"
# Outlines come from Geofabrik's index (kept from the build; refreshed daily).
fetch_geofabrik_index || warn "Couldn't get Geofabrik's list of regions: only the whole world can be chosen."

choose_satellite "$REGION_ID"
# Nothing new chosen: older imagery is still brought up to date (download_satellite).
[[ -f "$SATELLITE_PLAN" ]] || info "Nothing new to download."
download_satellite "$REGION_ID"
echo ""
ok "Done. Restart the frontend (Ctrl+C in its window, then bash scripts/start.sh) and"
info "turn it on in Settings → Background."
