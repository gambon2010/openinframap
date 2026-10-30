# shellcheck shell=bash
# Geofabrik's regions: which contains which, their outlines.
# Sourced by common.sh.

# Whether Geofabrik region $1 is $2 or inside it, following the parents in
# Geofabrik's index (GEOFABRIK_INDEX, downloaded by build-region.sh).
region_in() {
    python3 -c 'import json, sys
index, region, wanted = sys.argv[1:]
parents = {f["properties"]["id"]: f["properties"].get("parent") for f in json.load(open(index))["features"]}
while region:
    if region == wanted:
        sys.exit(0)
    region = parents.get(region)
sys.exit(1)' "${GEOFABRIK_INDEX:-$OSM_DIR/geofabrik-index-v1.json}" "$1" "$2" 2>/dev/null
}

GEOFABRIK_INDEX="$OSM_DIR/geofabrik-index-v1.json"

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
