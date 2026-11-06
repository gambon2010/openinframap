# shellcheck shell=bash
# Starting the app: the frontend in a terminal window, the browser, web/.env,
# the Wikidata image cache.
# Sourced by common.sh.

# Offer to fill the Wikidata cache used by the info popups.
offer_image_cache() {
    local counts missing_json missing_images minutes choice
    if ! command -v uv &>/dev/null; then
        info "Skipped: filling the cache needs uv (https://docs.astral.sh/uv/). Without it,"
        info "popups fetch their details from Wikidata online."
        return
    fi
    if ! counts=$(uv run -q "$REPO_ROOT/scripts/fetch_images.py" --count 2>/dev/null | tail -1); then
        warn "Couldn't check the Wikidata cache. Fill it later with: uv run scripts/fetch_images.py"
        return
    fi
    read -r missing_json missing_images <<< "$counts"
    if [[ ! "$missing_json" =~ ^[0-9]+$ || ! "$missing_images" =~ ^[0-9]+$ ]]; then
        warn "Couldn't check the Wikidata cache. Fill it later with: uv run scripts/fetch_images.py"
        return
    fi
    if [[ "$missing_json" -eq 0 && "$missing_images" -eq 0 ]]; then
        ok "Wikidata cache is up to date."
        return
    fi
    # fetch_images.py downloads at most one image per second; metadata is batched.
    # Not every feature has a photo, so this is an upper bound.
    minutes=$(( (missing_images + 59) / 60 ))
    info "Info popups can show photos and details from Wikidata. In your region,"
    info "$missing_json features have no cached text and $missing_images have no cached photo,"
    info "so their popups need the internet for now."
    echo ""
    info "  1) Text and images  ${YELLOW}— slow: up to ~$minutes min (1 image per second, Wikimedia's limit)${RESET}"
    info "  2) Text only        — about 10 seconds; popups work offline, without photos"
    info "  3) Skip for now"
    echo ""
    choice=$(choose_number 3 3)
    case "$choice" in
        1) uv run "$REPO_ROOT/scripts/fetch_images.py" || warn "Caching stopped before the end." ;;
        2) uv run "$REPO_ROOT/scripts/fetch_images.py" --json-only || warn "Caching stopped before the end." ;;
        *) info "Skipped." ;;
    esac
    [[ "$choice" == 1 ]] || {
        info "To cache them later (safe to stop and re-run; cached items are skipped):"
        info "  uv run scripts/fetch_images.py              # text and images (slow)"
        info "  uv run scripts/fetch_images.py --json-only  # text only (fast)"
    }
}

# open_in_terminal "Title" "command" — run a command in a new terminal window
# that stays open afterwards. Returns 1 if no supported terminal is found.
open_in_terminal() {
    # The new window doesn't inherit this environment, so hand over PATH: it
    # may only find uv/node through the user's shell config (pyenv, nvm, ...).
    local title="$1" cmd
    cmd="export PATH=$(printf %q "$PATH"); $2; echo; echo '[$1 stopped — you can close this window]'; exec bash"
    if [[ "$(uname)" == Darwin ]]; then
        osascript -e "tell application \"Terminal\" to do script \"${cmd//\"/\\\"}\"" >/dev/null
        return
    fi
    [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]] || return 1
    if command -v ptyxis &>/dev/null; then
        ptyxis --new-window -- bash -c "$cmd" &>/dev/null &
    elif command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="$title" -- bash -c "$cmd" &>/dev/null
    elif command -v konsole &>/dev/null; then
        konsole -p tabtitle="$title" -e bash -c "$cmd" &>/dev/null &
    elif command -v xfce4-terminal &>/dev/null; then
        xfce4-terminal --title="$title" -x bash -c "$cmd" &>/dev/null &
    elif command -v kitty &>/dev/null; then
        kitty --title "$title" bash -c "$cmd" &>/dev/null &
    elif command -v alacritty &>/dev/null; then
        alacritty --title "$title" -e bash -c "$cmd" &>/dev/null &
    elif command -v x-terminal-emulator &>/dev/null; then
        x-terminal-emulator -e bash -c "$cmd" &>/dev/null &
    elif command -v xterm &>/dev/null; then
        xterm -T "$title" -e bash -c "$cmd" &>/dev/null &
    else
        return 1
    fi
}

# True if something answers HTTP on localhost:$1.
port_in_use() {
    curl -s -o /dev/null --max-time 2 "http://localhost:$1/"
}

# The app is opened through the gate (gate/nginx.conf), which asks for a login,
# over https with its own certificate (the browser warns once);
# the frontend dev server itself is FRONTEND_PORT.
GATE_PORT=8800
APP_URL="https://localhost:$GATE_PORT"

BACKEND_PORT=8001

FRONTEND_PORT=5173

# Start Compose services, rebuilding their images first so code changes are
# picked up (fast when nothing changed). Offline the build fails, so fall back
# to the existing images (e.g. loaded from data/exports/docker-images.tar.gz).
up_services() {
    docker compose --progress quiet up -d --build "$@" </dev/null 2>/dev/null \
        || docker compose --progress quiet up -d "$@" </dev/null
}

open_browser() {
    if command -v xdg-open &>/dev/null; then
        xdg-open "$1" >/dev/null 2>&1 &
    elif command -v open &>/dev/null; then
        open "$1"
    fi
}

# Start whichever of the backend (Docker) and frontend (a new terminal
# window) isn't running yet, then open the map in the browser once it answers.
# Returns 1 if the frontend window couldn't be opened (print_manual_start then helps).
start_app() {
    # Only run npm install when packages changed, so the app also starts offline.
    local frontend_cmd="cd $(printf %q "$REPO_ROOT/web") && { [ node_modules/.package-lock.json -nt package-lock.json ] || npm install; } && npm start"
    if port_in_use "$BACKEND_PORT"; then
        ok "Backend already running."
    else
        # Create the cache folders first, or Docker creates them owned by root.
        mkdir -p "$DATA_DIR/images" "$DATA_DIR/wikidata_json"
        up_services backend
        ok "Backend started (Docker). Its log: docker compose logs -f backend"
    fi
    # The gate: the one way in, asking for a login (docs/plans/sync.md).
    if port_in_use "$GATE_PORT"; then
        ok "Gate already running."
    else
        # Where it keeps its HTTPS certificate (made on its first start); made here, or
        # Docker makes it owned by root.
        mkdir -p "$DATA_DIR/gate"
        up_services gate
        ok "Gate started: $APP_URL (log in there; the first time, it makes the admin account)."
        info "Its certificate is its own: the browser warns once (\"Advanced\" → \"Proceed\")."
    fi
    if port_in_use "$FRONTEND_PORT"; then
        ok "Frontend already running."
    else
        open_in_terminal "OpenInfraMap frontend" "$frontend_cmd" || return 1
        ok "Frontend started in a new window."
    fi

    # npm install can take a while the first time.
    local waited=0
    while ! port_in_use "$FRONTEND_PORT" && [[ "$waited" -lt 180 ]]; do
        [[ -t 1 ]] && printf "\r    Waiting for the map to come up... %ds " "$waited"
        sleep 2
        waited=$((waited + 2))
    done
    [[ -t 1 ]] && printf "\r\e[K"
    if port_in_use "$FRONTEND_PORT"; then
        ok "Opening the map in your browser: $APP_URL"
        open_browser "$APP_URL"
    else
        warn "The frontend hasn't answered yet — check its window, then open $APP_URL"
    fi
    info "To stop the app, press Ctrl+C in the frontend window (or close it),"
    info "then run: docker compose stop"
}

print_manual_start() {
    echo "Start the app:"
    echo ""
    echo "  Backend and the gate (Docker):"
    echo "    docker compose up -d backend gate"
    echo ""
    echo "  Frontend (in a terminal you keep open):"
    echo "    cd web && npm install && npm start"
    echo ""
    echo "  Then open: $APP_URL"
}

# Create web/.env with the local-stack defaults if it doesn't exist yet.
ensure_web_env() {
    [[ -f "$WEB_ENV" ]] && return
    cat > "$WEB_ENV" <<'ENV'
VITE_TILE_BASE_URL=https://openinframap.org
VITE_TEGOLA_URL=http://localhost:7800
VITE_BACKEND_BASE_URL=http://localhost:8001
# Background map: openinframap.org unless VITE_BASEMAP_URL is set. build-region.sh
# sets it when you download a background map for offline use; you can also point
# it at your own Protomaps-schema tile server (full {z}/{x}/{y} URL template):
# VITE_BASEMAP_URL=http://localhost:8080/region/{z}/{x}/{y}.mvt
# Optional Photon server for street-address search (not set up by the scripts):
# VITE_PHOTON_URL=http://localhost:2322
ENV
}

# set_env_line FILE KEY VALUE — set KEY=VALUE, replacing an existing KEY line.
# An empty VALUE removes the line.
set_env_line() {
    local file="$1" key="$2" value="$3"
    touch "$file"
    grep -v "^$key=" "$file" > "$file.tmp" || true
    [[ -n "$value" ]] && echo "$key=$value" >> "$file.tmp"
    mv "$file.tmp" "$file"
}
