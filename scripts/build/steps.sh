# shellcheck shell=bash
# shellcheck disable=SC2034  # the build's variables are shared by its three files
# Fork: build-region.sh's long steps (after the questions, the build runs them in order). Sourced by build-region.sh (its variables, at the
# top of it, are what the steps share); not run on its own.

# No more questions: the build starts (and is logged).
start_building() {
    echo ""
    info "${BOLD}That's all the questions.${RESET} The rest runs on its own — for a continent this"
    info "can take a few hours, mostly downloading. Safe to interrupt and re-run."
    START=$SECONDS
    BUILD_STARTED=1
    log_build "$REGION_ID  started ($REGION_NAME)"
}

# Download the extract (if needed), verify it, and only then replace the old one.
download_extract() {
    if [[ "$DOWNLOAD" == yes ]]; then
        section "Downloading $REGION_NAME from Geofabrik ($(human_size "$DOWNLOAD_SIZE"))..."
        local status=0
        download "$PBF_URL" "$PBF_SOURCE.new" || status=$?
        [[ "$status" == 0 ]] || die_download "$status" "$REGION_NAME"
        if [[ -n "$REMOTE_MD5" ]]; then
            info "Verifying checksum..."
            if [[ "$(md5sum "$PBF_SOURCE.new" | cut -d' ' -f1)" != "$REMOTE_MD5" ]]; then
                rm -f "$PBF_SOURCE.new"
                die "The download is corrupt (Geofabrik may have published a new extract mid-download). Re-run the script."
            fi
        fi
        rm -f "$PBF_SOURCE.md5"
        mv "$PBF_SOURCE.new" "$PBF_SOURCE"
        [[ -n "$REMOTE_MD5" ]] && echo "$REMOTE_MD5" > "$PBF_SOURCE.md5"
        ok "Downloaded $(human_size "$(stat -c%s "$PBF_SOURCE")")."
    fi
    OSM_TIMESTAMP=$(osmium fileinfo -g header.option.osmosis_replication_timestamp /src.osm.pbf 2>/dev/null || true)
}

# Keep only what the map uses (osmium); an earlier result is reused when neither
# the extract nor the imposm mapping changed. Sets IMPORT_PBF.
filter_extract() {
    IMPORT_PBF="$PBF_SOURCE"
    [[ "$FILTER" == yes ]] || return 0
    section "Filtering the extract down to infrastructure..."
    local filtered="$OSM_DIR/$REGION_ID-filtered.osm.pbf" stamp
    python3 "$REPO_ROOT/scripts/osm_filter.py" > "$OSM_DIR/filter.txt"
    stamp="$(stat -c '%s %Y' "$PBF_SOURCE") $(md5sum < "$OSM_DIR/filter.txt" | cut -d' ' -f1)"
    if [[ -f "$filtered" && "$(cat "$filtered.stamp" 2>/dev/null)" == "$stamp" ]]; then
        ok "Already filtered."
    else
        osmium tags-filter --progress /src.osm.pbf -e /osm/filter.txt \
            -o "/osm/$(basename "$filtered")" --overwrite
        echo "$stamp" > "$filtered.stamp"
        ok "$(human_size "$(stat -c%s "$PBF_SOURCE")") → $(human_size "$(stat -c%s "$filtered")")"
    fi
    IMPORT_PBF="$filtered"
}

# Now that the real input size is known: room in Docker for the database.
check_docker_space() {
    local need free
    [[ -n "$DOCKER_ROOT" ]] || return 0
    free=$(free_bytes "$DOCKER_ROOT" 2>/dev/null) || return 0
    need=$(docker_need "$(stat -c%s "$IMPORT_PBF")" "$FILTER")
    if [[ "$need" -gt "$free" ]]; then
        die "The database needs about $(human_size "$need") in $DOCKER_ROOT but only $(human_size "$free") is free.
           Free up some space and re-run — the download and filtering won't be repeated."
    fi
}

# A fresh database (My layers and extra data kept), the imposm import and the SQL
# steps (in SCHEMA_FILES' order).
import_osm() {
    section "Creating a fresh database..."
    fresh_database "$EXISTING_REGION_ID"

    section "Importing with imposm (the longest step)..."
    docker compose --progress quiet run --rm --build \
        -v "$IMPORT_PBF:/data.osm.pbf:ro,z" \
        imposm import \
        -connection "postgis://$DB_USER:osm@db/$DB_NAME" \
        -mapping /mapping.json \
        -read /data.osm.pbf \
        -write \
        -optimize \
        -deployproduction \
        -overwritecache

    section "Creating views..."
    run_schema views distances stats places sites grid tower-numbers buildings
    run_with_timer "Creating search indexes" create_search_indexes
    # Extra data kept for this region goes back first; then the extra data tables
    # (which always exist, as Tegola serves them) get whatever is new.
    if [[ -n "$EXTRA_KEPT" && -f "$EXTRA_DIR/$REGION_ID.extra.dump" ]]; then
        if run_with_timer --keep-going "Putting back the extra data" restore_extra_data "$REGION_ID"; then
            EXTRA_RESTORED=1
        else
            warn "Putting back the extra data failed; re-import it with: uv run scripts/extra_data.py import"
            db_psql -c "DROP SCHEMA IF EXISTS extra CASCADE;"
        fi
    fi
    # Then everything with a name, for the search box (extra_data.py refreshes it
    # when the extra data changes).
    run_schema extra search
    put_back_my_layers
}

# Country boundaries and the per-country stats.
import_boundaries() {
    [[ "$HAVE_EEZ" == 1 ]] || return 0
    section "Importing country boundaries..."
    run_with_timer "Importing EEZ boundaries" import_eez
    # Per-country stats pages read from the stats schema; production refreshes it
    # on a schedule, here one snapshot of the freshly imported data is enough.
    run_schema local-stats
}

# What was built (oim_build_info: read by the scripts, the exports and the backend).
record_build() {
    db_psql <<SQL
CREATE TABLE oim_build_info (key text PRIMARY KEY, value text NOT NULL);
INSERT INTO oim_build_info VALUES
    ('region_id',     '$REGION_ID'),
    ('region_name',   '${REGION_NAME//\'/\'\'}'),
    ('source',        '${PBF_URL:-local file}'),
    ('osm_timestamp', '${OSM_TIMESTAMP:-unknown}'),
    ('eez',           '$HAVE_EEZ'),
    ('git_commit',    '$(git rev-parse --short HEAD 2>/dev/null || echo unknown)'),
    ('schema_hash',   '$(schema_hash)'),
    ('built_at',      '$(date -u +%Y-%m-%dT%H:%M:%SZ)');
SQL
}

# Extra data: after the build info, which says which region to cover. Kept data
# is checked against the new OSM data (which may now have some of it).
import_extra_data() {
    local db_url="postgresql://$DB_USER:osm@localhost:5432/$DB_NAME" args=()
    if [[ "$EXTRA_RESTORED" == 1 && "$EXTRA_NEW" != yes ]] && command -v uv &>/dev/null; then
        section "Checking the kept extra data against the new OSM data..."
        uv run "$REPO_ROOT/scripts/extra_data.py" --db-url "$db_url" dedupe \
            || warn "Checking failed; the extra data is there but may overlap OSM. Retry with: uv run scripts/extra_data.py dedupe"
    fi
    if [[ "$EXTRA_NEW" == yes ]]; then
        section "Importing extra data (outside OpenStreetMap)..."
        [[ -n "$EXTRA_CHOOSE" ]] && args+=(--choose "$EXTRA_CHOOSE")
        # A fresh copy (asked for when there's kept data): not reusing earlier downloads.
        [[ -n "$EXTRA_KEPT" ]] && args+=(--refresh)
        uv run "$REPO_ROOT/scripts/extra_data.py" --db-url "$db_url" import "${args[@]}" \
            || warn "Importing extra data failed; the map works without it. Retry with: uv run scripts/extra_data.py import"
    fi
}

# Tegola (recreated: no tiles cached from the old data), and the backend.
start_tile_server() {
    section "Starting the Tegola tile server..."
    restart_map_services
}

# The offline background map and satellite imagery, after everything else: a
# failure here doesn't lose the build.
offline_background() {
    download_satellite
    section "Background map"
    select_basemap
    if [[ -n "$(background_areas)" ]]; then
        run_with_timer --keep-going "Finding the large buildings (shown zoomed out)" large_buildings \
            || warn "Finding the large buildings failed; zoomed out none show. Retry: python3 scripts/satellite.py large-buildings"
    fi
}

# The Wikidata cache for the info popups (if asked).
cache_wikidata() {
    [[ "$IMAGES" == yes ]] || return 0
    section "Caching Wikidata data and images (already-cached ones are skipped)..."
    uv run "$REPO_ROOT/scripts/fetch_images.py" \
        || warn "Caching Wikidata images stopped; run it again to go on: uv run scripts/fetch_images.py"
}

# What was built, and an out-of-date export made again.
finish() {
    local took
    took=$(duration $((SECONDS - START)))
    BUILD_DONE=1
    log_build "$REGION_ID  completed in $took (OSM data as of ${OSM_TIMESTAMP:-unknown})"
    done_banner "$REGION_NAME is built"
    info "OSM data as of: ${OSM_TIMESTAMP:-unknown}"
    info "Database size:  $(db_query "SELECT pg_size_pretty(pg_database_size('$DB_NAME'))")"
    info "Took:           $took"
    [[ "$HAVE_EEZ" == 1 ]] || warn "No EEZ boundaries — search and area/stats pages won't work. Re-run to add them."
    echo ""
    # A ready-made export of the region made before this build is out of date now.
    if [[ "$REEXPORT" == yes ]]; then
        reexport_if_outdated
    fi
    echo ""
    info "Start the app with: bash scripts/start.sh"
}
