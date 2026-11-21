"""Fork: offline maps. The one way the Python scripts run a program in Docker: in
an image of its own (pmtiles, GDAL) or in one of Compose's services (the
backend's image: its Python packages), a folder of this computer mounted, and
what it writes left yours, not root's. The shell's counterpart is `compose_run`
(scripts/lib/docker.sh)."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
# Docker's build cache is trimmed to this after a build (as lib/docker.sh's).
BUILD_CACHE_KEPT = "5GB"

# Run as root, then give everything under the mount back to the user, keeping the
# program's exit status (for images whose programs only run as root).
AS_ROOT = 'status=0; "$@" || status=$?; chown -R "$OWNER" "$MOUNT"; exit $status'


def owner() -> str:
    return f"{os.getuid()}:{os.getgid()}"


def options(
    mount: Path, at: str, env: dict[str, str] | None, as_root: bool
) -> list[str]:
    found = ["-v", f"{mount.resolve()}:{at}:z"]
    if not as_root:
        found += ["--user", owner()]
    for key, value in {
        **(env or {}),
        **({"OWNER": owner(), "MOUNT": at} if as_root else {}),
    }.items():
        found += ["-e", f"{key}={value}"]
    return found


def program(args: list[str], as_root: bool) -> tuple[list[str], list[str]]:
    """(the entrypoint options, the arguments) for a program and its arguments."""
    if as_root:
        return ["--entrypoint", "sh"], ["-c", AS_ROOT, "sh", *args]
    return [], args


def run(
    image: str,
    args: list[str],
    mount: Path,
    *,
    at: str = "/w",
    env: dict[str, str] | None = None,
    as_root: bool = False,
    check: bool = True,
    capture: bool = False,
) -> subprocess.CompletedProcess:
    """A program in an image (its own entrypoint, or `args` from the start when
    as_root), the folder `mount` at `at` (the working directory)."""
    entry, rest = program(args, as_root)
    return subprocess.run(
        [
            "docker",
            "run",
            "--rm",
            "-w",
            at,
            *options(mount, at, env, as_root),
            *entry,
            image,
            *rest,
        ],
        check=check,
        capture_output=capture,
        text=capture,
        stdin=subprocess.DEVNULL,
    )


def run_service(
    service: str,
    args: list[str],
    mount: Path,
    *,
    at: str = "/w",
    as_root: bool = False,
) -> None:
    """A program (`args`, from the program itself) in a Compose service's image,
    built first if its code changed, the folder `mount` at `at` (the image's own
    working directory kept)."""
    compose = ["docker", "compose", "--progress", "quiet"]
    quiet: dict[str, Any] = {"cwd": REPO_ROOT, "stdin": subprocess.DEVNULL}
    subprocess.run([*compose, "build", service], check=True, **quiet)
    remove_superseded_images()
    entry, rest = program(args, as_root)
    if not as_root:
        entry, rest = ["--entrypoint", args[0]], args[1:]
    subprocess.run(
        [
            *compose,
            "run",
            "--rm",
            "--no-deps",
            "-T",
            *options(mount, at, None, as_root),
            *entry,
            service,
            *rest,
        ],
        check=True,
        **quiet,
    )


def run_backend_module(module: str, folder: Path, area: str) -> None:
    """One of the backend's build steps (python -m src.fork.background_build.<module>
    --area AREA) on the offline maps folder, in the backend's image, as root (its
    Python is root's)."""
    args = ["/app/.venv/bin/python", "-m", f"src.fork.background_build.{module}"]
    run_service(
        "backend",
        [*args, "--area", area, "--folder", "/work"],
        folder,
        at="/work",
        as_root=True,
    )


def remove_superseded_images() -> None:
    """After a build: this project's images it replaced (no name any more, still
    labelled with the project) and Docker's build cache beyond BUILD_CACHE_KEPT, as
    lib/docker.sh's remove_superseded_images (old copies filled the system disk:
    docs/HISTORY.md, 2026-11-21). Images in use and named ones are never touched."""
    quiet: dict[str, Any] = {
        "cwd": REPO_ROOT,
        "stdin": subprocess.DEVNULL,
        "capture_output": True,
    }
    config = subprocess.run(
        ["docker", "compose", "config", "--format", "json"],
        check=True,
        text=True,
        **quiet,
    )
    project = json.loads(config.stdout)["name"]
    # check=False: a clean-up that fails (an older Docker without --max-used-space)
    # leaves the leftovers for next time; the build itself succeeded.
    subprocess.run(
        [
            "docker",
            "image",
            "prune",
            "-f",
            "--filter",
            f"label=com.docker.compose.project={project}",
        ],
        check=False,
        **quiet,
    )
    subprocess.run(
        ["docker", "builder", "prune", "-f", "--max-used-space", BUILD_CACHE_KEPT],
        check=False,
        **quiet,
    )
