#!/usr/bin/env bash
set -euo pipefail

# ---------------------------------------------------------------------------
# build-region.sh — build the local OpenInfraMap database for one region
#
# Interactive:
#   bash scripts/build-region.sh
#
# Unattended (e.g. for building the downloadable database dumps):
#   bash scripts/build-region.sh --region europe --yes
#   bash scripts/build-region.sh --pbf ~/planet.osm.pbf --yes
#
# All the questions come first (the region, a ready-made export to import
# instead, replacing the database, extra data, the background map, satellite
# imagery); then it runs on its own: download the region (resumable, checksum-
# verified) → keep only the infrastructure (osmium) → a fresh database (My layers
# and extra data kept) → import (imposm) → the SQL steps (schema/) → country
# boundaries → extra data → Tegola → background map and satellite imagery →
# Wikidata images → export again if the ready-made one is out of date.
#
# Downloads and filtered extracts are kept in data/osm/ and reused. Downloads
# wait for a lost connection (scripts/lib/net.sh). The steps are the functions
# below, run in order at the end of the file.
# ---------------------------------------------------------------------------

# shellcheck source=lib/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/common.sh"
cd "$REPO_ROOT"

# The regions offered first (Geofabrik ids), and the one for a quick test.
CONTINENTS=(africa antarctica asia australia-oceania central-america europe north-america russia south-america)
TEST_REGION=luxembourg

usage() {
    cat <<EOF
Usage: bash scripts/build-region.sh [options]

  --region ID     Geofabrik region id, e.g. europe, africa, france, california,
                  or "planet" for the whole world (very slow: ~95 GB download)
  --pbf FILE      Use an .osm.pbf file you already have instead of downloading
  --images        Also cache Wikidata images (slow: can take hours)
  --no-images     Don't cache Wikidata images and don't ask about it
  --extra         Also download open data from outside OpenStreetMap that covers
                  the region (e.g. French distribution networks; see
                  scripts/extra_data.py). Extra data already imported for the
                  region is kept across rebuilds anyway (saved in data/extra/)
  --extra-only LIST  Only these extra datasets, e.g. gas,icpe (choices: electricity,
                  gas, biomethane, icpe; see: uv run scripts/extra_data.py offer)
  --no-extra      No extra data at all, and don't ask about it
  --no-filter     Import the extract as-is, without the osmium pre-filter
  --basemap MODE  Offline background map for the region: full or none. Default:
                  the offline maps menu (with --yes: none). Downloaded after the build
  --satellite MODE  Offline satellite imagery: none, overview (NASA Blue Marble,
                  zoom 0-8), regional (+ Sentinel-2 10 m, zoom 9-12) or regional13
                  (to zoom 13). Default: ask (with --yes: keep what you have, else none)
  --satellite-detailed ZOOM  France only: IGN 20 cm aerial photos from zoom 14 to
                  ZOOM (15, 16 or 17), or none. Large: see the estimate when asked
  --rebuild       Build from scratch even if data/exports/ has a ready-made export
  --no-export     Don't export the region again when its ready-made export in
                  data/exports/ is out of date (by default it is, at the end)
  --refresh       Download a newer Geofabrik extract if there is one (by default
                  an extract you already downloaded is reused, and you're asked)
  --yes, -y       Don't ask questions; accept the defaults (wipes the database!)
  -h, --help      Show this help
EOF
}

# ---------------------------------------------------------------------------
# What the build will do. The options set some of it; the questions (the ask_*
# steps) the rest. Choices are yes / no, or ask (not decided yet).
# ---------------------------------------------------------------------------

# The region
REGION_ID=""          # Geofabrik id, or the local file's name (--pbf)
REGION_NAME=""        # shown, and stored in oim_build_info
PBF_SOURCE=""         # the .osm.pbf read: data/osm/<id>-latest.osm.pbf, or --pbf
PBF_URL=""            # where it's downloaded from ("" for a local file)
DOWNLOAD_SIZE=0       # bytes to download (0: nothing to download)
DOWNLOAD=no           # yes: download the extract (missing, or a newer one)
REMOTE_MD5=""         # Geofabrik's checksum of the extract, to verify it
REFRESH=no            # --refresh: a newer extract is downloaded without asking
REBUILD=no            # --rebuild: ignore a ready-made export
FILTER=yes            # --no-filter: import the whole extract
IMPORT_PBF=""         # what imposm reads: the filtered extract, or the whole one
OSM_TIMESTAMP=""      # how recent the OSM data is (the extract's header)

# The database being replaced
EXISTING_REGION_ID="" # its region, whose extra data is saved before the wipe
EXISTING_EXTRA=0      # its extra data features

# What else goes in
HAVE_EEZ=0            # 1: the country boundaries (EEZ) zip is there
IMAGES=ask            # Wikidata images at the end (--images / --no-images)
EXTRA_KEEP=yes        # put back extra data kept from before (--no-extra: no)
EXTRA_KEPT=""         # what is kept, described ("" if nothing)
EXTRA_NEW=ask         # download extra data (--extra, --extra-only: yes; --no-extra: no)
EXTRA_CHOOSE=""       # which datasets (e.g. gas,icpe; "" = all that cover the region)
EXTRA_RESTORED=0      # 1: the kept extra data went back in
BASEMAP_MODE=""       # background map: full, none ("" = the offline maps menu)
SATELLITE_MODE=""     # satellite imagery (lib/satellite.sh; "" = ask)
SATELLITE_DETAILED="" # aerial photos to this zoom, or none ("" = ask)
REEXPORT=yes          # --no-export: don't export again when out of date

# Disk space
DOCKER_ROOT=""        # where Docker keeps the database (checked twice)

# ---------------------------------------------------------------------------
# Options
# ---------------------------------------------------------------------------
while [[ $# -gt 0 ]]; do
    case "$1" in
        --region)    REGION_ID="${2:?--region needs a value}"; shift 2 ;;
        --pbf)       PBF_SOURCE="${2:?--pbf needs a value}"; shift 2 ;;
        --images)    IMAGES=yes; shift ;;
        --no-images) IMAGES=no; shift ;;
        --extra)     EXTRA_NEW=yes; shift ;;
        --no-extra)  EXTRA_NEW=no; EXTRA_KEEP=no; shift ;;
        --extra-only) EXTRA_CHOOSE="${2:?--extra-only needs a list, e.g. gas,icpe}"; EXTRA_NEW=yes; shift 2 ;;
        --no-filter) FILTER=no; shift ;;
        --refresh)   REFRESH=yes; shift ;;
        --rebuild)   REBUILD=yes; shift ;;
        --no-export) REEXPORT=no; shift ;;
        --basemap)   BASEMAP_MODE="${2:?--basemap needs full or none}"; shift 2 ;;
        --satellite) SATELLITE_MODE="${2:?--satellite needs none, overview, regional or regional13}"; shift 2 ;;
        --satellite-detailed) SATELLITE_DETAILED="${2:?--satellite-detailed needs 15, 16, 17 or none}"; shift 2 ;;
        --yes|-y)    ASSUME_YES=1; shift ;;
        -h|--help)   usage; exit 0 ;;
        *)           usage; die "Unknown option: $1" ;;
    esac
done

# Check option values now, before any question or download.
case "$BASEMAP_MODE" in
    ""|full|none) ;;
    reduced) die "--basemap reduced no longer exists: background maps are full detail (--basemap full)." ;;
    *) die "--basemap must be full or none." ;;
esac
case "$SATELLITE_MODE" in
    ""|none|overview|regional|regional13) ;;
    *) die "--satellite must be none, overview, regional or regional13." ;;
esac
case "$SATELLITE_DETAILED" in
    ""|none|15|16|17) ;;
    *) die "--satellite-detailed must be 15, 16, 17 or none." ;;
esac

# Unfinished builds are noted in data/osm/build-history.log.
BUILD_STARTED=0
BUILD_DONE=0
trap 'echo; warn "Interrupted. Re-run the script to continue — downloads resume where they stopped."; exit 130' INT
trap 'status=$?
      if [[ "$status" != 0 && "$BUILD_STARTED" == 1 && "$BUILD_DONE" == 0 ]]; then
          [[ "$status" == 130 ]] && log_build "$REGION_ID  interrupted during: ${CURRENT_STEP:-?}" \
                                 || log_build "$REGION_ID  FAILED during: ${CURRENT_STEP:-?} (exit $status)"
      fi' EXIT

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
    download_satellite "$(maps_area)"
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

# ---------------------------------------------------------------------------
# The build: all the questions first, then it runs on its own.
# ---------------------------------------------------------------------------
check_prerequisites
choose_region
offer_ready_made
find_region_source
decide_download
check_space
confirm_replacing_database
ask_boundaries_and_images
ask_extra_data
prepare_background_map
ask_satellite
start_building
download_extract
filter_extract
check_docker_space
import_osm
import_boundaries
record_build
import_extra_data
start_tile_server
offline_background
cache_wikidata
finish
