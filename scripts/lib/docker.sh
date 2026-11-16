# shellcheck shell=bash
# Docker: the one way the shell scripts start Compose services and run one-off
# containers (the Python scripts' counterpart: offline_maps/docker.py).
# Sourced by common.sh.

# up_services [OPTION...] SERVICE... — start Compose services, rebuilding their
# images first so code changes are picked up (fast when nothing changed). Offline
# the build fails, so the existing images are used (e.g. loaded from
# data/exports/docker-images.tar.gz). Options go to `up` (--force-recreate).
up_services() {
    docker compose --progress quiet up -d --build "$@" </dev/null 2>/dev/null \
        || docker compose --progress quiet up -d "$@" </dev/null
}

# compose_run [OPTION...] SERVICE [ARGS...] — a one-off container of a Compose
# service, removed afterwards, without a terminal. Options go to `run` (-v, --user,
# --entrypoint, --no-deps, --build).
compose_run() {
    docker compose --progress quiet run --rm -T "$@"
}

# backend_python ARGS... — Python in the backend's image (its code, its packages,
# the database), for the build steps written there. The image is rebuilt first so
# code changes are picked up; offline, the one there is used.
backend_python() {
    docker compose --progress quiet build backend </dev/null >/dev/null 2>&1 || true
    compose_run --no-deps \
        -e ADMIN_DATABASE_URL="postgresql://$DB_USER:osm@db:5432/$DB_NAME" \
        --entrypoint /app/.venv/bin/python backend "$@" </dev/null
}
