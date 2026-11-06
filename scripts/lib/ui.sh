# shellcheck shell=bash
# Talking to the user: sections, messages, questions, timed steps, sizes.
# Sourced by common.sh.

section() { CURRENT_STEP="$*"; echo ""; echo "${BOLD}==> $*${RESET}"; }

info()    { echo "    $*"; }
ok()      { echo "    ${GREEN}✓${RESET} $*"; }
warn()    { echo "    ${YELLOW}!${RESET} $*"; }
die()     { echo ""; echo "${RED}ERROR:${RESET} $*" >&2; exit 1; }

# ask_yes_no "Question?" [default y|n] — returns 0 for yes.
ask_yes_no() {
    local question="$1" default="${2:-n}" hint answer
    if [[ "$ASSUME_YES" == 1 ]]; then
        [[ "$default" == y ]]
        return
    fi
    [[ "$default" == y ]] && hint="[Y/n]" || hint="[y/N]"
    read -r -p "    $question $hint " answer || die "Aborted."
    answer="${answer:-$default}"
    [[ "${answer,,}" == y || "${answer,,}" == yes ]]
}

check_cmd() {
    local cmd="$1" hint="$2"
    if command -v "$cmd" &>/dev/null; then
        printf "    %-12s ${GREEN}OK${RESET}\n" "$cmd"
    else
        printf "    %-12s ${RED}MISSING${RESET} — %s\n" "$cmd" "$hint"
        return 1
    fi
}

# Append a line to data/osm/build-history.log, which survives database wipes.
log_build() {
    mkdir -p "$OSM_DIR"
    echo "$(date '+%Y-%m-%d %H:%M')  $*" >> "$BUILD_LOG"
}

# run_with_timer [--progress] [--keep-going] "Label" command [args...]
# Runs a quiet, slow command with a ticking elapsed-time counter so it's
# obvious nothing is frozen. Its output is only shown if it fails.
#   --progress    also show the command's latest line next to the counter
#                 (a download's tile count, "waiting for the connection")
#   --keep-going  on failure, show the output and return its status instead of
#                 stopping the script
run_with_timer() {
    local progress=0 keep_going=0
    while [[ "$1" == --* ]]; do
        case "$1" in
            --progress) progress=1 ;;
            --keep-going) keep_going=1 ;;
        esac
        shift
    done
    local label="$1" log pid start=$SECONDS status=0 last=""
    shift
    log=$(mktemp)
    "$@" >"$log" 2>&1 &
    pid=$!
    if [[ -t 1 ]]; then
        while kill -0 "$pid" 2>/dev/null; do
            [[ "$progress" == 1 ]] && last=$(latest_line "$log")
            printf "\r\e[K    %s... %ds %s" "$label" $((SECONDS - start)) "$last"
            sleep 1
        done
        printf "\r\e[K"
    else
        info "$label..."
    fi
    wait "$pid" || status=$?
    if [[ "$status" != 0 ]]; then
        cat "$log" >&2
        rm -f "$log"
        [[ "$keep_going" == 1 ]] && return "$status"
        die "$label failed (see above)."
    fi
    rm -f "$log"
    ok "$label ($(( SECONDS - start ))s)"
}

# The last non-empty line a command wrote (a progress counter rewrites its line
# with \r), cut to fit the terminal.
latest_line() {
    local width
    width=$(( $(tput cols 2>/dev/null || echo 100) - 40 ))
    (( width < 20 )) && width=20
    tail -c 400 "$1" 2>/dev/null | tr '\r' '\n' | sed '/^[[:space:]]*$/d' | tail -n 1 \
        | sed 's/^[[:space:]]*//' | cut -c "1-$width" || true
}

human_size() {
    numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"
}

# Free bytes on the filesystem holding $1.
free_bytes() {
    df -P -B1 "$1" | awk 'NR==2 {print $4}'
}
