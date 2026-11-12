#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# satellite.sh — the offline maps menu, for the region already built, without
# touching the database (build-region.sh would rebuild it).
#
#   bash scripts/satellite.sh
#
# Shows what's downloaded, then Resume, Add, Remove, Settings. Add offers, for an
# area (this region, another country, the world), NASA Blue Marble, Sentinel-2
# 10 m, aerial photos (8 to 60 cm) where a country publishes them, and the
# background map, with sizes: only what isn't there yet and makes sense. Downloads
# into data/basemap/ and points the map at everything there (Settings →
# Background). Your map data and your own layers are left as they are; the
# frontend needs a restart to show new imagery. A download stopped half-way goes
# on with Resume.
#
# Without questions: python3 scripts/satellite.py maps --source ID --yes
# (--help lists the sources and options); start.sh then shows it on the map.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)  sed -n '4,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        --satellite|--satellite-detailed|--area|--zoom|--sources|--yes|-y)
            die "$1 is gone: without questions, use python3 scripts/satellite.py maps --source ID --yes (see --help there)." ;;
        *)          die "Unknown option: $1" ;;
    esac
done

banner "offline maps"

docker info >/dev/null 2>&1 || die "Docker isn't running."
db_volume_exists || die "There's no map database yet. Build a region first: bash scripts/build-region.sh"
start_db
REGION_ID=$(build_info region_id)
[[ -n "$REGION_ID" ]] || die "The map database was never finished. Build it with: bash scripts/build-region.sh"
REGION_NAME=$(build_info region_name)
ok "Region: $REGION_NAME"
# Outlines come from Geofabrik's index (kept from the build; refreshed daily).
fetch_geofabrik_index || warn "Couldn't get Geofabrik's list of regions: only the whole world can be chosen."

# It downloads itself; what's left of a stopped download waits for Resume.
python3 -I "$REPO_ROOT/scripts/satellite.py" maps --basemap-dir "$BASEMAP_DIR" \
    --index "$GEOFABRIK_INDEX" --region "$REGION_ID" || warn "Stopped: Resume goes on from there."
select_basemap
download_satellite
echo ""
ok "Done. Restart the frontend (Ctrl+C in its window, then bash scripts/start.sh) and"
info "turn it on in Settings → Background."
