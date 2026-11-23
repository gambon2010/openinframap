# shellcheck shell=bash
# Docker: the one way the shell scripts start Compose services and run one-off
# containers (the Python scripts' counterpart: offline_maps/docker.py).
# Sourced by common.sh.

# Docker's build cache is trimmed to this after a build (offline_maps/docker.py has
# the same: scripts/tests/test_one_source.py).
BUILD_CACHE_KEPT=5GB

# up_services [OPTION...] SERVICE... — start Compose services, rebuilding their
# images first so code changes are picked up (fast when nothing changed). Offline
# the build fails, so the existing images are used (e.g. loaded from
# data/map/exports/docker-images.tar.gz). Options go to `up` (--force-recreate).
up_services() {
    if docker compose --progress quiet up -d --build "$@" </dev/null 2>/dev/null; then
        remove_superseded_images
    else
        docker compose --progress quiet up -d "$@" </dev/null
    fi
}

# remove_superseded_images — after a build: this project's images it replaced (no
# name any more, still labelled with the project), and Docker's build cache beyond
# BUILD_CACHE_KEPT. Each rebuild left its old copy behind otherwise: 69 GB of them
# and a 77 GB cache filled the system disk and stopped the database (docs/HISTORY.md,
# 2026-11-21). Images in use and named ones are never touched.
remove_superseded_images() {
    local project
    project=$(compose_project)
    # A clean-up that fails (an older Docker without --max-used-space) leaves the
    # leftovers for next time: the build itself succeeded, so the caller goes on.
    docker image prune -f --filter "label=com.docker.compose.project=$project" >/dev/null 2>&1 || true
    docker builder prune -f --max-used-space "$BUILD_CACHE_KEPT" >/dev/null 2>&1 || true
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
    if docker compose --progress quiet build backend </dev/null >/dev/null 2>&1; then
        remove_superseded_images
    fi
    compose_run --no-deps \
        -e ADMIN_DATABASE_URL="postgresql://$DB_USER:osm@db:5432/$DB_NAME" \
        --entrypoint /app/.venv/bin/python backend "$@" </dev/null
}

# Docker installed and running, or a message saying what to do (and where its
# installers are kept, if they are).
require_docker() {
    if ! command -v docker >/dev/null 2>&1; then
        point_to_installers
        die "Docker isn't installed. Install it, then re-run this script."
    fi
    docker info >/dev/null 2>&1 || die "Docker isn't running. Start Docker, then re-run this script."
}
