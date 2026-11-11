#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# start.sh — start everything and open the map. No questions asked.
#
#   bash scripts/start.sh
#
# Starts the database and Tegola (Docker), opens the backend and frontend in
# their own terminal windows, and opens https://localhost:8800 (the gate, which asks
# for a login) once it's up.
# Anything already running is left alone. Needs a database built by
# scripts/launch.sh (first-time setup) or scripts/build-region.sh. If the
# region's export in data/exports/ is out of date, it's exported again.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker, then re-run this script."

section "Starting the database and tile server..."
db_volume_exists || die "There's no map database yet. Run the first-time setup: bash scripts/launch.sh"
start_db
REGION=$(build_info region_name)
[[ -n "$REGION" ]] || die "The map database was never finished. Build it with: bash scripts/build-region.sh"
ok "Map database: $REGION (OSM data as of $(build_info osm_timestamp))"
up_services tegola
ok "Tile server running on http://localhost:7800"
REGION_ID=$(build_info region_id)
if has_satellite "$REGION_ID"; then
    start_satellite_if_present
fi
# The imagery list (and its credits) for the frontend, kept up to date.
select_satellite "$REGION_ID"

section "Starting the app..."
if ! start_app; then
    warn "Couldn't open a terminal window automatically (no supported terminal found)."
    echo ""
    print_manual_start
fi
# The map is up: bring an out-of-date ready-made export up to date meanwhile.
reexport_if_outdated
echo ""
info "Stop the database and tile server with: docker compose stop"
