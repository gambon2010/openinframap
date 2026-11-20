# shellcheck shell=bash
# Offline maps for the scripts (scripts/offline-maps.py maps; docs/plans/offline-maps.md):
# build-region.sh opens the menu to queue downloads (choose_offline_maps) and runs the
# queue after the build (download_offline_maps); select_satellite tells the frontend
# which imagery files there are.

# Whether any satellite imagery is downloaded (data/offline-maps/<area>.sat-*.pmtiles).
has_satellite() {
    compgen -G "$OFFLINE_MAPS_DIR/*.sat-*.pmtiles" >/dev/null
}

# Start the satellite imagery server (the "satellite" service) if there's any.
start_satellite_if_present() {
    if has_satellite; then
        up_services satellite
    fi
}

# "world overview, france regional, IGN photos of 2 départements (3.4 GB)": the
# imagery there is, and its total size.
satellite_summary() {
    scripts_python "$REPO_ROOT/scripts/offline-maps.py" summary --maps-dir "$OFFLINE_MAPS_DIR"
}

# The imagery as the frontend reads it (VITE_SATELLITE_TIERS; empty: none):
# every imagery file, with its zooms, bounds and credit
# (scripts/offline_maps/inventory.py imagery_tiers).
satellite_tiers_value() {
    scripts_python "$REPO_ROOT/scripts/offline-maps.py" tiers --maps-dir "$OFFLINE_MAPS_DIR" \
        --server "http://localhost:$SATELLITE_PORT"
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
        up_services satellite
        ok "Satellite imagery: $(satellite_summary). Turn it on in Settings → Background."
    fi
    if [[ "${BASEMAP_CHANGED:-0}" == 1 ]] && port_in_use "$FRONTEND_PORT"; then
        warn "Restart the frontend to use the new imagery (Ctrl+C in its window, then bash scripts/start.sh)."
    fi
}

# choose_offline_maps REGION — the offline maps menu (offline-maps.py maps), queuing
# what's chosen: it's downloaded after the build (download_offline_maps), every
# question first. Without questions (--yes): MAPS_SOURCES, the sources to queue
# for the region (build-region.sh --maps "sentinel2 fr_ign"), else nothing.
choose_offline_maps() {
    local region="$1" source menu
    menu=(scripts_python "$REPO_ROOT/scripts/offline-maps.py" maps --queue-only
        --maps-dir "$OFFLINE_MAPS_DIR" --index "$GEOFABRIK_INDEX" --region "$region")
    mkdir -p "$OFFLINE_MAPS_DIR"
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

# run_maps_queue — what the offline maps menu queued (offline-maps.py maps
# --queued: one after the other, under its lock).
run_maps_queue() {
    [[ -f "$OFFLINE_MAPS_DIR/queue.json" ]] || return 0
    section "Downloading the offline maps chosen..."
    scripts_python "$REPO_ROOT/scripts/offline-maps.py" maps --queued --yes \
        --maps-dir "$OFFLINE_MAPS_DIR" --index "$GEOFABRIK_INDEX" \
        || warn "What was downloaded is kept. To go on: bash scripts/offline-maps.sh, then Resume."
}

# download_offline_maps — download what was queued (choose_offline_maps), then point
# the frontend at the imagery there.
download_offline_maps() {
    if [[ "${SATELLITE_MENU:-0}" == 1 ]]; then
        run_maps_queue
    fi
    select_satellite
}
