#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# satellite.sh — download offline satellite imagery for the region already
# built, without touching the database (build-region.sh would rebuild it).
#
#   bash scripts/satellite.sh
#
# Asks which tiers you want, with their sizes (the same questions as
# build-region.sh), downloads them into data/basemap/ and points the map at
# them (Settings → Background → Satellite). Your map data and your own layers
# are left as they are; the frontend needs a restart to show new imagery.
#
#   --satellite MODE           overview, regional or regional13 (default: ask)
#   --satellite-detailed ZOOM  France only: IGN 20 cm photos to zoom 15, 16 or 17
#   --yes, -y                  don't ask (needs --satellite)
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

SATELLITE_MODE=""
SATELLITE_DETAILED=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --satellite)          SATELLITE_MODE="${2:?--satellite needs overview, regional or regional13}"; shift 2 ;;
        --satellite-detailed) SATELLITE_DETAILED="${2:?--satellite-detailed needs 15, 16, 17 or none}"; shift 2 ;;
        --yes|-y)             ASSUME_YES=1; shift ;;
        -h|--help)            sed -n '4,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *)                    die "Unknown option: $1" ;;
    esac
done
case "$SATELLITE_MODE" in
    ""|overview|regional|regional13) ;;
    *) die "--satellite must be overview, regional or regional13." ;;
esac
case "$SATELLITE_DETAILED" in
    ""|none|15|16|17) ;;
    *) die "--satellite-detailed must be 15, 16, 17 or none." ;;
esac
[[ "${ASSUME_YES:-0}" == 1 && -z "$SATELLITE_MODE" ]] && die "With --yes, say which tiers: --satellite regional (or overview, regional13)."

echo "${BOLD}======================================================${RESET}"
echo "${BOLD} Open Infrastructure Map — offline satellite imagery${RESET}"
echo "${BOLD}======================================================${RESET}"

docker info >/dev/null 2>&1 || die "Docker isn't running."
db_volume_exists || die "There's no map database yet. Build a region first: bash scripts/build-region.sh"
start_db
REGION_ID=$(build_info region_id)
[[ -n "$REGION_ID" ]] || die "The map database was never finished. Build it with: bash scripts/build-region.sh"
ok "Region: $(build_info region_name)"
# A Geofabrik region: its outline is in Geofabrik's index.
PBF_URL=$(build_info source)
[[ "$PBF_URL" == *geofabrik.de* ]] || PBF_URL=""

choose_satellite "$REGION_ID"
[[ -z "$SATELLITE_DETAILED" ]] && SATELLITE_DETAILED=none
if [[ "$SATELLITE_MODE" == none || "$SATELLITE_MODE" == keep ]]; then
    info "Nothing to download."
    exit 0
fi
download_satellite "$REGION_ID"
echo ""
ok "Done. Restart the frontend (Ctrl+C in its window, then bash scripts/start.sh) and"
info "turn it on in Settings → Background."
