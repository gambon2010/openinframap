# shellcheck shell=bash
# Extra data (scripts/extra_data.py): what is there, kept across a rebuild of
# its region.
# Sourced by common.sh.

# Fingerprint of everything that decides what the database looks like. An
# export built with a different fingerprint may not match this checkout.
# How many extra-data features the database holds (0 if none or no extra schema).
extra_feature_count() {
    local n
    n=$(db_query "SELECT CASE WHEN to_regclass('extra.source') IS NULL THEN 0
                         ELSE (SELECT coalesce(sum(features), 0) FROM extra.source) END")
    echo "${n:-0}"
}

# One line describing the extra data in the database, e.g. for export manifests.
extra_description() {
    db_query "SELECT CASE WHEN to_regclass('extra.source') IS NOT NULL THEN
        (SELECT string_agg(name || ' (' || coalesce(to_char(features, 'FM999,999,999') || ' features', 'incomplete')
                           || ')', '; ' ORDER BY source) FROM extra.source) END"
}

# save_extra_data REGION — save the database's extra schema (it was imported
# for REGION) so a rebuild of that region can put it back without downloading it
# again (all of France takes 3-4 hours).
save_extra_data() {
    local region="$1" file="$EXTRA_DIR/$1.extra.dump" description
    mkdir -p "$EXTRA_DIR"
    description=$(extra_description)
    docker compose exec -T db pg_dump -U "$DB_USER" -Fc -Z zstd:3 -n extra "$DB_NAME" > "$file.part" || return 1
    mv "$file.part" "$file"
    python3 -c 'import json, sys
json.dump({"region_id": sys.argv[2], "description": sys.argv[3], "saved_at": sys.argv[4]},
          open(sys.argv[1], "w"), indent=2)' \
        "$EXTRA_DIR/$region.extra.json" "$region" "$description" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}

# restore_extra_data REGION — put saved extra data back into a fresh database,
# before schema/extra.sql runs (which then only adds what's new).
restore_extra_data() {
    local file="$EXTRA_DIR/$1.extra.dump"
    db_psql -c "CREATE SCHEMA IF NOT EXISTS extra;" || return 1
    # -n extra restores the schema's objects but not the schema itself (made above).
    docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
        --exit-on-error -n extra < "$file"
}
