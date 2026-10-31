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

# Docker images needed to run (db, tegola, backend, basemap) and build (imposm, osmium) offline.
project_images() {
    local project
    project=$(compose_project)
    docker compose config --format json </dev/null | python3 -c 'import json,sys; s=json.load(sys.stdin)["services"]; print(s["db"]["image"]); print(s["basemap"]["image"])'
    echo "$project-tegola" "$project-backend" "$project-imposm" "$project-osmium" | tr ' ' '\n'
}

# The SQL files that make a built database, in the order they run: functions.sql
# when the database is created, eez.sql with the country boundaries, the rest in
# build-region.sh. A test (scripts/tests) checks every schema/*.sql is either here
# or in SCHEMA_NOT_BUILT, and that build-region.sh runs these in this order.
SCHEMA_FILES=(functions views stats places sites grid tower-numbers extra search eez local-stats)

# Not part of a build: database creation (dev-init, prod-init) and production jobs.
SCHEMA_NOT_BUILT=(dev-init prod-init refresh_matviews)

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
