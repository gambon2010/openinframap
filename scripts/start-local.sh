#!/usr/bin/env bash
# Start the OpenInfraMap stack (database, tiles, backend, frontend) locally.
#
# The script assumes that all dependencies (npm packages, Python environment,
# Docker images, etc.) have already been fetched while you had internet access.
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

# Ensure the backend's virtual environment (if present) is available on PATH so
# that locally installed `uv`, `uvicorn`, or other helpers can be discovered
# without manual activation.
if [[ -d "${REPO_ROOT}/web-backend/.venv/bin" ]]; then
  export PATH="${REPO_ROOT}/web-backend/.venv/bin:${PATH}"
fi

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

BACKEND_RUNNER=()

if command -v uv >/dev/null 2>&1; then
  BACKEND_RUNNER=(uv run uvicorn)
elif command -v uvicorn >/dev/null 2>&1; then
  BACKEND_RUNNER=(uvicorn)
else
  # Fall back to python -m uvicorn if the module is installed.
  PYTHON_CANDIDATES=()
  if [[ -x "${REPO_ROOT}/web-backend/.venv/bin/python" ]]; then
    PYTHON_CANDIDATES+=("${REPO_ROOT}/web-backend/.venv/bin/python")
  fi
  if command -v python3 >/dev/null 2>&1; then
    PYTHON_CANDIDATES+=("$(command -v python3)")
  fi

  for py_cmd in "${PYTHON_CANDIDATES[@]}"; do
    if "$py_cmd" -c "import uvicorn" >/dev/null 2>&1; then
      BACKEND_RUNNER=("$py_cmd" -m uvicorn)
      break
    fi
  done

  if [[ ${#BACKEND_RUNNER[@]} -eq 0 ]]; then
    echo "Error: could not find a way to run uvicorn." >&2
    echo "Install uv (https://github.com/astral-sh/uv) or ensure uvicorn is installed in your Python environment." >&2
    exit 1
  fi
fi

BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
VITE_HOST="${VITE_HOST:-127.0.0.1}"
DATABASE_URL="${DATABASE_URL:-postgresql://osm:osm@localhost:5432/osm}"
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
  "${COMPOSE_CMD[@]}" down >/dev/null 2>&1 || true
  exit "$exit_code"
}
trap cleanup EXIT INT TERM

PIDS=()

cd "$REPO_ROOT"

echo "Building and starting database and tileserver containers..."
"${COMPOSE_CMD[@]}" up --build -d db tegola >/dev/null

wait_for_postgres() {
  echo -n "Waiting for Postgres to become ready"
  until "${COMPOSE_CMD[@]}" exec -T db pg_isready -U postgres >/dev/null 2>&1; do
    echo -n "."
    sleep 1
  done
  echo " done."
}

wait_for_postgres

if [[ -n "$PBF_PATH" && $RUN_IMPORT -ne 0 ]]; then
  echo "Importing '$PBF_PATH' into PostGIS via Imposm..."
  "${COMPOSE_CMD[@]}" run --rm -v "$PBF_PATH:/data.osm.pbf:ro" imposm import \
    -read /data.osm.pbf \
    -write \
    -optimize \
    -deployproduction \
    -mapping /mapping.json \
    -cachedir /imposm-cache \
    -diffdir /imposm-diff \
    -expiretiles-dir /imposm-expiry \
    -connection postgis://osm:osm@db/osm
fi

echo "Starting Python web backend on port ${BACKEND_PORT}..."
(
  cd "$REPO_ROOT/web-backend"
  export DATABASE_URL
  "${BACKEND_RUNNER[@]}" main:app --host 127.0.0.1 --port "$BACKEND_PORT" --reload
) &
PIDS+=($!)

if [[ ! -d "$REPO_ROOT/web/node_modules" ]]; then
  echo "Warning: node_modules directory not found; run 'npm install' in web/ before using this script." >&2
fi

echo "Starting Vite frontend on http://${VITE_HOST}:${FRONTEND_PORT} ..."
(
  cd "$REPO_ROOT/web"
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
