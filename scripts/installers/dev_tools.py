"""Fork: installers. The development tools, for Linux and Windows on Intel/AMD and ARM:
Node.js (its current long-term release), uv, the Python builds that uv installs
(stored in the layout uv's UV_PYTHON_INSTALL_MIRROR reads, so `uv` finds them
offline), 7-Zip (the IGN photos' archives)."""

from __future__ import annotations

import json
import subprocess
import tarfile
import tempfile
import urllib.parse
from pathlib import Path

import netsafe

from .found import (
    Installer,
    NotFound,
    latest_release,
    release_file,
    release_file_ending,
)

NODE_INDEX = "https://nodejs.org/dist/index.json"
NODE_DIST = "https://nodejs.org/dist"
# The Python the scripts use (scripts/pyproject.toml asks for 3.11 or newer).
PYTHON = "3.13"
# Where uv downloads Python builds from: the part the mirror replaces.
PYTHON_DOWNLOADS = "/python-build-standalone/releases/download/"
# Each tool's name for (system, architecture), ours first.
PLATFORMS = ("linux-amd64", "linux-arm64", "windows-amd64", "windows-arm64")
NODE_FILES = {
    "linux-amd64": "node-{v}-linux-x64.tar.xz",
    "linux-arm64": "node-{v}-linux-arm64.tar.xz",
    "windows-amd64": "node-{v}-x64.msi",
    "windows-arm64": "node-{v}-arm64.msi",
}
UV_FILES = {
    "linux-amd64": "uv-x86_64-unknown-linux-musl.tar.gz",
    "linux-arm64": "uv-aarch64-unknown-linux-musl.tar.gz",
    "windows-amd64": "uv-x86_64-pc-windows-msvc.zip",
    "windows-arm64": "uv-aarch64-pc-windows-msvc.zip",
}
UV_PYTHON_PLATFORMS = {
    "linux-amd64": "linux-x86_64-gnu",
    "linux-arm64": "linux-aarch64-gnu",
    "windows-amd64": "windows-x86_64-none",
    "windows-arm64": "windows-aarch64-none",
}
SEVEN_ZIP_ENDINGS = {
    "linux-amd64": "-linux-x64.tar.xz",
    "linux-arm64": "-linux-arm64.tar.xz",
    "windows-amd64": "-x64.exe",
    "windows-arm64": "-arm64.exe",
}


def node() -> list[Installer]:
    """Node.js's newest long-term release, for each platform."""
    page = netsafe.fetch(NODE_INDEX)
    if page is None:
        raise NotFound(f"Nothing at {NODE_INDEX}")
    version = next(r["version"] for r in json.loads(page) if r["lts"])
    found = []
    for platform in PLATFORMS:
        name = NODE_FILES[platform].format(v=version)
        found.append(
            Installer(
                f"{NODE_DIST}/{version}/{name}",
                f"dev/node/{name}",
                f"Node.js {version}, {platform}",
            )
        )
    return found


def uv(release: dict) -> list[Installer]:
    """uv's latest release, for each platform."""
    tag = release["tag_name"]
    return [
        Installer(
            release_file(release, UV_FILES[p]),
            f"dev/uv/{tag}/{UV_FILES[p]}",
            f"uv {tag}, {p}",
        )
        for p in PLATFORMS
    ]


def python(release: dict) -> list[Installer]:
    """The Python builds this uv installs, for each platform, where its mirror setting
    finds them (dev/python/<release>/<file>). Asked of uv itself (the Linux build,
    run here), so they're exactly the ones it looks for."""
    listing = uv_python_listing(release)
    found = []
    for platform in PLATFORMS:
        url = python_url(listing, UV_PYTHON_PLATFORMS[platform])
        # Saved by its real name ("+", not "%2B"): uv reads the mirror as files.
        stored = urllib.parse.unquote(url.split(PYTHON_DOWNLOADS, 1)[1])
        found.append(
            Installer(
                url, f"dev/python/{stored}", f"Python {PYTHON} for uv, {platform}"
            )
        )
    return found


def uv_python_listing(release: dict) -> str:
    """`uv python list` of every platform's downloads, by the release's Linux uv."""
    with tempfile.TemporaryDirectory() as work:
        archive = Path(work) / "uv.tar.gz"
        netsafe.fetch_file(release_file(release, UV_FILES["linux-amd64"]), archive)
        with tarfile.open(archive) as tar:
            tar.extractall(work, filter="data")
        program = next(Path(work).glob("*/uv"))
        command = [
            str(program),
            "python",
            "list",
            PYTHON,
            "--only-downloads",
            "--all-platforms",
            "--all-arches",
            "--show-urls",
        ]
        return subprocess.run(
            command, capture_output=True, text=True, check=True
        ).stdout


def python_url(listing: str, platform: str) -> str:
    """The address of the newest CPython build for a platform in uv's listing."""
    for line in listing.splitlines():
        name, _, url = line.partition(" ")
        if name.startswith(f"cpython-{PYTHON}.") and name.endswith(f"-{platform}"):
            return url.strip()
    raise NotFound(f"uv lists no CPython {PYTHON} for {platform}")


def seven_zip() -> list[Installer]:
    """7-Zip's newest release, for each platform (its official GitHub releases, which
    7-zip.org links to)."""
    release = latest_release("ip7z/7zip")
    found = []
    for platform in PLATFORMS:
        name, url = release_file_ending(release, SEVEN_ZIP_ENDINGS[platform])
        found.append(
            Installer(
                url, f"dev/7zip/{name}", f"7-Zip {release['tag_name']}, {platform}"
            )
        )
    return found


def all_dev_tools() -> list[Installer]:
    uv_release = latest_release("astral-sh/uv")
    return node() + uv(uv_release) + python(uv_release) + seven_zip()
