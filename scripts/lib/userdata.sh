# shellcheck shell=bash
# "My layers" (the userdata schema, made by the backend: web-
# backend/src/fork/userdata/) belong to this computer, not to a region: saved
# before the database is wiped and put back afterwards, by build-region.sh and
# import-db.sh.
# Sourced by common.sh.

USERDATA_DUMP="$DATA_DIR/userdata/userdata.dump"

# user_data_saves — how many times "My layers" were saved, plus the towers in the
# register of tower numbers (also in userdata); 0: nothing to keep.
user_data_saves() {
    local saves towers
    saves=$(db_query "SELECT CASE WHEN to_regclass('userdata.save') IS NULL THEN 0
                          ELSE (SELECT count(*) FROM userdata.save) END" || echo 0)
    towers=$(db_query "SELECT CASE WHEN to_regclass('userdata.tower_ref') IS NULL THEN 0
                          ELSE (SELECT count(*) FROM userdata.tower_ref) END" || echo 0)
    echo $(( ${saves:-0} + ${towers:-0} ))
}

save_user_data() {
    mkdir -p "$(dirname "$USERDATA_DUMP")"
    docker compose exec -T db pg_dump -U "$DB_USER" -Fc -n userdata "$DB_NAME" > "$USERDATA_DUMP.part" || return 1
    mv "$USERDATA_DUMP.part" "$USERDATA_DUMP"
}

# restore_user_data — put the saved layers back (replacing any from an import).
restore_user_data() {
    db_psql -c "DROP SCHEMA IF EXISTS userdata CASCADE; CREATE SCHEMA userdata;" || return 1
    docker compose exec -T db pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges \
        --exit-on-error -n userdata < "$USERDATA_DUMP"
}
