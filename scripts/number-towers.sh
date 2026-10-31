#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# number-towers.sh — number the towers along their lines again in the database
# already built (build-region.sh and import-db.sh do it themselves), e.g. after
# the rules following lines changed (web-backend/src/fork/line_trace.py).
#
#   bash scripts/number-towers.sh
#
# Takes about half a minute for France. The map shows the new numbers once Tegola
# drops its cached tiles: it's restarted at the end.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

run_with_timer "Preparing tower numbers" run_sql_file schema/tower-numbers.sql
run_with_timer "Numbering towers along their lines" number_towers
docker compose --progress quiet up -d --force-recreate tegola </dev/null
ok "Towers numbered; tile server restarted"
