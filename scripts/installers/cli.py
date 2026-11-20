"""Fork: installers. Finding them all, downloading what isn't there yet, and writing
the manifest, the README and install-docker.sh beside them."""

from __future__ import annotations

import argparse
import datetime
import hashlib
import json
import shutil
from collections.abc import Callable
from pathlib import Path

import data_folders
import netsafe

from . import dev_tools
from .dev_tools import all_dev_tools
from .docker_linux import all_linux
from .found import Installer, NotFound
from .readme import readme
from .windows import all_windows

INSTALL_DOCKER = Path(__file__).with_name("install-docker.sh")
MANIFEST = "manifest.json"
KINDS: dict[str, Callable[[], list[Installer]]] = {
    "linux": all_linux,
    "windows": all_windows,
    "dev": all_dev_tools,
}


def main(argv: list[str] | None = None) -> None:
    args = parser().parse_args(argv)
    installers = find_all(args.only or list(KINDS))
    if args.list:
        for installer in installers:
            print(f"{installer.file}\n    {installer.url}")
        print(f"{len(installers)} files")
        return
    folder = Path(args.folder)
    download_missing(installers, folder)
    write_beside(installers, folder)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--folder", default=str(data_folders.INSTALLERS_DIR))
    p.add_argument(
        "--only",
        action="append",
        choices=list(KINDS),
        help="only these kinds (repeatable)",
    )
    p.add_argument(
        "--list",
        action="store_true",
        help="say what would be downloaded, download nothing",
    )
    return p


def find_all(kinds: list[str]) -> list[Installer]:
    """Every installer of these kinds, as the sites list them now."""
    found = []
    for kind in kinds:
        netsafe.say(f"Looking up {kind}...")
        try:
            found += KINDS[kind]()
        except NotFound as missing:
            raise SystemExit(
                f"Can't find an installer ({missing}): its site changed; scripts/installers/ needs updating."
            )
    return found


def download_missing(installers: list[Installer], folder: Path) -> None:
    """Each installer not already there (a stopped download goes on where it was)."""
    for n, installer in enumerate(installers, 1):
        path = folder / installer.file
        if path.exists():
            continue
        netsafe.say(f"[{n}/{len(installers)}] {installer.file}")
        path.parent.mkdir(parents=True, exist_ok=True)
        netsafe.fetch_file(installer.url, path)


def write_beside(installers: list[Installer], folder: Path) -> None:
    """The manifest (each file's address, size, checksum), the README and the Linux
    install script, beside the installers."""
    entries = [manifest_entry(installer, folder) for installer in installers]
    (folder / MANIFEST).write_text(json.dumps(entries, indent=1) + "\n")
    today = datetime.date.today().isoformat()
    (folder / "README.txt").write_text(readme(installers, today, dev_tools.PYTHON))
    shutil.copy(INSTALL_DOCKER, folder / INSTALL_DOCKER.name)
    total = sum(entry["bytes"] for entry in entries)
    netsafe.say(
        f"{len(entries)} installers, {total / 1e9:.1f} GB, in {folder} (README.txt says which is which)."
    )


def manifest_entry(installer: Installer, folder: Path) -> dict:
    path = folder / installer.file
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return {
        "file": installer.file,
        "what": installer.what,
        "url": installer.url,
        "bytes": path.stat().st_size,
        "sha256": digest.hexdigest(),
    }
