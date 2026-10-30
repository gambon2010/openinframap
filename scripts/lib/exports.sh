# shellcheck shell=bash
# Ready-made exports in data/exports/ (export-db.sh, import-db.sh): their
# manifests, and exporting again when out of date.
# Sourced by common.sh.

# manifest_get FILE.json KEY — read one field of an export manifest.
manifest_get() {
    python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get(sys.argv[2], ""))' "$1" "$2"
}

# export_outdated — true when data/exports/ has an export of the database's region
# that doesn't match it any more (rebuilt, another schema, other extra data).
# "My layers" don't count: they're kept per computer (see save_user_data).
export_outdated() {
    local region manifest
    region=$(build_info region_id)
    [[ -n "$region" ]] || return 1
    manifest="$EXPORTS_DIR/$region.json"
    [[ -f "$manifest" && -f "$EXPORTS_DIR/$region.oimdb" ]] || return 1
    [[ "$(manifest_get "$manifest" built_at)" != "$(build_info built_at)" \
        || "$(manifest_get "$manifest" schema_hash)" != "$(build_info schema_hash)" \
        || "$(manifest_get "$manifest" extra_data)" != "$(extra_description)" ]]
}

# reexport_if_outdated — export the database again, without asking, when its
# ready-made export is out of date (the Docker images saved with it are kept).
# Interrupting it is safe: the old export stays until the new one is complete.
reexport_if_outdated() {
    export_outdated || return 0
    section "The ready-made export of $(build_info region_name) is out of date: exporting it again..."
    info "(Ctrl+C to skip; the old export is kept until the new one is complete.)"
    bash "$REPO_ROOT/scripts/export-db.sh" --yes --no-docker-images \
        || warn "Exporting failed; run it again with: bash scripts/export-db.sh"
}

# Manifests of the exports in data/exports/, one path per line.
list_exports() {
    local f
    for f in "$EXPORTS_DIR"/*.json; do
        [[ -f "$f" && -f "${f%.json}.oimdb" ]] && echo "$f"
    done
}
