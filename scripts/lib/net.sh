# shellcheck shell=bash
# Downloading safely. Every download in the scripts goes through `download` (with
# curl) or, for another downloading command (pmtiles extract), `safely`. The Python
# downloads do the same with scripts/netsafe.py, with these same settings.
#
# When a download fails:
#   - the server still answers (a drop, a busy server): tried again a few times;
#   - it doesn't (the connection is down): wait for it, checking every
#     NET_CHECK_EVERY seconds for up to NET_WAIT_SECONDS, then go on where it
#     stopped. It doesn't come back: stop with status CONNECTION_LOST (75),
#     keeping what's downloaded ("run again to go on");
#   - a download that hangs (under 1 kB/s for NET_STALL_SECONDS) counts as failed.
# Small files fetched while the scripts ask their questions (download --quick) are
# tried 3 times and then given up: the questions have a fallback for offline.
# Sourced by common.sh.

export NET_WAIT_SECONDS="${NET_WAIT_SECONDS:-900}"
export NET_CHECK_EVERY="${NET_CHECK_EVERY:-15}"
NET_STALL_SECONDS="${NET_STALL_SECONDS:-120}"
NET_TRIES=3
CONNECTION_LOST=75

# download [--quick] URL [FILE]
#   With FILE: saved there, through FILE.part (resumed when run again: FILE only
#   appears once complete). Waits for a lost connection (see above).
#   Without FILE: printed. With --quick: tried 3 times, never waits.
download() {
    local quick=0
    [[ "$1" == --quick ]] && { quick=1; shift; }
    local url="$1" out="${2:-}"
    if [[ "$quick" == 1 || -z "$out" ]]; then
        local to=()
        [[ -n "$out" ]] && to=(-o "$out")
        curl -sfL --connect-timeout 10 --max-time 30 --retry 2 --retry-delay 2 --retry-all-errors \
            "${to[@]}" "$url"
        return
    fi
    local size
    size=$(remote_size "$url")
    # A download completed last time but not moved into place: nothing to resume.
    if [[ "$size" -gt 0 && "$(stat -c%s "$out.part" 2>/dev/null || echo 0)" == "$size" ]]; then
        mv "$out.part" "$out"
        return
    fi
    # -C - resumes; -R keeps the server's date on the file (when the data is from).
    safely "$url" curl -L --fail --progress-bar -R -C - --connect-timeout 20 \
        --speed-limit 1024 --speed-time "$NET_STALL_SECONDS" -o "$out.part" "$url" || return
    mv "$out.part" "$out"
}

# safely URL command... — run a downloading command until it works (see above).
# URL is its server, to tell a lost connection from a failing download. Returns
# CONNECTION_LOST when the connection doesn't come back, else the command's status.
safely() {
    local url="$1" tries=0 status
    shift
    while true; do
        status=0
        "$@" || status=$?
        [[ "$status" == 0 ]] && return 0
        tries=$((tries + 1))
        if reachable "$url"; then
            # The server answers: a drop or a busy server. A few more tries.
            [[ "$tries" -ge "$NET_TRIES" ]] && return "$status"
            warn "Download interrupted: trying again (${tries}/${NET_TRIES})..." >&2
            sleep 5
        else
            wait_for_internet "$url" || return "$CONNECTION_LOST"
        fi
    done
}

# wait_for_internet URL — wait until URL's server answers again, up to
# NET_WAIT_SECONDS; 1 if it doesn't.
wait_for_internet() {
    local url="$1" waited=0
    warn "No answer from $(url_host "$url"): waiting for the connection (up to $(wait_limit_text))..." >&2
    while [[ "$waited" -lt "$NET_WAIT_SECONDS" ]]; do
        sleep "$NET_CHECK_EVERY"
        waited=$((waited + NET_CHECK_EVERY))
        if reachable "$url"; then
            ok "Connection back: going on." >&2
            return 0
        fi
    done
    return 1
}

# die_download STATUS "what" — stop the script after a failed download, saying why.
die_download() {
    if [[ "$1" == "$CONNECTION_LOST" ]]; then
        die "No internet connection for $(wait_limit_text): stopped while downloading $2.
       What was downloaded is kept: run the script again to go on from there."
    fi
    die "Downloading $2 failed (see above). Run the script again to resume it."
}

# How long a lost connection is waited for: "15 min" (or "30 s").
wait_limit_text() {
    if [[ "$NET_WAIT_SECONDS" -ge 60 ]]; then echo "$((NET_WAIT_SECONDS / 60)) min"; else echo "${NET_WAIT_SECONDS} s"; fi
}

# reachable URL — whether URL's server answers at all (any answer will do).
reachable() {
    curl -s -o /dev/null -I --connect-timeout 10 --max-time 15 "$(url_origin "$1")/"
}

# remote_size URL — the size of the file at URL in bytes (0 if unknown).
remote_size() {
    curl -sIL --connect-timeout 3 --max-time 10 "$1" | tr -d '\r' \
        | awk 'tolower($1)=="content-length:" {n=$2} END {print n+0}'
}

url_origin() { sed -E 's#^([a-z]+://[^/]+).*#\1#' <<<"$1"; }
url_host() { sed -E 's#^[a-z]+://([^/]+).*#\1#' <<<"$1"; }
