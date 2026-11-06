# shellcheck shell=bash
# Geofabrik's regions: its index (names, download links, outlines), and the
# extracts already downloaded to data/osm/.
# Sourced by common.sh.

# Full index: includes each region's outline, used to cut its background map.
GEOFABRIK_INDEX_URL="https://download.geofabrik.de/index-v1.json"
GEOFABRIK_INDEX="$OSM_DIR/geofabrik-index-v1.json"
# The whole world isn't a Geofabrik region; it comes from openstreetmap.org (weekly).
PLANET_ID=planet
PLANET_URL="https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf"

# fetch_geofabrik_index — the index in data/osm/, refreshed once a day; offline,
# the copy there (false if there's none).
fetch_geofabrik_index() {
    mkdir -p "$OSM_DIR"
    if [[ -z "$(find "$GEOFABRIK_INDEX" -mmin -1440 2>/dev/null)" ]]; then
        download --quick "$GEOFABRIK_INDEX_URL" "$GEOFABRIK_INDEX.tmp" \
            && mv "$GEOFABRIK_INDEX.tmp" "$GEOFABRIK_INDEX" \
            || rm -f "$GEOFABRIK_INDEX.tmp"
    fi
    [[ -f "$GEOFABRIK_INDEX" ]]
}

# geofabrik_query lookup ID  → "name<TAB>pbf url" (nothing if unknown)
# geofabrik_query search TEXT → "id<TAB>name<TAB>parent name" per match
geofabrik_query() {
    python3 - "$GEOFABRIK_INDEX" "$1" "$2" "$PLANET_URL" <<'PY'
import json, sys
index, mode, term, planet_url = sys.argv[1], sys.argv[2], sys.argv[3].lower(), sys.argv[4]
regions = {f["properties"]["id"]: f["properties"] for f in json.load(open(index))["features"]}
regions["planet"] = {"id": "planet", "name": "Whole world (planet)", "urls": {"pbf": planet_url}}
if mode == "lookup":
    r = regions.get(term)
    if r:
        print(f'{r["name"]}\t{r["urls"]["pbf"]}')
else:
    hits = [r for r in regions.values() if term in r["id"].lower() or term in r["name"].lower()]
    hits.sort(key=lambda r: (r["name"].lower() != term, r["name"]))
    for r in hits[:20]:
        parent = regions.get(r.get("parent", ""), {}).get("name", "")
        print(f'{r["id"]}\t{r["name"]}\t{parent}')
PY
}

# Write region $1's outline from the Geofabrik index to file $2 (GeoJSON).
geofabrik_outline() {
    python3 -c 'import json, sys
index, region, out = sys.argv[1:]
for feature in json.load(open(index))["features"]:
    if feature["properties"]["id"] == region and feature.get("geometry"):
        json.dump(feature["geometry"], open(out, "w"))
        sys.exit(0)
sys.exit(1)' "$GEOFABRIK_INDEX" "$1" "$2"
}

# The extract of region $1 in data/osm/ (downloaded, or to download to).
extract_file() { echo "$OSM_DIR/$1-latest.osm.pbf"; }

# Ids of regions already downloaded to data/osm/.
downloaded_regions() {
    local f
    for f in "$OSM_DIR"/*-latest.osm.pbf; do
        [[ -f "$f" ]] && basename "$f" -latest.osm.pbf
    done
}

# file_date FILE — its date, 2026-11-06.
file_date() {
    date -r "$1" '+%Y-%m-%d'
}
