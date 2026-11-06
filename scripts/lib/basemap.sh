# shellcheck shell=bash
# The offline background map (data/basemap/<region>.pmtiles), served by the
# "basemap" service; PMTiles headers.
# Sourced by common.sh.

# Offline background maps are cut from Protomaps' daily world build.
PROTOMAPS_BUILDS_URL="https://build-metadata.protomaps.dev/builds.json"
PROTOMAPS_BASE="https://build.protomaps.com"
# "Reduced detail": up to this zoom (streets and places, no buildings).
REDUCED_MAXZOOM=13

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

# pmtiles_header_byte FILE OFFSET DEFAULT — one byte of a PMTiles v3 header (99:
# the tile type, 100: min zoom, 101: max zoom), or DEFAULT if it can't be read.
pmtiles_header_byte() {
    python3 -c 'import sys
try:
    header = open(sys.argv[1], "rb").read(127)
    print(header[int(sys.argv[2])] if header[:7] == b"PMTiles" else sys.argv[3])
except OSError:
    print(sys.argv[3])' "$1" "$2" "$3"
}

# pmtiles_bounds FILE — what a PMTiles v3 file covers, "west,south,east,north" in
# degrees (its header), or nothing if it can't be read or doesn't say.
pmtiles_bounds() {
    python3 -c 'import struct, sys
try:
    header = open(sys.argv[1], "rb").read(127)
except OSError:
    sys.exit()
if header[:7] == b"PMTiles":
    bounds = struct.unpack_from("<4i", header, 102)
    if any(bounds):
        print(",".join(f"{v / 1e7:.5f}" for v in bounds))' "$1"
}

pmtiles_minzoom() { pmtiles_header_byte "$1" 100 "$2"; }
pmtiles_maxzoom() { pmtiles_header_byte "$1" 101 "$2"; }

# pmtiles_ext FILE DEFAULT — the extension its tiles are served with (png, jpg, webp).
pmtiles_ext() {
    case "$(pmtiles_header_byte "$1" 99 0)" in
        2) echo png ;;
        3) echo jpg ;;
        4) echo webp ;;
        5) echo avif ;;
        *) echo "$2" ;;
    esac
}

# --- Downloading a background map -------------------------------------------------

# pmtiles ARGS... — the pmtiles CLI from the basemap service's image, with
# data/basemap/ at /out.
pmtiles() {
    docker run --rm --user "$(id -u):$(id -g)" -v "$BASEMAP_DIR:/out:z" "$(basemap_image)" "$@"
}

# latest_protomaps_build — "KEY SIZE" of Protomaps' latest world build (nothing offline).
latest_protomaps_build() {
    download --quick "$PROTOMAPS_BUILDS_URL" \
        | python3 -c 'import json, sys; b = json.load(sys.stdin)[-1]; print(b["key"], b.get("size", 0))' 2>/dev/null
}

# basemap_size BUILD [MAXZOOM] AREA... — the size in bytes of the background map
# cut from BUILD for AREA (pmtiles options: --region=FILE or --bbox=...), up to
# MAXZOOM ("" = all). pmtiles says it as "archive size of 12.3 MB".
basemap_size() {
    local build="$1" maxzoom="$2" size
    shift 2
    size=$(pmtiles extract "$PROTOMAPS_BASE/$build" /out/.dry-run.pmtiles "$@" \
            ${maxzoom:+"--maxzoom=$maxzoom"} --dry-run 2>&1 \
        | sed -n 's/.*archive size of \([0-9.]*\) \([kMGT]*\)B.*/\1\2/p' | tail -1)
    numfmt --from=si "${size^^}" 2>/dev/null || echo 0
}

# download_basemap REGION BUILD DETAIL AREA... — cut the background map of REGION
# (DETAIL: full or reduced) from BUILD into data/basemap/REGION.pmtiles, with its
# manifest. The whole world (no AREA, full) is the build file itself, downloaded.
download_basemap() {
    local region="$1" build="$2" detail="$3"
    shift 3
    local partial="$BASEMAP_DIR/.$region.partial.pmtiles" status=0
    if [[ $# -eq 0 && "$detail" == full ]]; then
        download "$PROTOMAPS_BASE/$build" "$partial" || return
    else
        local args=("$@")
        [[ "$detail" == reduced ]] && args+=("--maxzoom=$REDUCED_MAXZOOM")
        rm -f "$partial"
        # pmtiles has no timeout of its own: stopped when its progress stops moving.
        safely "$PROTOMAPS_BASE" run_with_timer --progress --keep-going --stall "$NET_STALL_SECONDS" \
            "Cutting it out of Protomaps' world map" \
            pmtiles extract "$PROTOMAPS_BASE/$build" "/out/$(basename "$partial")" "${args[@]}" || return
    fi
    mv "$partial" "$BASEMAP_DIR/$region.pmtiles"
    json_write "$BASEMAP_DIR/$region.json" region_id="$region" build="$build" detail="$detail" \
        downloaded_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# --- Serving it --------------------------------------------------------------------

# Start the background-map server if any background map has been downloaded.
start_basemap_if_present() {
    if has_local_basemaps; then
        docker compose --progress quiet up -d basemap </dev/null
    fi
}
