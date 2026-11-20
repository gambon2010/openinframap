"""Fork: installers. What an installer is, and reading what the download sites list."""

from __future__ import annotations

import json
import re
import urllib.parse
from dataclasses import dataclass

import netsafe

GITHUB_API = "https://api.github.com/repos"


@dataclass(frozen=True)
class Installer:
    url: str
    file: (
        str  # where it goes in data/installers/ ("docker/linux/ubuntu-24.04-amd64/...")
    )
    what: str  # "Docker for Ubuntu 24.04 LTS, Intel/AMD"


class NotFound(Exception):
    """A site no longer lists what we look for (its layout changed): said, not hidden."""


def links(url: str) -> list[str]:
    """The file names a directory listing links to (as written: %3a decoded)."""
    page = netsafe.fetch(url)
    if page is None:
        raise NotFound(f"Nothing at {url}")
    found = re.findall(r'href="([^"?/][^"]*)"', page.decode("utf-8", "replace"))
    return [urllib.parse.unquote(name) for name in found]


def latest_release(repository: str) -> dict:
    """A GitHub project's latest release (its tag and files)."""
    page = netsafe.fetch(f"{GITHUB_API}/{repository}/releases/latest")
    if page is None:
        raise NotFound(f"No release of {repository}")
    return json.loads(page)


def release_file(release: dict, name: str) -> str:
    """The download address of one of a release's files, by its exact name."""
    for asset in release["assets"]:
        if asset["name"] == name:
            return asset["browser_download_url"]
    raise NotFound(f"No {name} in {release['tag_name']}")


def release_file_ending(release: dict, ending: str) -> tuple[str, str]:
    """(name, address) of the release's file whose name ends with `ending`."""
    for asset in release["assets"]:
        if asset["name"].endswith(ending):
            return asset["name"], asset["browser_download_url"]
    raise NotFound(f"No file ending {ending} in {release['tag_name']}")


def version_key(text: str) -> tuple[int, ...]:
    """A version's numbers, for comparing ("29.10.0-1" after "29.9.2-1")."""
    return tuple(int(n) for n in re.findall(r"\d+", text))
