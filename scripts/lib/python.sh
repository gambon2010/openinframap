# shellcheck shell=bash
# ---------------------------------------------------------------------------
# Python for the scripts: with their packages (scripts/pyproject.toml: mercantile,
# pmtiles, filelock), in an environment uv makes and keeps up to date
# (scripts/.venv). Source common.sh, not this.
# ---------------------------------------------------------------------------

# scripts_python ARGS... — python -I ARGS... in the scripts' environment (made on
# first use; offline, the one there is used).
scripts_python() {
    uv run --quiet --project "$REPO_ROOT/scripts" python -I "$@"
}
