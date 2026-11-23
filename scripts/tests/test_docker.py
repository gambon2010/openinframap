"""scripts/offline_maps/docker.py: the one way the Python scripts run a program in
Docker (an image, or a Compose service), the files it writes left the user's."""

import os
import subprocess

import pytest

from offline_maps import docker


@pytest.fixture
def ran(monkeypatch):
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        # Compose's configuration names the project.
        out = '{"name": "oimtest"}' if "config" in command else "out"
        return subprocess.CompletedProcess(command, 0, out, "")

    monkeypatch.setattr(docker.subprocess, "run", run)
    return calls


def test_a_program_in_an_image_runs_as_the_user(ran, tmp_path):
    docker.run("pmtiles:1", ["extract", "a", "b"], tmp_path, at="/out", env={"K": "v"})
    ((command, kwargs),) = ran
    assert command[:3] == ["docker", "run", "--rm"]
    assert command[command.index("-w") + 1] == "/out"
    assert f"{tmp_path.resolve()}:/out:z" in command
    assert command[command.index("--user") + 1] == f"{os.getuid()}:{os.getgid()}"
    assert "K=v" in command
    # The image's own entrypoint, then the arguments.
    assert command[-4:] == ["pmtiles:1", "extract", "a", "b"]
    assert kwargs["check"] and kwargs["stdin"] == subprocess.DEVNULL


def test_as_root_then_the_files_given_back(ran, tmp_path):
    docker.run("gdal:1", ["sh", "-c", "apk add 7zip && 7z x"], tmp_path, as_root=True)
    ((command, _),) = ran
    assert "--user" not in command
    assert f"OWNER={os.getuid()}:{os.getgid()}" in command and "MOUNT=/w" in command
    at = command.index("gdal:1")
    assert command[at - 2 : at] == ["--entrypoint", "sh"]
    assert command[at + 1 :] == [
        "-c",
        docker.AS_ROOT,
        "sh",
        "sh",
        "-c",
        "apk add 7zip && 7z x",
    ]


def test_capture_for_reading_what_it_says(ran, tmp_path):
    out = docker.run("pmtiles:1", ["show"], tmp_path, check=False, capture=True)
    ((_, kwargs),) = ran
    assert out.stdout == "out" and not kwargs["check"] and kwargs["capture_output"]


def test_a_program_in_a_compose_service(ran, tmp_path):
    docker.run_service(
        "backend",
        ["/app/.venv/bin/python", "-m", "x"],
        tmp_path,
        at="/work",
        as_root=True,
    )
    (build, _), (run, kwargs) = ran[0], ran[-1]
    assert build[-2:] == ["build", "backend"]
    assert run[:8] == [
        "docker",
        "compose",
        "--progress",
        "quiet",
        "run",
        "--rm",
        "--no-deps",
        "-T",
    ]
    assert "-w" not in run  # the image's own working directory (the backend's code)
    at = run.index("backend")
    assert run[at - 2 : at] == ["--entrypoint", "sh"]
    assert run[at + 1 :] == [
        "-c",
        docker.AS_ROOT,
        "sh",
        "/app/.venv/bin/python",
        "-m",
        "x",
    ]
    assert kwargs["cwd"] == docker.REPO_ROOT
    # As the user: the program is the entrypoint.
    ran.clear()
    docker.run_service("backend", ["/app/.venv/bin/python", "-m", "x"], tmp_path)
    run = ran[-1][0]
    at = run.index("backend")
    assert run[at - 2 : at] == ["--entrypoint", "/app/.venv/bin/python"] and run[
        at + 1 :
    ] == ["-m", "x"]


@pytest.mark.parametrize("program, status", [("true", 0), ("false", 1)])
def test_as_root_keeps_the_programs_status_and_always_gives_back(
    tmp_path, program, status
):
    # The wrapper as the container's sh runs it, with a stand-in chown.
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    (bin_dir / "chown").write_text('#!/bin/sh\necho "$@" > "$LOG"\n')
    (bin_dir / "chown").chmod(0o755)
    log = tmp_path / "chown.log"
    env = {
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "OWNER": "1000:1000",
        "MOUNT": "/w",
        "LOG": str(log),
    }
    result = subprocess.run(
        ["sh", "-c", docker.AS_ROOT, "sh", program], env=env, check=False
    )
    assert result.returncode == status
    assert log.read_text().split() == ["-R", "1000:1000", "/w"]


def test_a_build_removes_the_images_it_replaced(ran):
    docker.remove_superseded_images()
    commands = [command for command, _ in ran]
    # This project's only (by its label), and the build cache trimmed.
    assert [
        "docker",
        "image",
        "prune",
        "-f",
        "--filter",
        "label=com.docker.compose.project=oimtest",
    ] in commands
    assert [
        "docker",
        "builder",
        "prune",
        "-f",
        "--max-used-space",
        docker.BUILD_CACHE_KEPT,
    ] in commands
