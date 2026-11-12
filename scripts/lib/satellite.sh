# shellcheck shell=bash
# Offline maps for the scripts (scripts/satellite.py maps; docs/plans/offline-maps.md):
# build-region.sh opens the menu to queue downloads (choose_satellite) and runs the
# queue after the build (download_satellite); select_satellite tells the frontend
# which imagery files there are.

# Sentinel-2's first zoom, for every area (scripts/satimagery/sources/sentinel2.py:
# the same number, checked by a test).
REGIONAL_FIRST_ZOOM=7

# Whether any satellite imagery is downloaded (data/basemap/<area>.sat-*.pmtiles).
has_satellite() {
    compgen -G "$BASEMAP_DIR/*.sat-*.pmtiles" >/dev/null
}

# Start the satellite imagery server (the "satellite" service) if there's any.
start_satellite_if_present() {
    if has_satellite; then
        docker compose --progress quiet up -d satellite </dev/null
    fi
}

# "world overview, france regional, IGN photos of 2 départements (12 MB)": the
# imagery there is, and its total size.
satellite_summary() {
    local value file total=0 names=() departements=0
    value=$(satellite_tiers_value)
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
# is shown, whatever area it's of: Blue Marble (the world), then Sentinel-2 (the
# world's first, then each area's), then the aerial photos.
satellite_tiers_value() {
    local value="" file range ext min max bounds
    local files=()
    file="$BASEMAP_DIR/world.sat-overview.pmtiles"
    [[ -f "$file" ]] && files+=("$file")
    [[ -f "$BASEMAP_DIR/world.sat-regional.pmtiles" ]] && files+=("$BASEMAP_DIR/world.sat-regional.pmtiles")
    for file in "$BASEMAP_DIR"/*.sat-regional.pmtiles "$BASEMAP_DIR"/*.sat-detailed*.pmtiles; do
        [[ -f "$file" && "$file" != "$BASEMAP_DIR/world.sat-regional.pmtiles" ]] && files+=("$file")
    done
    [[ ${#files[@]} -gt 0 ]] || return 0
    local credits=() i=0
    mapfile -t credits < <(python3 -I "$REPO_ROOT/scripts/satellite.py" attribution "${files[@]}")
    for file in "${files[@]}"; do
        # Each file is shown over the zooms its header says it has; its kind's usual
        # ones only if it can't be read.
        case "$file" in
            *.sat-overview.pmtiles) min=0; max=8; ext=jpg ;;
            *.sat-regional.pmtiles) min=$REGIONAL_FIRST_ZOOM; max=12; ext=webp ;;
            *) min=12; max=16; ext=jpg ;;
        esac
        range="$(pmtiles_minzoom "$file" "$min") $(pmtiles_maxzoom "$file" "$max")"
        # Sentinel-2 from REGIONAL_FIRST_ZOOM at the earliest, whatever its file holds:
        # further out, Blue Marble is what's shown.
        if [[ "$file" == *.sat-regional.pmtiles && "${range%% *}" -lt "$REGIONAL_FIRST_ZOOM" ]]; then
            range="$REGIONAL_FIRST_ZOOM ${range#* }"
        fi
        ext=$(pmtiles_ext "$file" "$ext")
        bounds=$(pmtiles_bounds "$file")
        value+="${value:+;}http://localhost:$SATELLITE_PORT/$(basename "$file" .pmtiles)/{z}/{x}/{y}.$ext $range${bounds:+ $bounds}|${credits[i]:-}"
        i=$((i + 1))
    done
    echo "$value"
}

# Point the frontend at the satellite imagery there is (or drop the setting if
# there's none), and start the server that serves it.
select_satellite() {
    local current value
    ensure_web_env
    current=$(grep -E '^VITE_SATELLITE_TIERS=' "$WEB_ENV" | cut -d= -f2- || true)
    value=$(satellite_tiers_value)
    if [[ "$current" != "$value" ]]; then
        set_env_line "$WEB_ENV" VITE_SATELLITE_TIERS "$value"
        BASEMAP_CHANGED=1
    fi
    if [[ -n "$value" ]]; then
        docker compose --progress quiet up -d satellite </dev/null
        ok "Satellite imagery: $(satellite_summary). Turn it on in Settings → Background."
    fi
    if [[ "${BASEMAP_CHANGED:-0}" == 1 ]] && port_in_use "$FRONTEND_PORT"; then
        warn "Restart the frontend to use the new imagery (Ctrl+C in its window, then bash scripts/start.sh)."
    fi
}

# choose_satellite REGION — the offline maps menu (satellite.py maps), queuing
# what's chosen: it's downloaded after the build (download_satellite), every
# question first. Without questions (--yes): MAPS_SOURCES, the sources to queue
# for the region (build-region.sh --maps "sentinel2 fr_ign"), else nothing.
choose_satellite() {
    local region="$1" source menu
    menu=(python3 -I "$REPO_ROOT/scripts/satellite.py" maps --queue-only
        --basemap-dir "$BASEMAP_DIR" --index "$GEOFABRIK_INDEX" --region "$region")
    mkdir -p "$BASEMAP_DIR"
    if [[ -n "${MAPS_SOURCES:-}" ]]; then
        for source in $MAPS_SOURCES; do
            "${menu[@]}" --yes --source "$source" --area "$region" \
                || warn "Couldn't plan $source; the build goes on without it."
        done
        SATELLITE_MENU=1
    elif [[ "$ASSUME_YES" != 1 ]]; then
        section "Offline maps (satellite imagery, aerial photos, background maps)"
        "${menu[@]}" || warn "The offline maps menu stopped; nothing more is downloaded."
        SATELLITE_MENU=1
    fi
    return 0
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

# download_satellite — download what was queued (choose_satellite), then point
# the frontend at the imagery there.
download_satellite() {
    if [[ "${SATELLITE_MENU:-0}" == 1 ]]; then
        run_maps_queue
    fi
    select_satellite
}
