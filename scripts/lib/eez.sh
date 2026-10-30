# shellcheck shell=bash
# Country boundaries (Marine Regions EEZ), for search and the stats pages.
# Sourced by common.sh.

# Make sure the marineregions.org EEZ zip is in data/, asking the user to
# download it (it's behind a free form) if needed. Returns 1 if they skip.
ensure_eez_zip() {
    if [[ ! -f "$EEZ_ZIP" && -f "$HOME/Downloads/$EEZ_NAME.zip" ]]; then
        info "Found $EEZ_NAME.zip in ~/Downloads — copying to data/."
        mkdir -p "$DATA_DIR"
        cp "$HOME/Downloads/$EEZ_NAME.zip" "$EEZ_ZIP"
    fi
    [[ -f "$EEZ_ZIP" ]] && return 0

    if [[ "$ASSUME_YES" == 1 ]]; then
        warn "EEZ boundaries not found at data/$EEZ_NAME.zip — they will be skipped."
        return 1
    fi

    info "Country boundaries (EEZ) come from marineregions.org. They're free, but the"
    info "site asks you to fill in a short form, so this one download is manual."
    info ""
    info "Without them the map still works, but search and the country stats pages don't."
    info ""
    info "  1. Open:  ${BOLD}$EEZ_DOWNLOAD_URL${RESET}"
    info "     (about the dataset: $EEZ_INFO_URL)"
    info "  2. Fill in the form and download ${BOLD}$EEZ_NAME.zip${RESET} (~19 MB)"
    info "  3. Leave it in ~/Downloads, or save it as: $EEZ_ZIP"
    info ""
    if command -v xdg-open &>/dev/null; then
        xdg-open "$EEZ_DOWNLOAD_URL" >/dev/null 2>&1 &
        info "(Trying to open the page in your browser now.)"
    elif command -v open &>/dev/null; then
        open "$EEZ_DOWNLOAD_URL"
        info "(Trying to open the page in your browser now.)"
    fi
    local answer
    while true; do
        read -r -p "    Press Enter once the download has finished, or type 'skip' to build without them: " answer || die "Aborted."
        if [[ "$answer" == skip ]]; then
            warn "Skipping EEZ boundaries. Search and area/stats pages won't work."
            return 1
        fi
        if [[ -f "$HOME/Downloads/$EEZ_NAME.zip" && ! -f "$EEZ_ZIP" ]]; then
            mkdir -p "$DATA_DIR"
            cp "$HOME/Downloads/$EEZ_NAME.zip" "$EEZ_ZIP"
        fi
        [[ -f "$EEZ_ZIP" ]] && return 0
        warn "Still can't find $EEZ_NAME.zip in ~/Downloads or data/."
    done
}

# Import $EEZ_ZIP into the countries schema (see ensure_eez_zip).
import_eez() {
    local eez_dir="$DATA_DIR/$EEZ_NAME"
    local shp
    shp=$(find "$eez_dir" -name "$EEZ_NAME.shp" 2>/dev/null | head -1 || true)
    if [[ -z "$shp" ]]; then
        info "Extracting $EEZ_NAME.zip..."
        mkdir -p "$eez_dir"
        unzip -qo "$EEZ_ZIP" -d "$eez_dir"
        shp=$(find "$eez_dir" -name "$EEZ_NAME.shp" | head -1)
        [[ -n "$shp" ]] || die "$EEZ_NAME.shp not found in the zip. Check it with: unzip -l $EEZ_ZIP"
    fi

    db_psql -c "CREATE SCHEMA IF NOT EXISTS countries;
                DROP TABLE IF EXISTS countries.country_eez CASCADE;"
    # shp2pgsql ships with the PostGIS image, so the host doesn't need it
    # (the alpine image is missing libintl, which it needs to run).
    local log
    log=$(mktemp)
    if ! docker compose --progress quiet run --rm --no-deps -T \
        -v "$eez_dir:/eez:ro,z" \
        --entrypoint sh db -c \
        "apk add --no-cache -q libintl >&2 && shp2pgsql -s 4326 -c '/eez/${shp#"$eez_dir"/}' countries.country_eez" \
        2>"$log" | db_psql >/dev/null; then
        cat "$log" >&2
        rm -f "$log"
        die "EEZ import failed (see above)."
    fi
    rm -f "$log"
    db_psql < "$REPO_ROOT/schema/eez.sql"
}
