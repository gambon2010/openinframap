# shellcheck shell=bash
# The database (Docker Compose service "db"): starting it, running SQL, what was
# built, the schema files and their fingerprint.
# Sourced by common.sh.

# Name indexes for search (as on openinframap.org), using upstream's
# web-backend/create_indexes.py from the backend image. Without them search
# gets slow on large regions. Indexes that already exist are skipped.
create_search_indexes() {
    # Rebuild the image so script changes are picked up; offline, use the existing one.
    docker compose --progress quiet build backend </dev/null 2>/dev/null || true
    docker compose --progress quiet run --rm --no-deps -T \
        -e ADMIN_DATABASE_URL="postgresql://$DB_USER:osm@db:5432/$DB_NAME" \
        --entrypoint /app/.venv/bin/python backend create_indexes.py </dev/null
}

# Run a SQL file against the osm database (for use with run_with_timer).
run_sql_file() {
    db_psql < "$1"
}

db_psql() {
    docker compose exec -T -e PGOPTIONS="-c client_min_messages=warning" db psql -v ON_ERROR_STOP=1 -q -U "$DB_USER" "$DB_NAME" "$@"
}

db_query() {
    docker compose exec -T db psql -U "$DB_USER" "$DB_NAME" -tAc "$1" </dev/null 2>/dev/null
}

# Start the db service and wait until the osm user can run queries. On a fresh
# volume the init scripts (schema/dev-init.sql) run before that's possible.
start_db() {
    docker compose --progress quiet up -d db </dev/null
    local elapsed=0
    until db_query "SELECT 1" >/dev/null; do
        [[ "$elapsed" -ge 180 ]] && die "Postgres did not become ready within 180s. Check: docker compose logs db"
        sleep 2
        elapsed=$((elapsed + 2))
    done
}

# Prints the value stored by build-region.sh for $1, or nothing if the
# database is missing or was never fully built.
build_info() {
    db_query "SELECT value FROM oim_build_info WHERE key = '$1'" || true
}

compose_project() {
    docker compose config --format json </dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])'
}

# True if this Compose project's database volume exists (built or not).
db_volume_exists() {
    docker volume inspect "$(compose_project)_postgres_data" >/dev/null 2>&1
}

# Docker images needed to run (db, tegola, backend, basemap, gate) and build (imposm, osmium) offline.
project_images() {
    local project
    project=$(compose_project)
    docker compose config --format json </dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin)["services"]; print(s["db"]["image"]); print(s["basemap"]["image"])'
    echo "$project-tegola" "$project-backend" "$project-gate" "$project-imposm" "$project-osmium" | tr ' ' '\n'
}

# The SQL files that make a built database, in the order they run: functions.sql
# when the database is created, eez.sql with the country boundaries, the rest in
# build-region.sh. A test (scripts/tests) checks every schema/*.sql is either here
# or in SCHEMA_NOT_BUILT, and that build-region.sh runs these in this order.
SCHEMA_FILES=(functions views distances stats places sites grid tower-numbers extra search eez local-stats)

# Not part of a build: database creation (dev-init, prod-init) and production jobs.
SCHEMA_NOT_BUILT=(dev-init prod-init refresh_matviews)

# What each step says while it runs (run_schema).
declare -A SCHEMA_LABELS=(
    [views]="Creating map views"
    [distances]="Preparing real-metre distances"
    [stats]="Creating stats tables"
    [places]="Preparing place search"
    [sites]="Sorting critical sites"
    [grid]="Building the power grid network"
    [tower-numbers]="Preparing tower numbers"
    [extra]="Creating extra data tables"
    [search]="Preparing search"
    [local-stats]="Computing per-country stats"
)

# run_schema NAME... — run schema/NAME.sql, each a timed step.
run_schema() {
    local name
    for name in "$@"; do
        run_with_timer "${SCHEMA_LABELS[$name]:-Running $name.sql}" run_sql_file "schema/$name.sql"
    done
}

# A fingerprint of what shapes the database: the imposm mapping and SCHEMA_FILES.
# Stored in builds and exports; import-db.sh warns when an export's differs.
schema_hash() {
    local files=("$REPO_ROOT"/imposm/*.py) name
    for name in "${SCHEMA_FILES[@]}"; do files+=("$REPO_ROOT/schema/$name.sql"); done
    cat "${files[@]}" | md5sum | cut -c1-12
}

# Number the towers along their lines (web-backend/src/fork/tower_numbers.py) with
# the backend's image, rebuilt first if its code changed. After grid.sql and
# tower-numbers.sql (the empty tables).
number_towers() {
    local run=(--rm --no-deps --entrypoint /app/.venv/bin/python backend -m src.fork.tower_numbers)
    docker compose --progress quiet run --build "${run[@]}" </dev/null >/dev/null 2>&1 \
        || docker compose --progress quiet run "${run[@]}" </dev/null >/dev/null
}

# --- Replacing the database (build-region.sh, import-db.sh) ------------------------

# fresh_database [EXTRA_REGION] — an empty database, keeping what isn't the map's:
# My layers (always), and the extra data of EXTRA_REGION (if it has any; slow to
# download again). Sets BACKEND_WAS_RUNNING (restart_map_services brings it back).
fresh_database() {
    local extra_region="${1:-}" count
    BACKEND_WAS_RUNNING=$(docker compose ps -q backend 2>/dev/null </dev/null || true)
    if db_volume_exists; then
        start_db
        count=$(extra_feature_count)
        if [[ -n "$extra_region" && "$count" -gt 0 ]]; then
            run_with_timer --keep-going "Saving the extra data ($(printf "%'d" "$count") features)" \
                save_extra_data "$extra_region" \
                || die "Saving the extra data failed, so the database was left as it was."
            ok "Saved to data/extra/$extra_region.extra.dump"
        fi
        if [[ "$(user_data_saves)" -gt 0 ]]; then
            run_with_timer --keep-going "Saving My layers" save_user_data \
                || die "Saving My layers failed, so the database was left as it was."
            ok "Saved to data/userdata/userdata.dump"
        fi
    fi
    # -v removes this project's volumes only (database, imposm cache).
    docker compose --progress quiet down -v --remove-orphans </dev/null
    start_db
    ok "Fresh database ready."
}

# put_back_my_layers — My layers saved by fresh_database (or an earlier run) go
# back, then the towers are numbered (My layers hold the register that keeps each
# tower's number). After tower-numbers.sql.
put_back_my_layers() {
    if [[ -f "$USERDATA_DUMP" ]]; then
        run_with_timer --keep-going "Putting back My layers" restore_user_data \
            || warn "Putting back My layers failed; they're still in data/userdata/userdata.dump"
    fi
    run_with_timer --keep-going "Numbering towers along their lines" number_towers \
        || warn "Numbering towers failed; towers have no numbers. Retry: bash scripts/number-towers.sh"
}

# restart_map_services — Tegola recreated (no tiles cached from the old data), and
# the backend if it was running before fresh_database.
restart_map_services() {
    docker compose --progress quiet up -d --build --force-recreate tegola </dev/null 2>/dev/null \
        || docker compose --progress quiet up -d --force-recreate tegola </dev/null
    ok "Tile server running on http://localhost:7800"
    if [[ -n "${BACKEND_WAS_RUNNING:-}" ]]; then
        up_services backend
        ok "Backend restarted on http://localhost:$BACKEND_PORT"
    fi
}
