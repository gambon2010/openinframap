# shellcheck shell=bash
# The offline background maps (data/basemap/<area>.pmtiles, downloaded by
# scripts/satellite.py maps, served by the backend's /background); PMTiles headers.
# Sourced by common.sh.

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
# which is the frontend's default: nothing to set. Says which areas there are, or
# that the background is empty.
select_basemap() {
    local areas
    areas=$(background_areas | paste -sd, - | sed 's/,/, /g')
    if [[ -n "$areas" ]]; then
        ok "Offline background map: $areas"
    else
        warn "No background map downloaded: the map's background is empty (bash scripts/satellite.sh: Add, Background map)."
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
