"""Fork: installers. Docker on Windows: Docker Desktop's installer (from its update
feed, which names the current version), and WSL's offline installer (Docker Desktop
needs WSL 2, and Windows' own `wsl --install` downloads it)."""

from __future__ import annotations

import re
import urllib.parse

import netsafe

from .found import Installer, NotFound, latest_release, release_file_ending

DESKTOP_FEED = "https://desktop.docker.com/win/main/{arch}/appcast.xml"
# Docker Desktop's names for the architectures, and WSL's.
ARCHITECTURES = {"amd64": "x64", "arm64": "arm64"}
ARCHITECTURE_NAMES = {"amd64": "Intel/AMD", "arm64": "ARM"}


def docker_desktop(arch: str) -> Installer:
    """Docker Desktop's current installer for an architecture."""
    feed_url = DESKTOP_FEED.format(arch=arch)
    feed = netsafe.fetch(feed_url)
    if feed is None:
        raise NotFound(f"Nothing at {feed_url}")
    enclosure = re.search(
        r'<enclosure url="([^"]+)"[^>]*sparkle:shortVersionString="([^"]+)"',
        feed.decode(),
    )
    if not enclosure:
        raise NotFound(f"No installer in {feed_url}")
    url, version = enclosure.groups()
    return Installer(
        urllib.parse.quote(url, safe=":/"),
        f"docker/windows/Docker Desktop Installer {version} {arch}.exe",
        f"Docker Desktop {version} for Windows, {ARCHITECTURE_NAMES[arch]}",
    )


def wsl(arch: str) -> Installer:
    """WSL's offline installer for an architecture (Microsoft's GitHub releases)."""
    release = latest_release("microsoft/WSL")
    name, url = release_file_ending(release, f".{ARCHITECTURES[arch]}.msi")
    return Installer(
        url,
        f"docker/windows/{name}",
        f"WSL {release['tag_name']} for Windows, {ARCHITECTURE_NAMES[arch]}",
    )


def all_windows() -> list[Installer]:
    return [make(arch) for arch in ARCHITECTURES for make in (docker_desktop, wsl)]
