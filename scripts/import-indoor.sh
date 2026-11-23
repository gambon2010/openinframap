#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# import-indoor.sh — read buildings' interiors again into the database already
# built (build-region.sh does it itself), e.g. after a new extract or a change in
# what's kept (scripts/indoor.py, web-backend/src/fork/indoor/).
#
#   bash scripts/import-indoor.sh [EXTRACT.osm.pbf]
#
# About ten minutes for France. The map shows them once Tegola drops its cached
# tiles: it's restarted at the end.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

run_schema indoor
run_with_timer "Reading buildings' interiors" import_indoor "${1:-}"
up_services --force-recreate tegola
ok "Interiors read; tile server restarted"
