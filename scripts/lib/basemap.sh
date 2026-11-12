# shellcheck shell=bash
# The offline background maps (data/basemap/<area>.pmtiles, downloaded by
# scripts/satellite.py maps, served by the backend's /background).
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
