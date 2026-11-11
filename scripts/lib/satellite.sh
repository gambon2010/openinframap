# shellcheck shell=bash
# Offline satellite imagery (scripts/satellite.py; docs/plans/satellite-imagery.md)
# Used by build-region.sh and satellite.sh: choose_satellite asks (or takes the
# presets) and writes a plan, download_satellite runs it. The questions, sizes and
# outlines are satellite.py's (choose, steps), from Geofabrik's index.

# Sentinel-2's first zoom, for every area (scripts/satimagery/sources.py TIERS: the
# same number, checked by a test).
REGIONAL_FIRST_ZOOM=7

# Satellite imagery of region $1 (scripts/satellite.py): data/basemap/<region>.sat-<tier>.pmtiles.
has_satellite() {
    compgen -G "$BASEMAP_DIR/*.sat-*.pmtiles" >/dev/null
}

# region_satellite REGION — whether imagery of the region itself is downloaded.
region_satellite() {
    compgen -G "$BASEMAP_DIR/$1.sat-*.pmtiles" >/dev/null
}

# The overview tier (NASA Blue Marble, the whole world to zoom 8), one file shared
# by every region. Older builds have their own $region.sat-overview.pmtiles.
world_overview() { echo "$BASEMAP_DIR/world.sat-overview.pmtiles"; }

# overview_file REGION — the overview the region uses: the world's, else its own.
overview_file() {
    if [[ -f "$(world_overview)" ]]; then world_overview; else echo "$BASEMAP_DIR/$1.sat-overview.pmtiles"; fi
}

# "world overview, france regional, IGN photos of 2 départements (12 MB)": the
# tiers region $1 has, and their total size.
satellite_summary() {
    local value file total=0 names=() departements=0
    value=$(satellite_tiers_value "$1")
    [[ -n "$value" ]] || { echo "none"; return; }
    for file in $(tr ';' '\n' <<<"$value" | cut -d' ' -f1 | sed -E 's|.*/([^/]+)/\{z\}.*|\1|'); do
        if [[ "$file" == fr-*.sat-detailed-fr_ign ]]; then
            departements=$((departements + 1))
        else
            names+=("${file/.sat-/ }")
        fi
        total=$((total + $(stat -c%s "$BASEMAP_DIR/$file.pmtiles")))
    done
    [[ "$departements" == 0 ]] || names+=("IGN photos of $departements département$([[ "$departements" == 1 ]] || echo s)")
    echo "$(IFS=,; echo "${names[*]}" | sed 's/,/, /g') ($(human_size "$total"))"
}

# The satellite tiers as the frontend reads them (VITE_SATELLITE_TIERS,
# fork/modules/satellite): "URL MINZOOM MAXZOOM [W,S,E,N]|CREDIT;..." (empty:
# none; the bounds from the file's header, so the map only asks the files that
# cover what's on screen: one per French département); the
# credit lines come from satellite.py (attribution_for). Everything downloaded
# is shown, whatever area it's of: the overview (the world's, else region $1's),
# then Sentinel-2 (the world's first, then each area's), then the aerial photos.
satellite_tiers_value() {
    local region="$1" value="" file range ext min max bounds
    local files=()
    file=$(overview_file "$region")
    [[ -f "$file" ]] && files+=("$file")
    [[ -f "$BASEMAP_DIR/world.sat-regional.pmtiles" ]] && files+=("$BASEMAP_DIR/world.sat-regional.pmtiles")
    for file in "$BASEMAP_DIR"/*.sat-regional.pmtiles "$BASEMAP_DIR"/*.sat-detailed*.pmtiles; do
        [[ -f "$file" && "$file" != "$BASEMAP_DIR/world.sat-regional.pmtiles" ]] && files+=("$file")
    done
    [[ ${#files[@]} -gt 0 ]] || return 0
    local credits=() i=0
    mapfile -t credits < <(python3 -I "$REPO_ROOT/scripts/satellite.py" attribution "${files[@]}")
    for file in "${files[@]}"; do
        # Each file is shown over the zooms its header says it has; the tier's usual
        # ones only if it can't be read (scripts/satimagery/sources.py TIERS).
        case "$file" in
            *.sat-overview.pmtiles) min=0; max=8; ext=jpg ;;
            *.sat-regional.pmtiles) min=$REGIONAL_FIRST_ZOOM; max=12; ext=webp ;;
            *) min=12; max=16; ext=jpg ;;
        esac
        range="$(pmtiles_minzoom "$file" "$min") $(pmtiles_maxzoom "$file" "$max")"
        # Sentinel-2 from REGIONAL_FIRST_ZOOM at the earliest, whatever its file holds
        # (files made before could start at 5).
        if [[ "$file" == *.sat-regional.pmtiles && "${range%% *}" -lt "$REGIONAL_FIRST_ZOOM" ]]; then
            range="$REGIONAL_FIRST_ZOOM ${range#* }"
        fi
        ext=$(pmtiles_ext "$file" "$ext")
        bounds=$(pmtiles_bounds "$file")
        value+="${value:+;}http://localhost:$BASEMAP_PORT/$(basename "$file" .pmtiles)/{z}/{x}/{y}.$ext $range${bounds:+ $bounds}|${credits[i]:-}"
        i=$((i + 1))
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

# choose_satellite REGION — the questions: the offline maps menu (satellite.py
# maps), queuing; with presets, the older plan (satellite.py choose). Presets: SATELLITE_MODE (none, keep,
# overview, regional, regional13), SATELLITE_DETAILED (15-17, none),
# SATELLITE_AREA_ID (an area other than REGION: a Geofabrik id, or world),
# SATELLITE_ZOOM (Sentinel-2's last zoom), SATELLITE_SOURCES (aerial photo sources).
choose_satellite() {
    local region="$1" args=()
    SATELLITE_PLAN="$BASEMAP_DIR/.satellite-plan.json"
    rm -f "$SATELLITE_PLAN"
    if [[ -z "$SATELLITE_MODE" && "$ASSUME_YES" == 1 ]]; then
        SATELLITE_MODE=none
        has_satellite "$region" && SATELLITE_MODE=keep
    fi
    [[ "$SATELLITE_MODE" == keep ]] && return 0
    mkdir -p "$BASEMAP_DIR"
    args=(--plan "$SATELLITE_PLAN" --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX"
          --region "$region" --region-name "${REGION_NAME:-$region}")
    if [[ -n "$SATELLITE_MODE" ]]; then
        args+=(--mode "$SATELLITE_MODE" --detailed "${SATELLITE_DETAILED:-none}")
        [[ -n "${SATELLITE_AREA_ID:-}" ]] && args+=(--area "$SATELLITE_AREA_ID")
        [[ -n "${SATELLITE_ZOOM:-}" ]] && args+=(--zoom "$SATELLITE_ZOOM")
        [[ -n "${SATELLITE_SOURCES:-}" ]] && args+=(--sources "$SATELLITE_SOURCES")
        [[ "$SATELLITE_MODE" == none ]] && return 0
    else
        # The offline maps menu (satellite.py maps), queuing what's chosen: it's
        # downloaded after the build (download_satellite), every question first.
        section "Offline maps (satellite imagery, aerial photos)"
        python3 -I "$REPO_ROOT/scripts/satellite.py" maps --queue-only \
            --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX" --region "$region" \
            || warn "The offline maps menu stopped; nothing more is downloaded."
        SATELLITE_MENU=1
        return 0
    fi
    python3 -I "$REPO_ROOT/scripts/satellite.py" choose "${args[@]}" \
        || { warn "Couldn't work out the satellite imagery; skipping it."; rm -f "$SATELLITE_PLAN"; }
}

# run_maps_queue — what the offline maps menu queued (satellite.py maps
# --queued: one after the other, under its lock).
run_maps_queue() {
    [[ -f "$BASEMAP_DIR/queue.json" ]] || return 0
    section "Downloading the offline maps chosen..."
    python3 -I "$REPO_ROOT/scripts/satellite.py" maps --queued --yes \
        --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX" \
        || warn "What was downloaded is kept. To go on: bash scripts/satellite.sh, then Resume."
}

# download_satellite REGION — download what choose_satellite planned, all at once
# (each from its own server: NASA, ESA, a country's aerial photos), then point the
# frontend at it.
download_satellite() {
    local region="$1" line i lost=0 stopped=0
    SAT_STEPS=()
    if [[ -f "${SATELLITE_PLAN:-}" ]]; then
        while IFS= read -r line; do SAT_STEPS+=("$line"); done < <(
            python3 -I "$REPO_ROOT/scripts/satellite.py" steps --plan "$SATELLITE_PLAN" \
                --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX")
    fi
    if [[ ${#SAT_STEPS[@]} -gt 0 ]]; then
        section "Downloading satellite imagery (${#SAT_STEPS[@]} at once)..."
        SAT_PMTILES_IMAGE=$(basemap_image)
        SAT_OK=1
        run_parallel "${#SAT_STEPS[@]}" satellite_step_label satellite_step || SAT_OK=0
        for i in "${!JOB_STATUS[@]}"; do
            [[ "${JOB_STATUS[i]}" == "$CONNECTION_LOST" ]] && lost=1
            [[ "${JOB_STATUS[i]}" == "$SERVER_STOPPED" ]] && stopped=1
        done
        [[ "$lost" == 0 ]] || warn "No internet connection: some satellite downloads stopped."
        [[ "$stopped" == 0 ]] || warn "A server stopped answering this computer (see above): try it again in a few hours."
        [[ "$SAT_OK" == 1 ]] || warn "What was downloaded is kept. Run it again to go on: bash scripts/satellite.sh"
        rm -f "$SATELLITE_PLAN"
    fi
    if [[ "${SATELLITE_MENU:-0}" == 1 ]]; then
        run_maps_queue
    fi
    catch_up_lower_zooms
    select_satellite "$region"
}

# catch_up_lower_zooms — imagery files made when their tier started at a higher
# zoom (Sentinel-2 at 9, aerial photos at 14) get their lower zooms (satellite.py
# decides: lower-zooms --list-needed), without downloading anything: lower-zooms
# reads their tiles back from the imagery server. Then the server is restarted (it
# keeps each file's index until then).
catch_up_lower_zooms() {
    local file files=()
    mapfile -t files < <(python3 -I "$REPO_ROOT/scripts/satellite.py" lower-zooms --list-needed \
        --basemap-dir "$BASEMAP_DIR" 2>/dev/null)
    [[ ${#files[@]} -gt 0 ]] || return 0
    docker compose --progress quiet up -d basemap </dev/null
    for file in "${files[@]}"; do
        run_with_timer --progress --keep-going "${file/.sat-/ }: adding its lower zooms" \
            python3 -I "$REPO_ROOT/scripts/satellite.py" lower-zooms --file "$file" \
                --basemap-dir "$BASEMAP_DIR" --pmtiles-image "$(basemap_image)" \
            || warn "Adding its lower zooms failed; it shows from a higher zoom until then."
    done
    docker compose --progress quiet restart basemap </dev/null >/dev/null
    return 0
}

# A planned step (SAT_STEPS: label <tab> satellite.py's arguments): its label, and
# running it.
satellite_step_label() {
    local step
    IFS=$'\t' read -r -a step <<<"${SAT_STEPS[$1]}"
    echo "${step[0]}"
}

satellite_step() {
    local step
    IFS=$'\t' read -r -a step <<<"${SAT_STEPS[$1]}"
    python3 -I "$REPO_ROOT/scripts/satellite.py" "${step[@]:1}" --pmtiles-image "$SAT_PMTILES_IMAGE" </dev/null
}
