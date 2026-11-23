"""Fork: installers. The README.txt written beside them: which file is for which
computer, and how to install it without the internet."""

from __future__ import annotations

from .found import Installer

README = """\
Installers kept for computers without the internet (written by
scripts/fetch_installers.py on {date}; every file, its address and checksum:
manifest.json).

DOCKER ON LINUX
  bash data/installers/install-docker.sh
  It finds your distribution and installs Docker's own packages for it (folders in
  docker/linux/: Ubuntu, Debian, Fedora, and RHEL's, which are also Rocky's, Alma's
  and CentOS Stream's, each on Intel/AMD and ARM), or Docker's standalone programs
  for any other distribution (docker/linux/any-*). It asks for your password (sudo).
  A package may need something from your distribution that isn't installed (on RHEL,
  container-selinux): the error names it; install it from the distribution's DVD or
  a computer with the internet.

DOCKER ON WINDOWS (Windows 10 22H2 or 11; Intel/AMD: amd64, ARM: arm64)
  1. Install WSL: docker/windows/wsl.*.x64.msi (ARM: *.arm64.msi), then restart.
  2. Install Docker Desktop: docker/windows/Docker Desktop Installer * amd64.exe
     (ARM: arm64). Docker Desktop is free for personal use, education and small
     businesses (under 250 people and 10 million dollars); larger ones need a
     subscription.
  3. Run the app from WSL's terminal: bash run.sh, in the project's folder
     (the drive is /mnt/<its letter>).

DEVELOPMENT TOOLS (only to build regions or download maps; running the app
needs only Docker)
  dev/node/   Node.js: Linux, unpack and add its bin/ to PATH; Windows, the .msi.
  dev/uv/     uv: unpack, put `uv` in ~/.local/bin (Windows: uv.exe in PATH).
  dev/python/ Python for uv, offline (with the uv from dev/uv/: the files are the
              ones that version looks for):
              UV_PYTHON_INSTALL_MIRROR=file://<this folder>/dev/python uv python install {python}
  dev/7zip/   7-Zip, for IGN's photos: Linux, unpack and put 7zz in PATH as 7z;
              Windows, the .exe.

WHAT'S HERE
{listing}
"""


def readme(installers: list[Installer], date: str, python: str) -> str:
    """The README's text: the instructions, then every kind of installer kept."""
    kinds = sorted({installer.what for installer in installers})
    listing = "\n".join(f"  {kind}" for kind in kinds)
    return README.format(date=date, python=python, listing=listing)
