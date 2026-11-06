# shellcheck shell=bash
# Talking to the user: titles, sections, messages, questions, menus, timed steps,
# sizes and room on disk.
# Sourced by common.sh.

# --- Messages ---------------------------------------------------------------------

section() { CURRENT_STEP="$*"; echo ""; echo "${BOLD}==> $*${RESET}"; }

info()    { echo "    $*"; }
ok()      { echo "    ${GREEN}✓${RESET} $*"; }
warn()    { echo "    ${YELLOW}!${RESET} $*"; }
die()     { echo ""; echo "${RED}ERROR:${RESET} $*" >&2; exit 1; }

RULE="======================================================"

# banner "Title" — a script's title, at its start.
banner() {
    echo "${BOLD}$RULE${RESET}"
    echo "${BOLD} Open Infrastructure Map — $1${RESET}"
    echo "${BOLD}$RULE${RESET}"
}

# done_banner "What was done" — a script's success, at its end.
done_banner() {
    echo ""
    echo "${BOLD}$RULE${RESET}"
    echo "${BOLD} ${GREEN}✓${RESET}${BOLD} $1${RESET}"
    echo "${BOLD}$RULE${RESET}"
}

# duration SECONDS — "1h 3m 5s", "3m 5s" or "5s".
duration() {
    local s="$1"
    if [[ "$s" -ge 3600 ]]; then
        echo "$((s / 3600))h $((s % 3600 / 60))m $((s % 60))s"
    elif [[ "$s" -ge 60 ]]; then
        echo "$((s / 60))m $((s % 60))s"
    else
        echo "${s}s"
    fi
}

# Append a line to data/osm/build-history.log, which survives database wipes.
log_build() {
    mkdir -p "$OSM_DIR"
    echo "$(date '+%Y-%m-%d %H:%M')  $*" >> "$BUILD_LOG"
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

# --- Questions --------------------------------------------------------------------

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

# choose_number [--or-enter] MAX [DEFAULT] — a number from 1 to MAX from the user,
# printed (use it as answer=$(choose_number 3 1)). Enter: DEFAULT; with --or-enter
# and no default, Enter prints nothing and returns 1 (to go back). Asks again until
# the answer is valid; no input left (EOF): DEFAULT, else stops the script.
choose_number() {
    local or_enter=0
    [[ "$1" == --or-enter ]] && { or_enter=1; shift; }
    local max="$1" default="${2:-}" answer hint="1-$1"
    [[ -n "$default" ]] && hint+=", default $default"
    [[ "$or_enter" == 1 && -z "$default" ]] && hint+=", Enter to go back"
    while true; do
        if ! read -r -p "    Choose [$hint]: " answer; then
            [[ -n "$default" ]] || die "Aborted."
            answer="$default"
        fi
        answer="${answer:-$default}"
        if [[ -z "$answer" && "$or_enter" == 1 ]]; then
            return 1
        fi
        if [[ "$answer" =~ ^[0-9]+$ && "$answer" -ge 1 && "$answer" -le "$max" ]]; then
            echo "$answer"
            return 0
        fi
    done
}

# room_for BYTES DIR "where" — say how much is needed and free in DIR; if it won't
# fit, ask whether to go on anyway (returns 1 for no).
room_for() {
    local need="$1" dir="$2" where="$3" free
    free=$(free_bytes "$dir")
    info "Needs about $(human_size "$need") in $where — $(human_size "$free") free."
    [[ "$need" -le "$free" ]] && return 0
    ask_yes_no "That probably won't fit. Continue anyway?" n
}

# --- Long steps ---------------------------------------------------------------------

# run_with_timer [--progress] [--keep-going] [--stall SECONDS] "Label" command [args...]
# Runs a quiet, slow command with a ticking elapsed-time counter so it's
# obvious nothing is frozen. Its output is only shown if it fails.
#   --progress       also show the command's latest line next to the counter
#                    (a download's tile count, "waiting for the connection")
#   --keep-going     on failure, show the output and return its status instead of
#                    stopping the script
#   --stall SECONDS  stop the command (status 124) when it has written nothing for
#                    that long: a download that hangs (its progress stops moving)
run_with_timer() {
    local progress=0 keep_going=0 stall=0
    while [[ "$1" == --* ]]; do
        case "$1" in
            --progress) progress=1 ;;
            --keep-going) keep_going=1 ;;
            --stall) stall="$2"; shift ;;
        esac
        shift
    done
    local label="$1" log pid start=$SECONDS status=0 last="" size=0 moved=$SECONDS
    shift
    log=$(mktemp)
    "$@" >"$log" 2>&1 &
    pid=$!
    [[ -t 1 ]] || info "$label..."
    # Watched every second when there's a counter to show or a stall to catch.
    while [[ -t 1 || "$stall" -gt 0 ]] && kill -0 "$pid" 2>/dev/null; do
        if [[ "$stall" -gt 0 ]]; then
            if [[ "$(stat -c%s "$log")" != "$size" ]]; then
                size=$(stat -c%s "$log")
                moved=$SECONDS
            elif [[ $((SECONDS - moved)) -ge "$stall" ]]; then
                kill_tree "$pid"
                echo "No progress for ${stall}s: stopped." >>"$log"
                break
            fi
        fi
        if [[ -t 1 ]]; then
            [[ "$progress" == 1 ]] && last=$(latest_line "$log")
            printf "\r\e[K    %s... %ds %s" "$label" $((SECONDS - start)) "$last"
        fi
        sleep 1
    done
    [[ -t 1 ]] && printf "\r\e[K"
    wait "$pid" 2>/dev/null || status=$?
    [[ "$stall" -gt 0 && $((SECONDS - moved)) -ge "$stall" && "$status" != 0 ]] && status=124
    if [[ "$status" != 0 ]]; then
        cat "$log" >&2
        rm -f "$log"
        [[ "$keep_going" == 1 ]] && return "$status"
        die "$label failed (see above)."
    fi
    rm -f "$log"
    ok "$label ($(duration $((SECONDS - start))))"
}

# kill_tree PID — stop a process and everything it started (a function running
# docker, whose client passes the signal on to the container).
kill_tree() {
    local child
    for child in $(pgrep -P "$1" 2>/dev/null); do
        kill_tree "$child"
    done
    kill "$1" 2>/dev/null || true
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

# --- Sizes ----------------------------------------------------------------------------

human_size() {
    numfmt --to=iec --suffix=B "$1" 2>/dev/null || echo "$1 bytes"
}

# Free bytes on the filesystem holding $1.
free_bytes() {
    df -P -B1 "$1" | awk 'NR==2 {print $4}'
}
