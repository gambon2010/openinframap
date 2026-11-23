"""Fork: installers. Docker Engine for Linux: Docker's own packages for each large
distribution (its documented "install from a package": the newest of each package in
https://download.docker.com/linux/<distribution>/...), and its standalone programs
for any other distribution (Docker's "install from binaries", with the Compose and
Buildx plugins and the systemd units from Docker's source)."""

from __future__ import annotations

from dataclasses import dataclass

from .found import Installer, NotFound, latest_release, links, release_file, version_key

DOCKER_LINUX = "https://download.docker.com/linux"
MOBY_SYSTEMD = "https://raw.githubusercontent.com/moby/moby/{tag}/contrib/init/systemd"
# Docker's install guide's packages (rootless-extras: docker-ce asks for it on RPM).
PACKAGES = (
    "containerd.io",
    "docker-ce",
    "docker-ce-cli",
    "docker-ce-rootless-extras",
    "docker-buildx-plugin",
    "docker-compose-plugin",
)
# Debian's names for the architectures, and RPM's.
ARCHITECTURES = {"amd64": "x86_64", "arm64": "aarch64"}
ARCHITECTURE_NAMES = {"amd64": "Intel/AMD", "arm64": "ARM"}


@dataclass(frozen=True)
class Distribution:
    family: str  # Docker's folder: ubuntu, debian, fedora, rhel
    version: str  # "24.04", "12", "44", "9": the folder in data/installers/
    name: str
    codename: str = ""  # Debian and Ubuntu: dists/<codename>

    @property
    def is_deb(self) -> bool:
        return self.family in ("ubuntu", "debian")

    def folder(self, arch: str) -> str:
        return f"docker/linux/{self.family}-{self.version}-{arch}"


# The versions still supported (November 2026). RHEL's packages are also Rocky's,
# Alma's and CentOS Stream's (install-docker.sh picks them for those).
DISTRIBUTIONS = (
    Distribution("ubuntu", "22.04", "Ubuntu 22.04 LTS", "jammy"),
    Distribution("ubuntu", "24.04", "Ubuntu 24.04 LTS", "noble"),
    Distribution("ubuntu", "26.04", "Ubuntu 26.04 LTS", "resolute"),
    Distribution("ubuntu", "26.10", "Ubuntu 26.10", "stonking"),
    Distribution("debian", "12", "Debian 12", "bookworm"),
    Distribution("debian", "13", "Debian 13", "trixie"),
    Distribution("fedora", "43", "Fedora 43"),
    Distribution("fedora", "44", "Fedora 44"),
    Distribution("fedora", "45", "Fedora 45"),
    Distribution("rhel", "8", "RHEL, Rocky, Alma, CentOS Stream 8"),
    Distribution("rhel", "9", "RHEL, Rocky, Alma, CentOS Stream 9"),
    Distribution("rhel", "10", "RHEL, Rocky, Alma, CentOS Stream 10"),
)


def docker_packages(distribution: Distribution, arch: str) -> list[Installer]:
    """The newest of each of Docker's packages for a distribution and architecture."""
    listing = package_listing(distribution, arch)
    names = links(listing)
    what = f"Docker for {distribution.name}, {ARCHITECTURE_NAMES[arch]}"
    found = []
    for package in PACKAGES:
        name = newest(names, package, distribution.is_deb)
        if name is None:
            raise NotFound(f"No {package} in {listing}")
        found.append(
            Installer(listing + name, f"{distribution.folder(arch)}/{name}", what)
        )
    return found


def package_listing(distribution: Distribution, arch: str) -> str:
    """Where Docker lists a distribution's packages for an architecture."""
    if distribution.is_deb:
        return f"{DOCKER_LINUX}/{distribution.family}/dists/{distribution.codename}/pool/stable/{arch}/"
    rpm_arch = ARCHITECTURES[arch]
    return f"{DOCKER_LINUX}/{distribution.family}/{distribution.version}/{rpm_arch}/stable/Packages/"


def newest(names: list[str], package: str, is_deb: bool) -> str | None:
    """The file of a package's newest version among a listing's names (docker-ce,
    not docker-ce-cli: the version must follow the name)."""
    ending = ".deb" if is_deb else ".rpm"
    joiner = "_" if is_deb else "-"
    versions = {}
    for name in names:
        rest = name.removeprefix(package + joiner)
        if rest != name and rest[:1].isdigit() and name.endswith(ending):
            versions[name] = version_key(rest.split(":")[-1])
    return max(versions, key=versions.__getitem__) if versions else None


def static_programs(arch: str) -> list[Installer]:
    """Docker's standalone programs, for a distribution without packages here."""
    rpm_arch = ARCHITECTURES[arch]
    folder = f"docker/linux/any-{arch}"
    what = f"Docker for any Linux, {ARCHITECTURE_NAMES[arch]}"
    listing = f"{DOCKER_LINUX}/static/stable/{rpm_arch}/"
    archives = [
        name
        for name in links(listing)
        if name.startswith("docker-") and name.endswith(".tgz")
    ]
    docker = max(archives, key=version_key)
    compose = latest_release("docker/compose")
    compose_name = f"docker-compose-linux-{rpm_arch}"
    buildx = latest_release("docker/buildx")
    buildx_name = f"buildx-{buildx['tag_name']}.linux-{arch}"
    return [
        Installer(listing + docker, f"{folder}/{docker}", what),
        Installer(
            release_file(compose, compose_name), f"{folder}/docker-compose", what
        ),
        Installer(release_file(buildx, buildx_name), f"{folder}/docker-buildx", what),
    ]


def systemd_units() -> list[Installer]:
    """Docker's own systemd units (its source's contrib/init/systemd), which the
    standalone programs don't bring: install-docker.sh puts them in place."""
    tag = latest_release("moby/moby")["tag_name"]
    base = MOBY_SYSTEMD.format(tag=tag)
    what = "Docker's systemd units, for the standalone programs"
    return [
        Installer(f"{base}/{unit}", f"docker/linux/systemd/{unit}", what)
        for unit in ("docker.service", "docker.socket")
    ]


def all_linux() -> list[Installer]:
    found = [
        i
        for d in DISTRIBUTIONS
        for arch in ARCHITECTURES
        for i in docker_packages(d, arch)
    ]
    found += [i for arch in ARCHITECTURES for i in static_programs(arch)]
    return found + systemd_units()
