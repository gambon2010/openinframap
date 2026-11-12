# shellcheck shell=bash
# shellcheck disable=SC2034  # the build's variables are shared by its three files
# Fork: build-region.sh's helpers and questions (everything asked before the first long step). Sourced by build-region.sh (its variables, at the
# top of it, are what the steps share); not run on its own.

# ---------------------------------------------------------------------------
# Helpers for the steps
# ---------------------------------------------------------------------------

# Run osmium (Docker) with the source extract at /src.osm.pbf and data/osm at /osm.
osmium() {
    docker compose --progress quiet --profile tools run --rm -T --user "$(id -u):$(id -g)" \
        -v "$PBF_SOURCE:/src.osm.pbf:ro,z" -v "$OSM_DIR:/osm:z" osmium "$@"
}

# docker_need BYTES FILTERED — room Docker needs for the database built from an
# extract of BYTES (FILTERED: yes if it's the filtered one). The filtered extract
# is ~1-2% of the raw one, and the database ends up ~17× the filtered extract
# (Russia: 53 MB filtered → 1 GB database); the extra 2 GB covers Postgres itself
# and the EEZ boundaries.
docker_need() {
    local bytes="$1"
    [[ "$2" == yes ]] || bytes=$(( bytes / 50 ))
    echo $(( bytes * 20 + 2 * 1024 * 1024 * 1024 ))
}

# The ready-made export of region $1 (its manifest), if there is one.
export_manifest() {
    local manifest="$EXPORTS_DIR/$1.json"
    [[ -f "$manifest" && -f "$EXPORTS_DIR/$1.oimdb" ]] && echo "$manifest"
}

# Ids of regions with a ready-made export in data/exports/.
exported_regions() {
    local f
    for f in $(list_exports); do
        basename "$f" .json
    done
}

# export_note MANIFEST — "OSM data as of 2026-10-01, with extra data".
export_note() {
    local note
    note="OSM data as of $(json_get "$1" osm_timestamp | cut -c1-10)"
    [[ -n "$(json_get "$1" extra_data)" ]] && note+=", with extra data"
    echo "$note"
}

# Show what earlier runs left on disk, so nobody re-downloads by accident.
show_local_files() {
    local id f found=0 cached
    section "Already on this machine"
    for f in $(list_exports); do
        found=1
        ok "$(printf '%-22s %7s  ready-made export, %s' "$(basename "$f" .json)" \
            "$(human_size "$(json_get "$f" size)")" "$(export_note "$f")")"
    done
    for id in $(downloaded_regions); do
        found=1
        f=$(extract_file "$id")
        ok "$(printf '%-22s %7s  extract from %s%s' "$id" "$(human_size "$(stat -c%s "$f")")" "$(file_date "$f")" \
            "$([[ -f "$OSM_DIR/$id-filtered.osm.pbf" ]] && echo ', filtered')")"
    done
    [[ "$found" == 1 ]] || info "No region downloads yet (they're kept in data/osm/)."
    for f in "$BASEMAP_DIR"/*.pmtiles; do
        [[ -f "$f" ]] || continue
        ok "$(printf '%-22s %7s  offline background map, %s detail' "$(basename "$f" .pmtiles)" \
            "$(human_size "$(stat -c%s "$f")")" "$(json_get "${f%.pmtiles}.json" detail 2>/dev/null || echo unknown)")"
    done
    if [[ -f "$EEZ_ZIP" ]]; then
        ok "EEZ country boundaries"
    else
        info "EEZ country boundaries: not downloaded yet"
    fi
    # No cache folder on a fresh checkout: find fails, which mustn't stop the script.
    cached=$({ find "$DATA_DIR/wikidata_json" -name '*.json' 2>/dev/null || true; } | wc -l)
    if [[ "$cached" -gt 0 ]]; then
        ok "Wikidata cache: $cached entries, $(find "$DATA_DIR/images" -type f 2>/dev/null | wc -l) images"
    fi
    if [[ -s "$BUILD_LOG" ]]; then
        info ""
        info "Recent builds (data/osm/build-history.log):"
        tail -n 5 "$BUILD_LOG" | sed "s/^/      ${DIM}/; s/$/${RESET}/"
    fi
}

# --- The region menu (choose_region) ------------------------------------------------

# region_menu_line N ID ONLINE — one line of the region menu: its name, its size
# and what's already here (a ready-made export, a download).
region_menu_line() {
    local n="$1" id="$2" online="$3" name="" url="" size=0 note="" manifest extract
    [[ "$online" == 1 ]] && { IFS=$'\t' read -r name url < <(geofabrik_query lookup "$id") || true; }
    extract=$(extract_file "$id")
    if manifest=$(export_manifest "$id"); then
        [[ -n "$name" ]] || name=$(json_get "$manifest" region_name)
        size=$(json_get "$manifest" size)
        note="${GREEN}✓ ready-made export ($(export_note "$manifest")) — imports in minutes${RESET}${DIM}"
    else
        if [[ -n "$url" ]]; then
            size=$(remote_size "$url")
        elif [[ -f "$extract" ]]; then
            size=$(stat -c%s "$extract")
        fi
        [[ "$id" == "$TEST_REGION" ]] && note="tiny — good for a quick test"
        [[ "$id" == "$PLANET_ID" ]] && note="${YELLOW}slow — takes hours, see the warning${RESET}${DIM}"
        [[ -f "$extract" ]] && note="${GREEN}✓ downloaded $(file_date "$extract")${RESET}${DIM} ${note}"
    fi
    printf "    %3d) %-24s %7s  %s\n" "$n" "${name:-$id}" "$(human_size "$size")" "${DIM}$note${RESET}"
}

# pick_region — the region menu: the continents, the world and the test region
# (online), what's already here, a search, or a file. Sets REGION_ID or PBF_SOURCE.
pick_region() {
    local online=1 choices=() id i=0 search_choice=0 file_choice answer
    fetch_geofabrik_index || online=0
    [[ "$online" == 1 ]] && choices=("${CONTINENTS[@]}" "$PLANET_ID" "$TEST_REGION")
    # Also regions exported or downloaded earlier that aren't in the standard list.
    for id in $(exported_regions) $(downloaded_regions); do
        [[ " ${choices[*]} " == *" $id "* ]] || choices+=("$id")
    done
    echo ""
    [[ "$online" == 1 ]] || warn "No internet connection — showing only what's already on this computer."
    echo "    Which region do you want to build?"
    echo ""
    for id in "${choices[@]}"; do
        i=$((i + 1))
        region_menu_line "$i" "$id" "$online"
    done
    if [[ "$online" == 1 ]]; then
        i=$((i + 1))
        search_choice=$i
        printf "    %3d) %s\n" "$i" "Search for a country, state or province..."
    fi
    file_choice=$((i + 1))
    printf "    %3d) %s\n" "$file_choice" "Use an .osm.pbf file I already have"
    echo ""
    while true; do
        answer=$(choose_number "$file_choice")
        if [[ "$answer" -le ${#choices[@]} ]]; then
            REGION_ID="${choices[$((answer - 1))]}"
            return
        elif [[ "$answer" == "$search_choice" ]]; then
            search_region && return
        else
            read -r -e -p "    Path to the .osm.pbf file: " PBF_SOURCE || die "Aborted."
            PBF_SOURCE="${PBF_SOURCE/#\~/$HOME}"
            [[ -f "$PBF_SOURCE" ]] && return
            warn "File not found: $PBF_SOURCE"
            PBF_SOURCE=""
        fi
    done
}

# search_region — search Geofabrik's regions by name; sets REGION_ID (1: none chosen).
search_region() {
    local term id name parent answer ids=()
    read -r -p "    Search for: " term || die "Aborted."
    [[ -n "$term" ]] || return 1
    while IFS=$'\t' read -r id name parent; do
        ids+=("$id")
        printf "    %3d) %s %s\n" "${#ids[@]}" "$name" "${DIM}${parent:+(in $parent)}${RESET}"
    done < <(geofabrik_query search "$term")
    if [[ ${#ids[@]} -eq 0 ]]; then
        warn "No region matches \"$term\"."
        return 1
    fi
    answer=$(choose_number --or-enter "${#ids[@]}") || return 1
    REGION_ID="${ids[$((answer - 1))]}"
}

# --- Extra data (ask_extra_data) ---------------------------------------------------

# find_kept_extra_data — EXTRA_KEPT: the extra data that will be put back, from
# the database being replaced (saved before it's wiped) or an earlier rebuild.
find_kept_extra_data() {
    local saved="$EXTRA_DIR/$REGION_ID.extra.json"
    EXTRA_KEPT=""
    if [[ "$EXTRA_KEEP" == no ]]; then
        return 0  # --no-extra: none at all (a saved copy stays in data/extra/)
    fi
    if [[ "$EXISTING_REGION_ID" == "$REGION_ID" && "$EXISTING_EXTRA" -gt 0 ]]; then
        EXTRA_KEPT="$(printf "%'d" "$EXISTING_EXTRA") features in the current database"
    elif [[ -f "$EXTRA_DIR/$REGION_ID.extra.dump" ]]; then
        EXTRA_KEPT="$(json_get "$saved" description 2>/dev/null), saved $(json_get "$saved" saved_at 2>/dev/null | cut -c1-10)"
    fi
}

# find_extra_offer — which extra datasets cover the region (extra_data.py offer:
# key <tab> label <tab> cost per line). EXTRA_COVERAGE: covered, none, or unknown
# (a local file, offline, or no uv); the datasets in EXTRA_KEYS / _LABELS / _COSTS.
find_extra_offer() {
    local offer="" status=2 key label cost
    EXTRA_COVERAGE=unknown
    EXTRA_KEYS=() EXTRA_LABELS=() EXTRA_COSTS=()
    if command -v uv &>/dev/null; then
        offer=$(uv run -q "$REPO_ROOT/scripts/extra_data.py" offer --region-id "$REGION_ID" </dev/null 2>/dev/null) \
            && status=0 || status=$?
    fi
    case "$status" in
        0) EXTRA_COVERAGE=covered ;;
        1) EXTRA_COVERAGE=none ;;
    esac
    if [[ "$EXTRA_COVERAGE" == covered ]]; then
        while IFS=$'\t' read -r key label cost; do
            EXTRA_KEYS+=("$key") EXTRA_LABELS+=("$label") EXTRA_COSTS+=("$cost")
        done <<<"$offer"
    fi
}

# choose_extra_datasets — the datasets offered, picked by number ("1,3", "all",
# Enter = none); sets EXTRA_CHOOSE.
choose_extra_datasets() {
    local i answer n valid
    for i in "${!EXTRA_KEYS[@]}"; do
        printf '      %d) %s\n         %s\n' "$((i + 1))" "${EXTRA_LABELS[$i]}" "${EXTRA_COSTS[$i]}"
    done
    info "You can also do it later with: uv run scripts/extra_data.py import --choose KEY,..."
    EXTRA_CHOOSE=""
    while true; do
        read -r -p "    Choose (e.g. 1,3 or all; Enter = none): " answer || answer=""
        answer="${answer//[[:space:]]/}"
        [[ -z "$answer" ]] && return 0
        if [[ "$answer" == all ]]; then
            EXTRA_CHOOSE=$(IFS=,; echo "${EXTRA_KEYS[*]}")
            return 0
        fi
        EXTRA_CHOOSE="" valid=1
        for n in ${answer//,/ }; do
            if [[ "$n" =~ ^[0-9]+$ && "$n" -ge 1 && "$n" -le "${#EXTRA_KEYS[@]}" ]]; then
                EXTRA_CHOOSE="${EXTRA_CHOOSE:+$EXTRA_CHOOSE,}${EXTRA_KEYS[$((n - 1))]}"
            else
                valid=0
            fi
        done
        [[ "$valid" == 1 ]] && return 0
        warn "Type numbers from the list, separated by commas, or all."
    done
}

# --- The background map --------------------------------------------------------------

# region_outline — the region's outline for the offline maps menu
# (data/basemap/.area-<region>.geojson, where it looks first): Geofabrik's, else
# the local file's bounding box as a rectangle.
region_outline() {
    local outline="$BASEMAP_DIR/.area-$REGION_ID.geojson" bbox
    [[ "$REGION_ID" == "$PLANET_ID" ]] && return 0
    mkdir -p "$BASEMAP_DIR"
    if [[ -n "$PBF_URL" ]] && geofabrik_outline "$REGION_ID" "$outline"; then
        return 0
    elif [[ -f "$PBF_SOURCE" ]]; then
        bbox=$(osmium fileinfo -g header.boxes /src.osm.pbf 2>/dev/null | tr -d '() ' | head -1 || true)
        if [[ "$bbox" =~ ^-?[0-9.]+,-?[0-9.]+,-?[0-9.]+,-?[0-9.]+$ ]]; then
            python3 -c 'import json, sys
w, s, e, n = map(float, sys.argv[1].split(","))
json.dump({"type": "Polygon", "coordinates": [[[w, s], [e, s], [e, n], [w, n], [w, s]]]}, open(sys.argv[2], "w"))' "$bbox" "$outline"
        fi
    fi
    return 0
}

# ---------------------------------------------------------------------------
# The steps (each a function; the build runs them in order at the end)
# ---------------------------------------------------------------------------

# Docker, curl, python3, unzip (uv optional), and the osmium image.
check_prerequisites() {
    banner "build the map database"
    section "Checking prerequisites..."
    local missing=0
    check_cmd docker  "https://docs.docker.com/get-docker/"       || missing=1
    check_cmd curl    "dnf install curl  /  apt install curl"     || missing=1
    check_cmd python3 "dnf install python3  /  apt install python3" || missing=1
    check_cmd unzip   "dnf install unzip  /  apt install unzip"   || missing=1
    check_cmd uv      "optional — https://docs.astral.sh/uv/ (for extra data like the French networks)" || true
    [[ "$missing" == 0 ]] || die "Install the missing tools above, then re-run this script."
    docker info >/dev/null 2>&1 || die "Docker is installed but not running (or your user can't access it)."
    docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is required ('docker compose', not 'docker-compose')."
    docker compose --progress quiet --profile tools build osmium </dev/null
}

# The region to build (menu, or --region / --pbf).
choose_region() {
    show_local_files
    section "Choosing a region..."
    if [[ -z "$REGION_ID" && -z "$PBF_SOURCE" ]]; then
        [[ "$ASSUME_YES" == 1 ]] && die "--yes needs --region or --pbf."
        pick_region
    fi
}

# A ready-made export of the region: import it instead (and stop here).
offer_ready_made() {
    local manifest args
    if [[ -n "$REGION_ID" && -z "$PBF_SOURCE" && "$REBUILD" == no ]] \
        && manifest=$(export_manifest "$REGION_ID"); then
        info "There's a ready-made export of this region ($(export_note "$manifest"))."
        [[ -n "$(json_get "$manifest" extra_data)" ]] && info "Its extra data: $(json_get "$manifest" extra_data)"
        if ask_yes_no "Import it? (No = download and rebuild from scratch)" y; then
            args=("$EXPORTS_DIR/$REGION_ID.oimdb")
            [[ "$ASSUME_YES" == 1 ]] && args+=(--yes)
            exec bash "$REPO_ROOT/scripts/import-db.sh" "${args[@]}"
        fi
    fi
}

# The region's name, where it comes from and its size (a local file, Geofabrik,
# or an earlier download when offline).
find_region_source() {
    if [[ -n "$PBF_SOURCE" ]]; then
        [[ -f "$PBF_SOURCE" ]] || die "File not found: $PBF_SOURCE"
        PBF_SOURCE="$(cd "$(dirname "$PBF_SOURCE")" && pwd)/$(basename "$PBF_SOURCE")"
        REGION_ID="$(basename "$PBF_SOURCE" .osm.pbf | tr -c 'A-Za-z0-9_.\n-' '-')"
        REGION_NAME="$REGION_ID (local file)"
    else
        if fetch_geofabrik_index; then
            IFS=$'\t' read -r REGION_NAME PBF_URL < <(geofabrik_query lookup "$REGION_ID") || true
        fi
        PBF_SOURCE=$(extract_file "$REGION_ID")
        if [[ -n "$PBF_URL" ]]; then
            DOWNLOAD_SIZE=$(remote_size "$PBF_URL")
        elif [[ -f "$PBF_SOURCE" ]]; then
            # Offline (or not a Geofabrik region): rebuild from the earlier download.
            REGION_NAME="${REGION_NAME:-$REGION_ID}"
        else
            die "Unknown region '$REGION_ID', or no internet connection to download it."
        fi
    fi
    ok "$REGION_NAME"
    if [[ "$REGION_ID" == "$PLANET_ID" ]]; then
        section "Building the whole world takes a while"
        warn "Download: ~$(human_size "$DOWNLOAD_SIZE") from openstreetmap.org — about 30 min on a fast"
        warn "          connection, 2–3 hours at 10 MB/s. It resumes if interrupted."
        warn "Filtering: roughly 30–60 min (osmium reads the whole file once)."
        warn "Import, views and stats: probably under an hour."
        warn "Disk: ~100 GB in data/osm/ plus 30–50 GB for the database (checked below)."
        info "Everything runs unattended after the questions, and finished steps aren't"
        info "repeated if you re-run, so it's fine to leave it overnight."
        ask_yes_no "Build the whole world?" y || die "Aborted — nothing was changed."
    fi
}

# Whether to download (missing, or a newer extract), decided now so nothing is
# asked later.
decide_download() {
    [[ -n "$PBF_URL" ]] || return 0
    REMOTE_MD5=$(download --quick "$PBF_URL.md5" | cut -d' ' -f1 || true)
    if [[ ! -f "$PBF_SOURCE" ]]; then
        DOWNLOAD=yes
        [[ -f "$PBF_SOURCE.new.part" ]] && info "Resuming an earlier, unfinished download."
    elif [[ -z "$REMOTE_MD5" ]]; then
        info "Using the extract downloaded on $(file_date "$PBF_SOURCE") (can't reach Geofabrik to check for a newer one)."
    elif [[ "$(cat "$PBF_SOURCE.md5" 2>/dev/null)" == "$REMOTE_MD5" ]]; then
        ok "Already downloaded, and it's the latest extract — no download needed."
    else
        info "You already have this region, downloaded on $(file_date "$PBF_SOURCE")."
        info "Geofabrik has a newer extract ($(human_size "$DOWNLOAD_SIZE"))."
        if [[ "$REFRESH" == yes ]]; then
            DOWNLOAD=yes
        elif [[ "$ASSUME_YES" != 1 ]] && ask_yes_no "Download the newer one? (No = use the one you have)" n; then
            DOWNLOAD=yes
        else
            ok "Using the extract you already have."
        fi
    fi
}

# Room for the download (the raw extract plus the much smaller filtered copy) and,
# roughly, for the database.
check_space() {
    local need raw
    mkdir -p "$OSM_DIR"
    need=$(( DOWNLOAD_SIZE * 115 / 100 ))
    [[ "$DOWNLOAD" == no && -f "$PBF_SOURCE" ]] && need=$(( $(stat -c%s "$PBF_SOURCE") * 15 / 100 ))
    room_for "$need" "$OSM_DIR" "data/osm/" || die "Not enough disk space in $OSM_DIR."
    DOCKER_ROOT=$(docker info -f '{{.DockerRootDir}}' 2>/dev/null || true)
    if [[ -n "$DOCKER_ROOT" ]] && free_bytes "$DOCKER_ROOT" >/dev/null 2>&1; then
        raw=$DOWNLOAD_SIZE
        [[ -f "$PBF_SOURCE" ]] && raw=$(stat -c%s "$PBF_SOURCE")
        room_for "$(docker_need "$raw" no)" "$DOCKER_ROOT" "Docker ($DOCKER_ROOT)" \
            || die "Not enough disk space for Docker."
    fi
}

# The database there is replaced: say so, and note its extra data.
confirm_replacing_database() {
    db_volume_exists || return 0
    section "Existing database"
    start_db
    local existing
    existing=$(build_info region_name)
    if [[ -n "$existing" ]]; then
        info "Your local database currently contains: ${BOLD}$existing${RESET}"
    else
        info "There is an existing local database (possibly an unfinished build)."
    fi
    info "Building a new region ${BOLD}deletes it${RESET} and starts from scratch."
    ask_yes_no "Delete the existing database and continue?" y || die "Aborted — nothing was changed."
    # Its extra data (not from OSM) is saved first and kept for its region.
    EXISTING_REGION_ID=$(build_info region_id)
    EXISTING_EXTRA=$(extra_feature_count)
}

# Country boundaries (EEZ), and caching Wikidata images at the end.
ask_boundaries_and_images() {
    section "Country boundaries"
    if ensure_eez_zip; then
        HAVE_EEZ=1
        ok "EEZ boundaries found."
    fi
    [[ "$IMAGES" == ask && "$ASSUME_YES" == 1 ]] && IMAGES=no
    if [[ "$IMAGES" == ask ]]; then
        section "Wikidata images"
        info "Info popups can show photos and details from Wikidata. Caching them for"
        info "offline use makes ~2 requests per second, so it can take hours for a"
        info "continent. You can always do it later with: uv run scripts/fetch_images.py"
        IMAGES=no
        if ! command -v uv &>/dev/null; then
            warn "uv isn't installed, so this step will be skipped."
        elif ask_yes_no "Cache Wikidata images at the end of the build?" n; then
            IMAGES=yes
        fi
    fi
}

# Extra data (not from OSM): what's kept from before, and what to add.
ask_extra_data() {
    find_kept_extra_data
    EXTRA_COVERAGE=unknown
    if [[ "$EXTRA_NEW" != no ]]; then
        find_extra_offer
    fi
    case "$EXTRA_NEW" in
        yes)
            if [[ "$EXTRA_COVERAGE" == none ]]; then
                info "No extra data covers $REGION_NAME, so --extra does nothing."
                EXTRA_NEW=no
            elif [[ "$EXTRA_COVERAGE" == covered && -z "$EXTRA_CHOOSE" ]]; then
                EXTRA_CHOOSE=$(IFS=,; echo "${EXTRA_KEYS[*]}")  # --extra: all of it
            fi
            ;;
        ask)
            EXTRA_NEW=no
            if [[ -n "$EXTRA_KEPT" ]]; then
                section "Extra data (not from OpenStreetMap)"
                ok "The extra data for this region is kept: $EXTRA_KEPT"
                info "It's put back without downloading it again, minus anything the new OSM data has."
            fi
            if [[ "$ASSUME_YES" == 1 || "$EXTRA_COVERAGE" == none ]]; then
                :  # nothing more (kept data still goes back)
            elif ! command -v uv &>/dev/null; then
                warn "uv isn't installed, so extra data can't be imported."
            elif [[ "$EXTRA_COVERAGE" == unknown ]]; then
                [[ -n "$EXTRA_KEPT" ]] || section "Extra data (not from OpenStreetMap)"
                info "Couldn't check which extra data covers this region (a local file, or no internet)."
                if ask_yes_no "Import any that covers it at the end of the build?" n; then
                    EXTRA_NEW=yes
                fi
            else
                if [[ -n "$EXTRA_KEPT" ]]; then
                    info "Choose any to download again (a fresh copy replaces the kept one):"
                else
                    section "Extra data (not from OpenStreetMap)"
                    info "Open data published outside OpenStreetMap covers this region. It's drawn like"
                    info "the OSM data, and its popups say where it comes from. Choose what to import"
                    info "at the end of the build:"
                fi
                choose_extra_datasets
                if [[ -n "$EXTRA_CHOOSE" ]]; then
                    EXTRA_NEW=yes
                fi
            fi
            ;;
    esac
    if [[ -n "$EXTRA_CHOOSE" ]]; then
        info "Extra data to import: $EXTRA_CHOOSE"
    fi
}

# The offline background map: chosen in the offline maps menu (ask_satellite);
# --basemap full queues it without a question, downloaded after the build.
prepare_background_map() {
    region_outline
    # The whole world zoomed out (to zoom 8: every country's borders and names,
    # 560 MB) comes by default, once; --basemap none leaves it out.
    if [[ "$BASEMAP_MODE" != none && ! -f "$BASEMAP_DIR/world.pmtiles" ]]; then
        python3 -I "$REPO_ROOT/scripts/satellite.py" maps --queue-only --yes \
            --source protomaps --area world --zoom 8 \
            --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX" \
            || warn "Couldn't plan the world's background map (no network?)."
        SATELLITE_MENU=1
    fi
    if [[ "$BASEMAP_MODE" == full ]]; then
        python3 -I "$REPO_ROOT/scripts/satellite.py" maps --queue-only --yes \
            --source protomaps --area "$(maps_area)" --region "$(maps_area)" \
            --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX" \
            || warn "Couldn't plan the background map; the build goes on without it."
        SATELLITE_MENU=1
    fi
    return 0
}

# The region as the offline maps menu calls it (the planet: world).
maps_area() {
    if [[ "$REGION_ID" == "$PLANET_ID" ]]; then echo world; else echo "$REGION_ID"; fi
}

# Satellite imagery (lib/satellite.sh).
ask_satellite() {
    choose_satellite "$(maps_area)"
}
