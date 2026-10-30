# shellcheck shell=bash
# The offline background map (data/basemap/<region>.pmtiles), served by the
# "basemap" service; PMTiles headers.
# Sourced by common.sh.

basemap_image() {
    docker compose config --format json </dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["basemap"]["image"])'
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

# The max zoom in a PMTiles v3 header (byte 101), or $2 if it can't be read.
# pmtiles_ext FILE DEFAULT — the extension its tiles are served with (png, jpg, webp).
pmtiles_ext() {
    python3 -c 'import sys
try:
    header = open(sys.argv[1], "rb").read(127)
    print({2: "png", 3: "jpg", 4: "webp", 5: "avif"}.get(header[99], sys.argv[2]) if header[:7] == b"PMTiles" else sys.argv[2])
except OSError:
    print(sys.argv[2])' "$1" "$2"
}

pmtiles_maxzoom() {
    python3 -c 'import sys
try:
    header = open(sys.argv[1], "rb").read(127)
    print(header[101] if header[:7] == b"PMTiles" else sys.argv[2])
except OSError:
    print(sys.argv[2])' "$1" "$2"
}

# Start the background-map server if any background map has been downloaded.
start_basemap_if_present() {
    if has_local_basemaps; then
        docker compose --progress quiet up -d basemap </dev/null
    fi
}
