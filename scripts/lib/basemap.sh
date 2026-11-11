# shellcheck shell=bash
# The offline background maps (data/basemap/<area>.pmtiles, downloaded by
# scripts/satellite.py maps, served by the backend's /background); PMTiles headers.
# Sourced by common.sh.

# The pmtiles CLI's image (the satellite service's), for the scripts' own uses.
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

# The background map: every area downloaded, served by the backend (/background,
# web-backend/src/fork/background/: each tile from the first file that has it),
# which is the frontend's default. A VITE_BASEMAP_URL left from before (the old
# one-file server on 8090, or the backend's own address) is removed; one pointing
# elsewhere is someone's choice and stays. The argument is no longer needed.
select_basemap() {
    local current areas
    ensure_web_env
    # No longer read (the online background map is gone).
    grep -q '^VITE_TILE_BASE_URL=' "$WEB_ENV" && set_env_line "$WEB_ENV" VITE_TILE_BASE_URL ""
    current=$(grep -E '^VITE_BASEMAP_URL=' "$WEB_ENV" | cut -d= -f2- || true)
    if [[ "$current" == "http://localhost:$SATELLITE_PORT/"* || "$current" == "http://localhost:$BACKEND_PORT/background/"* ]]; then
        set_env_line "$WEB_ENV" VITE_BASEMAP_URL ""
        BASEMAP_CHANGED=1
    fi
    areas=$(background_areas | paste -sd, - | sed 's/,/, /g')
    if [[ -n "$areas" ]]; then
        ok "Offline background map: $areas"
    else
        warn "No background map downloaded: the map's background is empty (bash scripts/satellite.sh: Add, Background map)."
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
