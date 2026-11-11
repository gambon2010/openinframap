# shellcheck shell=bash
# The offline background map (data/basemap/<region>.pmtiles), served by the
# backend; PMTiles headers.
# Sourced by common.sh.

# Offline background maps are cut from Protomaps' daily world build.
PROTOMAPS_BUILDS_URL="https://build-metadata.protomaps.dev/builds.json"
PROTOMAPS_BASE="https://build.protomaps.com"
# "Reduced detail": up to this zoom (streets and places, no buildings); the same
# as satimagery/sources/protomaps.py (a test checks).
REDUCED_MAXZOOM=13

pmtiles_image() {
    docker compose config --format json </dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["satellite"]["image"])'
}

# The background maps downloaded: data/basemap/<area>.pmtiles (not satellite
# imagery, <area>.sat-*.pmtiles), their areas, one per line.
background_areas() {
    local file name
    for file in "$BASEMAP_DIR"/*.pmtiles; do
        [[ -f "$file" ]] || continue
        name=$(basename "$file" .pmtiles)
        [[ "$name" == *.* ]] || echo "$name"
    done
}

# Point the frontend at the background map: every area downloaded, served by the
# backend (/background, web-backend/src/fork/background/: each tile from the
# first file that has it). The argument (the region built) is no longer needed.
select_basemap() {
    local current want="" areas
    ensure_web_env
    current=$(grep -E '^VITE_BASEMAP_URL=' "$WEB_ENV" | cut -d= -f2- || true)
    areas=$(background_areas | paste -sd, - | sed 's/,/, /g')
    [[ -n "$areas" ]] && want="http://localhost:$BACKEND_PORT/background/{z}/{x}/{y}.mvt"
    if [[ "$current" != "$want" ]]; then
        set_env_line "$WEB_ENV" VITE_BASEMAP_URL "$want"
        BASEMAP_CHANGED=1
    fi
    if [[ -n "$areas" ]]; then
        ok "Offline background map: $areas"
    else
        info "No background map downloaded yet (bash scripts/satellite.sh: Add, Background map)."
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
    docker run --rm --user "$(id -u):$(id -g)" -v "$BASEMAP_DIR:/out:z" "$(pmtiles_image)" "$@"
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
