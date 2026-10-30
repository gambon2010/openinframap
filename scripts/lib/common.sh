# shellcheck shell=bash
# ---------------------------------------------------------------------------
# Shared helpers for scripts/*.sh. Source it, don't run it.
# ---------------------------------------------------------------------------

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA_DIR="$REPO_ROOT/data"
OSM_DIR="$DATA_DIR/osm"
EEZ_NAME="EEZ_land_union_v4_202410"
EEZ_ZIP="$DATA_DIR/$EEZ_NAME.zip"
EEZ_DOWNLOAD_URL="https://marineregions.org/download_file.php?name=$EEZ_NAME.zip"
EEZ_INFO_URL="https://marineregions.org/sources.php#unioneezcountry"
BUILD_LOG="$OSM_DIR/build-history.log"
# Offline background maps (Protomaps extracts), served by the `basemap` service.
BASEMAP_DIR="$DATA_DIR/basemap"
BASEMAP_PORT=8090
WEB_ENV="$REPO_ROOT/web/.env"
# Ready-made databases made by scripts/export-db.sh, imported by import-db.sh.
EXPORTS_DIR="$DATA_DIR/exports"
DOCKER_IMAGES_TAR="$EXPORTS_DIR/docker-images.tar.gz"
# Extra data (scripts/extra_data.py) saved before a rebuild wipes the database,
# one file per region: data/extra/<region>.extra.dump (+ .json).
EXTRA_DIR="$DATA_DIR/extra"
DB_USER=osm
DB_NAME=osm

# Set to 1 (e.g. via --yes) to accept the default answer of every prompt.
ASSUME_YES="${ASSUME_YES:-0}"

if [[ -t 1 ]]; then
    BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; RESET=$'\e[0m'
else
    BOLD=""; DIM=""; RED=""; GREEN=""; YELLOW=""; RESET=""
fi

section() { CURRENT_STEP="$*"; echo ""; echo "${BOLD}==> $*${RESET}"; }
info()    { echo "    $*"; }
ok()      { echo "    ${GREEN}✓${RESET} $*"; }
warn()    { echo "    ${YELLOW}!${RESET} $*"; }
die()     { echo ""; echo "${RED}ERROR:${RESET} $*" >&2; exit 1; }

# ask_yes_no "Question?" [default y|n] — returns 0 for yes.
ask_yes_no() {
    local question="$1" default="${2:-n}" hint answer
    if [[ "$ASSUME_YES" == 1 ]]; then
        [[ "$default" == y ]]
        return
    fi
    [[ "$default" == y ]] && hint="[Y/n]" || hint="[y/N]"
    read -r -p "    $question $hint " answer || die "Aborted."
    answer="${answer:-$default}"
    [[ "${answer,,}" == y || "${answer,,}" == yes ]]
}

check_cmd() {
    local cmd="$1" hint="$2"
    if command -v "$cmd" &>/dev/null; then
        printf "    %-12s ${GREEN}OK${RESET}\n" "$cmd"
    else
        printf "    %-12s ${RED}MISSING${RESET} — %s\n" "$cmd" "$hint"
        return 1
    fi
}

# Append a line to data/osm/build-history.log, which survives database wipes.
log_build() {
    mkdir -p "$OSM_DIR"
    echo "$(date '+%Y-%m-%d %H:%M')  $*" >> "$BUILD_LOG"
}

# run_with_timer "Label" command [args...]
# Runs a quiet, slow command with a ticking elapsed-time counter so it's
# obvious nothing is frozen. Its output is only shown if it fails.
run_with_timer() {
    local label="$1" log pid start=$SECONDS status=0
    shift
    log=$(mktemp)
    "$@" >"$log" 2>&1 &
    pid=$!
    if [[ -t 1 ]]; then
        while kill -0 "$pid" 2>/dev/null; do
            printf "\r    %s... %ds " "$label" $((SECONDS - start))
            sleep 1
        done
        printf "\r\e[K"
    else
        info "$label..."
    fi
    wait "$pid" || status=$?
    if [[ "$status" != 0 ]]; then
        cat "$log" >&2
        rm -f "$log"
        die "$label failed (see above)."
    fi
    rm -f "$log"
    ok "$label ($(( SECONDS - start ))s)"
}

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

human_size() {
    numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"
}

# Free bytes on the filesystem holding $1.
free_bytes() {
    df -P -B1 "$1" | awk 'NR==2 {print $4}'
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

# Make sure the marineregions.org EEZ zip is in data/, asking the user to
# download it (it's behind a free form) if needed. Returns 1 if they skip.
ensure_eez_zip() {
    if [[ ! -f "$EEZ_ZIP" && -f "$HOME/Downloads/$EEZ_NAME.zip" ]]; then
        info "Found $EEZ_NAME.zip in ~/Downloads — copying to data/."
        mkdir -p "$DATA_DIR"
        cp "$HOME/Downloads/$EEZ_NAME.zip" "$EEZ_ZIP"
    fi
    [[ -f "$EEZ_ZIP" ]] && return 0

    if [[ "$ASSUME_YES" == 1 ]]; then
        warn "EEZ boundaries not found at data/$EEZ_NAME.zip — they will be skipped."
        return 1
    fi

    info "Country boundaries (EEZ) come from marineregions.org. They're free, but the"
    info "site asks you to fill in a short form, so this one download is manual."
    info ""
    info "Without them the map still works, but search and the country stats pages don't."
    info ""
    info "  1. Open:  ${BOLD}$EEZ_DOWNLOAD_URL${RESET}"
    info "     (about the dataset: $EEZ_INFO_URL)"
    info "  2. Fill in the form and download ${BOLD}$EEZ_NAME.zip${RESET} (~19 MB)"
    info "  3. Leave it in ~/Downloads, or save it as: $EEZ_ZIP"
    info ""
    if command -v xdg-open &>/dev/null; then
        xdg-open "$EEZ_DOWNLOAD_URL" >/dev/null 2>&1 &
        info "(Trying to open the page in your browser now.)"
    elif command -v open &>/dev/null; then
        open "$EEZ_DOWNLOAD_URL"
        info "(Trying to open the page in your browser now.)"
    fi
    local answer
    while true; do
        read -r -p "    Press Enter once the download has finished, or type 'skip' to build without them: " answer || die "Aborted."
        if [[ "$answer" == skip ]]; then
            warn "Skipping EEZ boundaries. Search and area/stats pages won't work."
            return 1
        fi
        if [[ -f "$HOME/Downloads/$EEZ_NAME.zip" && ! -f "$EEZ_ZIP" ]]; then
            mkdir -p "$DATA_DIR"
            cp "$HOME/Downloads/$EEZ_NAME.zip" "$EEZ_ZIP"
        fi
        [[ -f "$EEZ_ZIP" ]] && return 0
        warn "Still can't find $EEZ_NAME.zip in ~/Downloads or data/."
    done
}

# Import $EEZ_ZIP into the countries schema (see ensure_eez_zip).
import_eez() {
    local eez_dir="$DATA_DIR/$EEZ_NAME"
    local shp
    shp=$(find "$eez_dir" -name "$EEZ_NAME.shp" 2>/dev/null | head -1 || true)
    if [[ -z "$shp" ]]; then
        info "Extracting $EEZ_NAME.zip..."
        mkdir -p "$eez_dir"
        unzip -qo "$EEZ_ZIP" -d "$eez_dir"
        shp=$(find "$eez_dir" -name "$EEZ_NAME.shp" | head -1)
        [[ -n "$shp" ]] || die "$EEZ_NAME.shp not found in the zip. Check it with: unzip -l $EEZ_ZIP"
    fi

    db_psql -c "CREATE SCHEMA IF NOT EXISTS countries;
                DROP TABLE IF EXISTS countries.country_eez CASCADE;"
    # shp2pgsql ships with the PostGIS image, so the host doesn't need it
    # (the alpine image is missing libintl, which it needs to run).
    local log
    log=$(mktemp)
    if ! docker compose --progress quiet run --rm --no-deps -T \
        -v "$eez_dir:/eez:ro,z" \
        --entrypoint sh db -c \
        "apk add --no-cache -q libintl >&2 && shp2pgsql -s 4326 -c '/eez/${shp#"$eez_dir"/}' countries.country_eez" \
        2>"$log" | db_psql >/dev/null; then
        cat "$log" >&2
        rm -f "$log"
        die "EEZ import failed (see above)."
    fi
    rm -f "$log"
    db_psql < "$REPO_ROOT/schema/eez.sql"
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

# Fingerprint of everything that decides what the database looks like. An
# export built with a different fingerprint may not match this checkout.
# How many extra-data features the database holds (0 if none or no extra schema).
extra_feature_count() {
    local n
    n=$(db_query "SELECT CASE WHEN to_regclass('extra.source') IS NULL THEN 0
                         ELSE (SELECT coalesce(sum(features), 0) FROM extra.source) END")
    echo "${n:-0}"
}

# One line describing the extra data in the database, e.g. for export manifests.
extra_description() {
    db_query "SELECT CASE WHEN to_regclass('extra.source') IS NOT NULL THEN
        (SELECT string_agg(name || ' (' || coalesce(to_char(features, 'FM999,999,999') || ' features', 'incomplete')
                           || ')', '; ' ORDER BY source) FROM extra.source) END"
}

# save_extra_data REGION — save the database's extra schema (it was imported
# for REGION) so a rebuild of that region can put it back without downloading it
# again (all of France takes 3-4 hours).
save_extra_data() {
    local region="$1" file="$EXTRA_DIR/$1.extra.dump" description
    mkdir -p "$EXTRA_DIR"
    description=$(extra_description)
    docker compose exec -T db pg_dump -U "$DB_USER" -Fc -Z zstd:3 -n extra "$DB_NAME" > "$file.part" || return 1
    mv "$file.part" "$file"
    python3 -c 'import json, sys
json.dump({"region_id": sys.argv[2], "description": sys.argv[3], "saved_at": sys.argv[4]},
          open(sys.argv[1], "w"), indent=2)' \
        "$EXTRA_DIR/$region.extra.json" "$region" "$description" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# restore_extra_data REGION — put saved extra data back into a fresh database,
# before schema/extra.sql runs (which then only adds what's new).
restore_extra_data() {
    local file="$EXTRA_DIR/$1.extra.dump"
    db_psql -c "CREATE SCHEMA IF NOT EXISTS extra;" || return 1
    # -n extra restores the schema's objects but not the schema itself (made above).
    docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
        --exit-on-error -n extra < "$file"
}

# "My layers" (the userdata schema, made by the backend: web-backend/src/fork/)
# belong to this computer, not to a region: saved before the database is wiped
# and put back afterwards, by build-region.sh and import-db.sh.
USERDATA_DUMP="$DATA_DIR/userdata/userdata.dump"

# user_data_saves — how many times "My layers" were saved (0: nothing to keep).
user_data_saves() {
    db_query "SELECT CASE WHEN to_regclass('userdata.save') IS NULL THEN 0
                          ELSE (SELECT count(*) FROM userdata.save) END" || echo 0
}

save_user_data() {
    mkdir -p "$(dirname "$USERDATA_DUMP")"
    docker compose exec -T db pg_dump -U "$DB_USER" -Fc -n userdata "$DB_NAME" > "$USERDATA_DUMP.part" || return 1
    mv "$USERDATA_DUMP.part" "$USERDATA_DUMP"
}

# restore_user_data — put the saved layers back (replacing any from an import).
restore_user_data() {
    db_psql -c "DROP SCHEMA IF EXISTS userdata CASCADE; CREATE SCHEMA userdata;" || return 1
    docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
        --exit-on-error -n userdata < "$USERDATA_DUMP"
}

schema_hash() {
    cat "$REPO_ROOT"/imposm/*.py "$REPO_ROOT"/schema/{functions,views,stats,eez,extra,sites}.sql | md5sum | cut -c1-12
}

# manifest_get FILE.json KEY — read one field of an export manifest.
manifest_get() {
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"
}

# export_outdated — true when data/exports/ has an export of the database's region
# that doesn't match it any more (rebuilt, another schema, other extra data).
# "My layers" don't count: they're kept per computer (see save_user_data).
export_outdated() {
    local region manifest
    region=$(build_info region_id)
    [[ -n "$region" ]] || return 1
    manifest="$EXPORTS_DIR/$region.json"
    [[ -f "$manifest" && -f "$EXPORTS_DIR/$region.oimdb" ]] || return 1
    [[ "$(manifest_get "$manifest" built_at)" != "$(build_info built_at)" \
        || "$(manifest_get "$manifest" schema_hash)" != "$(build_info schema_hash)" \
        || "$(manifest_get "$manifest" extra_data)" != "$(extra_description)" ]]
}

# reexport_if_outdated — export the database again, without asking, when its
# ready-made export is out of date (the Docker images saved with it are kept).
# Interrupting it is safe: the old export stays until the new one is complete.
reexport_if_outdated() {
    export_outdated || return 0
    section "The ready-made export of $(build_info region_name) is out of date: exporting it again..."
    info "(Ctrl+C to skip; the old export is kept until the new one is complete.)"
    bash "$REPO_ROOT/scripts/export-db.sh" --yes --no-docker-images \
        || warn "Exporting failed; run it again with: bash scripts/export-db.sh"
}

# Manifests of the exports in data/exports/, one path per line.
list_exports() {
    local f
    for f in "$EXPORTS_DIR"/*.json; do
        [[ -f "$f" && -f "${f%.json}.oimdb" ]] && echo "$f"
    done
}

# Offer to fill the Wikidata cache used by the info popups.
offer_image_cache() {
    local counts missing_json missing_images minutes choice
    if ! command -v uv &>/dev/null; then
        info "Skipped: filling the cache needs uv (https://docs.astral.sh/uv/). Without it,"
        info "popups fetch their details from Wikidata online."
        return
    fi
    if ! counts=$(uv run -q "$REPO_ROOT/scripts/fetch_images.py" --count 2>/dev/null | tail -1); then
        warn "Couldn't check the Wikidata cache. Fill it later with: uv run scripts/fetch_images.py"
        return
    fi
    read -r missing_json missing_images <<< "$counts"
    if [[ ! "$missing_json" =~ ^[0-9]+$ || ! "$missing_images" =~ ^[0-9]+$ ]]; then
        warn "Couldn't check the Wikidata cache. Fill it later with: uv run scripts/fetch_images.py"
        return
    fi
    if [[ "$missing_json" -eq 0 && "$missing_images" -eq 0 ]]; then
        ok "Wikidata cache is up to date."
        return
    fi
    # fetch_images.py downloads at most one image per second; metadata is batched.
    # Not every feature has a photo, so this is an upper bound.
    minutes=$(( (missing_images + 59) / 60 ))
    info "Info popups can show photos and details from Wikidata. In your region,"
    info "$missing_json features have no cached text and $missing_images have no cached photo,"
    info "so their popups need the internet for now."
    echo ""
    info "  1) Text and images  ${YELLOW}— slow: up to ~$minutes min (1 image per second, Wikimedia's limit)${RESET}"
    info "  2) Text only        — about 10 seconds; popups work offline, without photos"
    info "  3) Skip for now"
    echo ""
    read -r -p "    Choose [1-3, default 3]: " choice || choice=3
    case "${choice:-3}" in
        1) uv run "$REPO_ROOT/scripts/fetch_images.py" ;;
        2) uv run "$REPO_ROOT/scripts/fetch_images.py" --json-only ;;
        *) info "Skipped." ;;
    esac
    [[ "${choice:-3}" == 1 ]] || {
        info "To cache them later (safe to stop and re-run; cached items are skipped):"
        info "  uv run scripts/fetch_images.py              # text and images (slow)"
        info "  uv run scripts/fetch_images.py --json-only  # text only (fast)"
    }
}

# open_in_terminal "Title" "command" — run a command in a new terminal window
# that stays open afterwards. Returns 1 if no supported terminal is found.
open_in_terminal() {
    # The new window doesn't inherit this environment, so hand over PATH: it
    # may only find uv/node through the user's shell config (pyenv, nvm, ...).
    local title="$1" cmd
    cmd="export PATH=$(printf %q "$PATH"); $2; echo; echo '[$1 stopped — you can close this window]'; exec bash"
    if [[ "$(uname)" == Darwin ]]; then
        osascript -e "tell application \"Terminal\" to do script \"${cmd//\"/\\\"}\"" >/dev/null
        return
    fi
    [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || return 1
    if command -v ptyxis &>/dev/null; then
        ptyxis --new-window -- bash -c "$cmd" &>/dev/null &
    elif command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="$title" -- bash -c "$cmd" &>/dev/null
    elif command -v konsole &>/dev/null; then
        konsole -p tabtitle="$title" -e bash -c "$cmd" &>/dev/null &
    elif command -v xfce4-terminal &>/dev/null; then
        xfce4-terminal --title="$title" -x bash -c "$cmd" &>/dev/null &
    elif command -v kitty &>/dev/null; then
        kitty --title "$title" bash -c "$cmd" &>/dev/null &
    elif command -v alacritty &>/dev/null; then
        alacritty --title "$title" -e bash -c "$cmd" &>/dev/null &
    elif command -v x-terminal-emulator &>/dev/null; then
        x-terminal-emulator -e bash -c "$cmd" &>/dev/null &
    elif command -v xterm &>/dev/null; then
        xterm -T "$title" -e bash -c "$cmd" &>/dev/null &
    else
        return 1
    fi
}

# True if something answers HTTP on localhost:$1.
port_in_use() {
    curl -s -o /dev/null --max-time 2 "http://localhost:$1/"
}

APP_URL="http://localhost:5173"
BACKEND_PORT=8001
FRONTEND_PORT=5173

# Start Compose services, rebuilding their images first so code changes are
# picked up (fast when nothing changed). Offline the build fails, so fall back
# to the existing images (e.g. loaded from data/exports/docker-images.tar.gz).
up_services() {
    docker compose --progress quiet up -d --build "$@" </dev/null 2>/dev/null \
        || docker compose --progress quiet up -d "$@" </dev/null
}

open_browser() {
    if command -v xdg-open &>/dev/null; then
        xdg-open "$1" >/dev/null 2>&1 &
    elif command -v open &>/dev/null; then
        open "$1"
    fi
}

# Start whichever of the backend (Docker) and frontend (a new terminal
# window) isn't running yet, then open the map in the browser once it answers.
# Returns 1 if the frontend window couldn't be opened (print_manual_start then helps).
start_app() {
    # Only run npm install when packages changed, so the app also starts offline.
    local frontend_cmd="cd $(printf %q "$REPO_ROOT/web") && { [ node_modules/.package-lock.json -nt package-lock.json ] || npm install; } && npm start"
    if port_in_use "$BACKEND_PORT"; then
        ok "Backend already running."
    else
        # Create the cache folders first, or Docker creates them owned by root.
        mkdir -p "$DATA_DIR/images" "$DATA_DIR/wikidata_json"
        up_services backend
        ok "Backend started (Docker). Its log: docker compose logs -f backend"
    fi
    if port_in_use "$FRONTEND_PORT"; then
        ok "Frontend already running."
    else
        open_in_terminal "OpenInfraMap frontend" "$frontend_cmd" || return 1
        ok "Frontend started in a new window."
    fi

    # npm install can take a while the first time.
    local waited=0
    while ! port_in_use "$FRONTEND_PORT" && [[ "$waited" -lt 180 ]]; do
        [[ -t 1 ]] && printf "\r    Waiting for the map to come up... %ds " "$waited"
        sleep 2
        waited=$((waited + 2))
    done
    [[ -t 1 ]] && printf "\r\e[K"
    if port_in_use "$FRONTEND_PORT"; then
        ok "Opening the map in your browser: $APP_URL"
        open_browser "$APP_URL"
    else
        warn "The frontend hasn't answered yet — check its window, then open $APP_URL"
    fi
    info "To stop the app, press Ctrl+C in the frontend window (or close it),"
    info "then run: docker compose stop"
}

print_manual_start() {
    echo "Start the app:"
    echo ""
    echo "  Backend (Docker):"
    echo "    docker compose up -d backend"
    echo ""
    echo "  Frontend (in a terminal you keep open):"
    echo "    cd web && npm install && npm start"
    echo ""
    echo "  Then open: $APP_URL"
}

basemap_image() {
    docker compose config --format json </dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["basemap"]["image"])'
}

# Create web/.env with the local-stack defaults if it doesn't exist yet.
ensure_web_env() {
    [[ -f "$WEB_ENV" ]] && return
    cat > "$WEB_ENV" <<'ENV'
VITE_TILE_BASE_URL=https://openinframap.org
VITE_TEGOLA_URL=http://localhost:7800
VITE_BACKEND_BASE_URL=http://localhost:8001
# Background map: openinframap.org unless VITE_BASEMAP_URL is set. build-region.sh
# sets it when you download a background map for offline use; you can also point
# it at your own Protomaps-schema tile server (full {z}/{x}/{y} URL template):
# VITE_BASEMAP_URL=http://localhost:8080/region/{z}/{x}/{y}.mvt
# Optional Photon server for street-address search (not set up by the scripts):
# VITE_PHOTON_URL=http://localhost:2322
ENV
}

# set_env_line FILE KEY VALUE — set KEY=VALUE, replacing an existing KEY line.
# An empty VALUE removes the line.
set_env_line() {
    local file="$1" key="$2" value="$3"
    touch "$file"
    grep -v "^$key=" "$file" > "$file.tmp" || true
    [[ -n "$value" ]] && echo "$key=$value" >> "$file.tmp"
    mv "$file.tmp" "$file"
}

has_local_basemaps() {
    compgen -G "$BASEMAP_DIR/*.pmtiles" >/dev/null
}

# Point the frontend at the local background map for region $1 if there is one,
# and start the server. A setting pointing at a local map that no longer exists
# is removed, so the map falls back to the online one.
select_basemap() {
    local region="$1" current url
    ensure_web_env
    current=$(grep -E '^VITE_BASEMAP_URL=' "$WEB_ENV" | cut -d= -f2- || true)
    if [[ -f "$BASEMAP_DIR/$region.pmtiles" ]]; then
        url="http://localhost:$BASEMAP_PORT/$region/{z}/{x}/{y}.mvt"
        if [[ "$current" != "$url" ]]; then
            set_env_line "$WEB_ENV" VITE_BASEMAP_URL "$url"
            BASEMAP_CHANGED=1
        fi
        mkdir -p "$BASEMAP_DIR"
        docker compose --progress quiet up -d basemap </dev/null
        ok "Offline background map: $region (http://localhost:$BASEMAP_PORT)"
    elif [[ "$current" == "http://localhost:$BASEMAP_PORT/"* ]]; then
        # A local background map of another region (or a deleted one) would leave
        # this region blank: switch to the online one.
        set_env_line "$WEB_ENV" VITE_BASEMAP_URL ""
        BASEMAP_CHANGED=1
        info "Background map: online (openinframap.org)."
    fi
    if [[ "${BASEMAP_CHANGED:-0}" == 1 ]] && port_in_use "$FRONTEND_PORT"; then
        warn "Restart the frontend to switch background maps (Ctrl+C in its window, then bash scripts/start.sh)."
    fi
}

# Whether Geofabrik region $1 is $2 or inside it, following the parents in
# Geofabrik's index (GEOFABRIK_INDEX, downloaded by build-region.sh).
region_in() {
    python3 -c 'import json, sys
index, region, wanted = sys.argv[1:]
parents = {f["properties"]["id"]: f["properties"].get("parent") for f in json.load(open(index))["features"]}
while region:
    if region == wanted:
        sys.exit(0)
    region = parents.get(region)
sys.exit(1)' "${GEOFABRIK_INDEX:-$OSM_DIR/geofabrik-index-v1.json}" "$1" "$2" 2>/dev/null
}

# Satellite imagery of region $1 (scripts/satellite.py): data/basemap/<region>.sat-<tier>.pmtiles.
has_satellite() {
    compgen -G "$BASEMAP_DIR/$1.sat-*.pmtiles" >/dev/null
}

# "overview, regional (12 MB)": the tiers region $1 has, and their total size.
satellite_summary() {
    local region="$1" tiers="" total=0 file tier
    for tier in overview regional detailed; do
        file="$BASEMAP_DIR/$region.sat-$tier.pmtiles"
        [[ -f "$file" ]] || continue
        tiers+="${tiers:+, }$tier"
        total=$((total + $(stat -c%s "$file")))
    done
    echo "$tiers ($(human_size "$total"))"
}

# The max zoom in a PMTiles v3 header (byte 101), or $2 if it can't be read.
pmtiles_maxzoom() {
    python3 -c 'import sys
try:
    header = open(sys.argv[1], "rb").read(127)
    print(header[101] if header[:7] == b"PMTiles" else sys.argv[2])
except OSError:
    print(sys.argv[2])' "$1" "$2"
}

# Region $1's satellite tiers as the frontend reads them (VITE_SATELLITE_TIERS,
# fork/satellite): "URL MINZOOM MAXZOOM;URL MINZOOM MAXZOOM..." (empty: none).
satellite_tiers_value() {
    local region="$1" value="" tier file ext range
    for tier in overview regional detailed; do
        file="$BASEMAP_DIR/$region.sat-$tier.pmtiles"
        [[ -f "$file" ]] || continue
        case "$tier" in
            overview) ext=jpg;  range="0 8" ;;
            regional) ext=webp; range="9 $(pmtiles_maxzoom "$file" 12)" ;;
            detailed) ext=jpg;  range="14 $(pmtiles_maxzoom "$file" 16)" ;;
        esac
        value+="${value:+;}http://localhost:$BASEMAP_PORT/$region.sat-$tier/{z}/{x}/{y}.$ext $range"
    done
    echo "$value"
}

# Point the frontend at region $1's satellite imagery (or drop the setting if it
# has none), and start the server that serves it.
select_satellite() {
    local region="$1" current value
    ensure_web_env
    current=$(grep -E '^VITE_SATELLITE_TIERS=' "$WEB_ENV" | cut -d= -f2- || true)
    value=$(satellite_tiers_value "$region")
    if [[ "$current" != "$value" ]]; then
        set_env_line "$WEB_ENV" VITE_SATELLITE_TIERS "$value"
        BASEMAP_CHANGED=1
    fi
    if [[ -n "$value" ]]; then
        docker compose --progress quiet up -d basemap </dev/null
        ok "Satellite imagery: $(satellite_summary "$region"). Turn it on in Settings → Background."
    fi
    if [[ "${BASEMAP_CHANGED:-0}" == 1 ]] && port_in_use "$FRONTEND_PORT"; then
        warn "Restart the frontend to use the new imagery (Ctrl+C in its window, then bash scripts/start.sh)."
    fi
}

# Start the background-map server if any background map has been downloaded.
start_basemap_if_present() {
    if has_local_basemaps; then
        docker compose --progress quiet up -d basemap </dev/null
    fi
}

# --- Offline satellite imagery (scripts/satellite.py; docs/plans/satellite-imagery.md)
# Used by build-region.sh and satellite.sh. They read and set SATELLITE_MODE
# (none, keep, overview, regional, regional13), SATELLITE_DETAILED (none, 15-17),
# SATELLITE_AREA, and use PBF_URL (set: a Geofabrik region, its outline is known)
# and ASSUME_YES.

GEOFABRIK_INDEX="$OSM_DIR/geofabrik-index-v1.json"

# Write region $1's outline from the Geofabrik index to file $2 (GeoJSON).
geofabrik_outline() {
    python3 -c 'import json, sys
index, region, out = sys.argv[1:]
for feature in json.load(open(index))["features"]:
    if feature["properties"]["id"] == region and feature.get("geometry"):
        json.dump(feature["geometry"], open(out, "w"))
        sys.exit(0)
sys.exit(1)' "$GEOFABRIK_INDEX" "$1" "$2"
}

# choose_satellite REGION — the questions: which tiers, with their sizes.
choose_satellite() {
    local region="$1"
    SATELLITE_AREA="$BASEMAP_DIR/.area-$region.geojson"
    if [[ -z "$SATELLITE_MODE" && "$ASSUME_YES" == 1 ]]; then
        SATELLITE_MODE=none
        has_satellite "$region" && SATELLITE_MODE=keep
    fi
    if [[ "$SATELLITE_MODE" != none && "$SATELLITE_MODE" != keep ]]; then
        section "Satellite imagery"
        mkdir -p "$BASEMAP_DIR"
        SAT_ESTIMATE=""
        if [[ "$region" == planet ]]; then
            warn "Satellite imagery isn't offered for the whole world."
        elif [[ ! -f "$SATELLITE_AREA" ]] && ! { [[ -n "$PBF_URL" ]] && geofabrik_outline "$region" "$SATELLITE_AREA"; }; then
            warn "Can't tell which area this region covers, so there's no satellite imagery for it."
        else
            SAT_ESTIMATE=$(python3 -I "$REPO_ROOT/scripts/satellite.py" estimate --outline "$SATELLITE_AREA" --regional-maxzoom 13) \
                || warn "Couldn't work out the satellite imagery's size; skipping it."
        fi
        if [[ -z "$SAT_ESTIMATE" ]]; then
            SATELLITE_MODE=none
        else
            # sat_value KEY... : a value from the estimate (JSON).
            sat_value() {
                python3 -c 'import json, sys
value = json.loads(sys.argv[1])
for key in sys.argv[2:]:
    value = value[key]
print(int(value) if isinstance(value, (bool, int, float)) else value)' "$SAT_ESTIMATE" "$@"
            }
            SAT_OVERVIEW=$(sat_value overview bytes)
            SAT_REGIONAL13=$(sat_value regional bytes)
            SAT_REGIONAL=$((SAT_REGIONAL13 / 4))
            SAT_DOWNLOAD13=$(sat_value regional download)
            if has_satellite "$region"; then
                ok "Already downloaded: $(satellite_summary "$region")."
                if [[ -z "$SATELLITE_MODE" ]] && ! ask_yes_no "Download it again (or choose other tiers)?" n; then
                    SATELLITE_MODE=keep
                fi
            fi
            if [[ -z "$SATELLITE_MODE" ]]; then
                info "Satellite imagery as a background (Settings → Background), offline:"
                echo ""
                printf "      1) Overview               %8s  NASA Blue Marble, 500 m, to zoom 8\n" "$(human_size "$SAT_OVERVIEW")"
                printf "      2) + Regional             %8s  Sentinel-2 10 m (2021) to zoom 12; downloads ~%s\n" \
                    "$(human_size $((SAT_OVERVIEW + SAT_REGIONAL)))" "$(human_size $((SAT_DOWNLOAD13 / 4)))"
                printf "      3) + Regional, sharper    %8s  the same to zoom 13 (full 10 m); downloads ~%s\n" \
                    "$(human_size $((SAT_OVERVIEW + SAT_REGIONAL13)))" "$(human_size "$SAT_DOWNLOAD13")"
                printf "      4) Skip                   %8s\n" "—"
                echo ""
                while true; do
                    read -r -p "    Choose [1-4, default 2]: " CHOICE || die "Aborted."
                    case "${CHOICE:-2}" in
                        1) SATELLITE_MODE=overview; break ;;
                        2) SATELLITE_MODE=regional; break ;;
                        3) SATELLITE_MODE=regional13; break ;;
                        4) SATELLITE_MODE=none; break ;;
                    esac
                done
            fi
            # IGN's 20 cm aerial photos: France and its regions only.
            if [[ "$SATELLITE_MODE" != none && "$SATELLITE_MODE" != keep && -z "$SATELLITE_DETAILED" ]]; then
                if region_in "$region" france && [[ "$ASSUME_YES" != 1 ]]; then
                    echo ""
                    info "France: IGN aerial photos at 20 cm can be added for close zooms (14 and up):"
                    for z in 15 16 17; do
                        printf "      to zoom %s  %8s\n" "$z" "$(human_size "$(sat_value detailed_by_zoom "$z")")"
                    done
                    info "They're fetched tile by tile from IGN's server (about 20 a second), so a large"
                    info "region takes hours: best for a département or a city."
                    read -r -p "    Up to which zoom? [15/16/17, Enter: none]: " CHOICE || die "Aborted."
                    case "$CHOICE" in 15|16|17) SATELLITE_DETAILED=$CHOICE ;; esac
                fi
            fi
        fi
    fi
    [[ -z "$SATELLITE_DETAILED" ]] && SATELLITE_DETAILED=none
}

# download_satellite REGION — download what choose_satellite chose, then point
# the frontend at it.
download_satellite() {
    local region="$1"
    satellite_tier() {
        local tier="$1"
        shift
        python3 -I "$REPO_ROOT/scripts/satellite.py" "$tier" --outline "$SATELLITE_AREA" \
            --out "$BASEMAP_DIR/$region.sat-$tier.pmtiles" --pmtiles-image "$(basemap_image)" "$@" </dev/null
    }
    if [[ "$SATELLITE_MODE" == overview || "$SATELLITE_MODE" == regional || "$SATELLITE_MODE" == regional13 ]]; then
        section "Downloading satellite imagery..."
        SAT_OK=1
        run_with_timer "Overview (NASA Blue Marble, to zoom 8)" satellite_tier overview || SAT_OK=0
        if [[ "$SATELLITE_MODE" != overview ]]; then
            SAT_ZOOM=12
            [[ "$SATELLITE_MODE" == regional13 ]] && SAT_ZOOM=13
            run_with_timer "Regional (Sentinel-2 10 m, to zoom $SAT_ZOOM)" satellite_tier regional --maxzoom "$SAT_ZOOM" || SAT_OK=0
        fi
        if [[ "$SATELLITE_DETAILED" != none ]]; then
            run_with_timer "Detailed (IGN 20 cm, to zoom $SATELLITE_DETAILED)" satellite_tier detailed --maxzoom "$SATELLITE_DETAILED" || SAT_OK=0
        fi
        [[ "$SAT_OK" == 1 ]] || warn "Part of the satellite imagery failed. Run it again to try again: bash scripts/satellite.sh"
    fi
    select_satellite "$region"
}
