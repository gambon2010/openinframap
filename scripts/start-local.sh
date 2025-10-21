#!/usr/bin/env bash
# Start the OpenInfraMap stack (database, tiles, backend, frontend) locally.
#
# The script assumes that all dependencies (npm packages, Python environment,
# Docker images, etc.) have already been fetched while you had internet access.
# It will attempt to install missing frontend/backend packages using your local
# caches (via `npm install` and `uv sync --frozen`).
#
# Usage:
#   ./scripts/start-local.sh [--pbf /path/to/data.osm.pbf] [--no-import]
#
# Options:
#   --pbf PATH      Import the provided PBF file into PostGIS using Imposm.
#   --no-import     Skip the Imposm import even if --pbf is provided.
#
# Environment variables:
#   BACKEND_PORT    Port for the Python backend (default: 8000)
#   FRONTEND_PORT   Port for the Vite dev server (default: 5173)
#   DATABASE_URL    Connection string for the backend. Defaults to the local
#                   dockerised database.
#   VITE_HOST       Host/interface for the Vite dev server (default: 127.0.0.1)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

add_backend_env_to_path() {
  if [[ -n "${VIRTUAL_ENV:-}" && -d "${VIRTUAL_ENV}/bin" ]]; then
    export PATH="${VIRTUAL_ENV}/bin:${PATH}"
  fi

  if [[ -d "${REPO_ROOT}/web-backend/.venv/bin" ]]; then
    export PATH="${REPO_ROOT}/web-backend/.venv/bin:${PATH}"
  fi
}

add_backend_env_to_path

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: '$1' command not found. Please install it before running this script." >&2
    exit 1
  fi
}

# Resolve docker compose command
resolve_compose() {
  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    echo "docker compose"
  elif command -v docker-compose >/dev/null 2>&1; then
    echo "docker-compose"
  else
    echo "Error: docker compose (or docker-compose) is required." >&2
    exit 1
  fi
}

COMPOSE_CMD=( $(resolve_compose) )
require_cmd "npm"
require_cmd "docker"

BACKEND_PYTHON=""

ensure_backend_env() {
  if command -v uv >/dev/null 2>&1; then
    if [[ ! -d "${REPO_ROOT}/web-backend/.venv" ]]; then
      echo "Creating backend virtual environment with 'uv sync --frozen'..."
      (cd "${REPO_ROOT}/web-backend" && uv sync --frozen)
    elif ! (cd "${REPO_ROOT}/web-backend" && uv run python -c "import httpx" >/dev/null 2>&1); then
      echo "Updating backend dependencies with 'uv sync --frozen'..."
      (cd "${REPO_ROOT}/web-backend" && uv sync --frozen)
    fi
    return
  fi

  local python_candidates=()

  if [[ -n "${VIRTUAL_ENV:-}" && -x "${VIRTUAL_ENV}/bin/python" ]]; then
    python_candidates+=("${VIRTUAL_ENV}/bin/python")
  fi

  if [[ -x "${REPO_ROOT}/web-backend/.venv/bin/python" ]]; then
    python_candidates+=("${REPO_ROOT}/web-backend/.venv/bin/python")
  fi

  if command -v python3 >/dev/null 2>&1; then
    python_candidates+=("$(command -v python3)")
  fi

  if command -v python >/dev/null 2>&1; then
    python_candidates+=("$(command -v python)")
  fi

  # Deduplicate while preserving order
  local -A seen=()
  local unique_candidates=()
  for candidate in "${python_candidates[@]}"; do
    if [[ -n "${seen[$candidate]+x}" ]]; then
      continue
    fi
    unique_candidates+=("$candidate")
    seen[$candidate]=1
  done

  for py_cmd in "${unique_candidates[@]}"; do
    if "$py_cmd" -c "import httpx, uvicorn" >/dev/null 2>&1; then
      BACKEND_PYTHON="$py_cmd"
      return
    fi
  done

  if [[ -x "${REPO_ROOT}/web-backend/.venv/bin/python" ]]; then
    echo "Error: the Python environment at web-backend/.venv/ is missing required packages (e.g. httpx, uvicorn)." >&2
    echo "Activate that environment and install the dependencies (for example via 'uv sync --frozen') before rerunning the script." >&2
  else
    echo "Error: backend dependencies are missing and no suitable Python environment was found." >&2
    echo "Install uv (https://github.com/astral-sh/uv) and run 'uv sync --frozen' in web-backend/," >&2
    echo "or activate your own virtual environment with the required packages before rerunning the script." >&2
  fi
  exit 1
}

ensure_backend_env
add_backend_env_to_path

ensure_frontend_deps() {
  if [[ -d "${REPO_ROOT}/web/node_modules" && -x "${REPO_ROOT}/web/node_modules/.bin/vite" ]]; then
    return
  fi

  echo "Installing frontend dependencies with 'npm install'..."
  (cd "${REPO_ROOT}/web" && npm install)

  if [[ ! -x "${REPO_ROOT}/web/node_modules/.bin/vite" ]]; then
    echo "Error: Vite binary not found after 'npm install'. Ensure npm dependencies are cached locally and retry." >&2
    exit 1
  fi
}

ensure_frontend_deps

BACKEND_RUNNER=()

if command -v uv >/dev/null 2>&1; then
  BACKEND_RUNNER=(uv run uvicorn)
else
  BACKEND_RUNNER=("${BACKEND_PYTHON}" -m uvicorn)
fi

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VITE_HOST="${VITE_HOST:-127.0.0.1}"
DATABASE_URL="${DATABASE_URL:-postgresql://osm:osm@localhost:5432/osm}"
LOCAL_BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}"
LOCAL_TILES_URL="http://127.0.0.1:8080"
if [[ -z "${VITE_BACKEND_URL:-}" ]]; then
  FRONTEND_BACKEND_URL="$LOCAL_BACKEND_URL"
else
  FRONTEND_BACKEND_URL="$VITE_BACKEND_URL"
fi

if [[ -z "${VITE_TILES_URL:-}" ]]; then
  FRONTEND_TILES_URL="$LOCAL_TILES_URL"
else
  FRONTEND_TILES_URL="$VITE_TILES_URL"
fi
PBF_PATH=""
RUN_IMPORT=1

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pbf)
      shift
      if [[ $# -eq 0 ]]; then
        echo "Error: --pbf requires a file path." >&2
        exit 1
      fi
      PBF_PATH="$1"
      ;;
    --no-import)
      RUN_IMPORT=0
      ;;
    -h|--help)
      sed -n '2,40p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
  shift
done

if [[ -n "$PBF_PATH" && ! -f "$PBF_PATH" ]]; then
  echo "Error: PBF file '$PBF_PATH' not found." >&2
  exit 1
fi

PBF_IMPORT_DIR=""
if [[ -n "$PBF_PATH" ]]; then
  if command -v realpath >/dev/null 2>&1; then
    PBF_ABS_PATH="$(realpath "$PBF_PATH")"
  else
    if ! command -v python3 >/dev/null 2>&1; then
      echo "Error: need 'realpath' or 'python3' to resolve absolute path for '$PBF_PATH'." >&2
      exit 1
    fi
    PBF_ABS_PATH="$(python3 - <<'PY'
import os
import sys
print(os.path.abspath(sys.argv[1]))
PY
"$PBF_PATH")"
  fi

  if ! command -v mktemp >/dev/null 2>&1; then
    echo "Error: 'mktemp' is required to stage PBF data for import." >&2
    exit 1
  fi

  PBF_BASE_NAME="$(basename "$PBF_ABS_PATH")"
  PBF_IMPORT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/openinframap-pbf.XXXXXX")"
  cp "$PBF_ABS_PATH" "${PBF_IMPORT_DIR}/${PBF_BASE_NAME}"
  chmod 0644 "${PBF_IMPORT_DIR}/${PBF_BASE_NAME}"
  chmod 0755 "$PBF_IMPORT_DIR"
fi

cleanup() {
  local exit_code=$?
  echo
  echo "Stopping OpenInfraMap stack..."
  for pid in "${PIDS[@]-}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
      wait "$pid" 2>/dev/null || true
    fi
  done
  if [[ -n "${PBF_IMPORT_DIR}" && -d "$PBF_IMPORT_DIR" ]]; then
    rm -rf "$PBF_IMPORT_DIR"
  fi
  "${COMPOSE_CMD[@]}" down >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

PIDS=()

cd "$REPO_ROOT"

echo "Building and starting database container..."
"${COMPOSE_CMD[@]}" up --build -d db >/dev/null

wait_for_postgres() {
  echo -n "Waiting for Postgres to become ready"
  until "${COMPOSE_CMD[@]}" exec -T db pg_isready -U postgres >/dev/null 2>&1; do
    echo -n "."
    sleep 1
  done
  echo " done."
}

wait_for_postgres

echo "Starting tileserver container..."
"${COMPOSE_CMD[@]}" up --build -d tegola >/dev/null

if [[ -n "$PBF_PATH" && $RUN_IMPORT -ne 0 ]]; then
  echo "Importing '$PBF_PATH' into PostGIS via Imposm..."
  volume_opts="ro"
  if command -v selinuxenabled >/dev/null 2>&1 && selinuxenabled; then
    volume_opts="ro,z"
  fi

  "${COMPOSE_CMD[@]}" run --rm -v "${PBF_IMPORT_DIR}:/imposm-input:${volume_opts}" imposm import \
    -read "/imposm-input/${PBF_BASE_NAME}" \
    -overwritecache \
    -write \
    -optimize \
    -deployproduction \
    -mapping /mapping.json \
    -cachedir /imposm-cache \
    -diffdir /imposm-diff \
    -connection postgis://osm:osm@db/osm
fi

echo "Starting Python web backend on port ${BACKEND_PORT}..."
(
  cd "$REPO_ROOT/web-backend"
  export DATABASE_URL
  "${BACKEND_RUNNER[@]}" main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload
) &
PIDS+=($!)

echo "Starting Vite frontend on http://${VITE_HOST}:${FRONTEND_PORT} ..."
(
  cd "$REPO_ROOT/web"
  VITE_BACKEND_URL="$FRONTEND_BACKEND_URL" \
  VITE_TILES_URL="$FRONTEND_TILES_URL" \
  npm run dev -- --host "$VITE_HOST" --port "$FRONTEND_PORT"
) &
PIDS+=($!)

echo
cat <<EOM
OpenInfraMap stack is running locally:
  Frontend: http://${VITE_HOST}:${FRONTEND_PORT}
  Backend:  http://127.0.0.1:${BACKEND_PORT}
  Tiles:    http://127.0.0.1:8080

Press Ctrl+C to stop everything.
EOM

FAIL=0
for pid in "${PIDS[@]}"; do
  if ! wait "$pid"; then
    FAIL=1
  fi
done
exit "$FAIL"
