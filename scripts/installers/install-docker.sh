#!/usr/bin/env bash
# Fork: installs Docker from the installers beside this file, without the internet
# (copied into data/installers/ by scripts/fetch_installers.py).
#
#   bash data/installers/install-docker.sh
#
# Your distribution's own Docker packages if they're here (docker/linux/<id>-<version>-
# <arch>: Ubuntu, Debian, Fedora, and RHEL's for Rocky, Alma and CentOS Stream too),
# else Docker's standalone programs (docker/linux/any-<arch>, with Docker's systemd
# units). Then Docker is started, at every boot too, and your user may use it.
#
# For its tests: OS_RELEASE (default /etc/os-release), MACHINE (default uname -m),
# DRY_RUN=1 (say the commands, run none).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LINUX="$HERE/docker/linux"
OS_RELEASE="${OS_RELEASE:-/etc/os-release}"
MACHINE="${MACHINE:-$(uname -m)}"
DRY_RUN="${DRY_RUN:-0}"

main() {
    local arch packages
    if [[ "$DRY_RUN" != 1 ]] && command -v docker >/dev/null 2>&1; then
        echo "Docker is already installed ($(docker --version))."
        exit 0
    fi
    arch=$(architecture)
    packages=$(packages_folder "$arch")
    if [[ -n "$packages" ]]; then
        echo "Installing Docker's packages for $(basename "$packages")..."
        install_packages "$packages"
    else
        echo "No Docker packages here for this distribution: installing Docker's standalone programs."
        install_standalone "$LINUX/any-$arch"
    fi
    start_docker
    echo "Docker is installed. Log out and back in (or restart), then: docker run hello-world"
}

# Debian's name for this computer's architecture.
architecture() {
    case "$MACHINE" in
        x86_64 | amd64) echo amd64 ;;
        aarch64 | arm64) echo arm64 ;;
        *) die "No Docker for this computer's processor ($MACHINE): only Intel/AMD and ARM 64-bit." ;;
    esac
}

# The folder of this distribution's packages, empty if there's none.
packages_folder() {
    local arch="$1" id version folder
    id=$(os_value ID)
    version=$(os_value VERSION_ID)
    case "$id" in
        ubuntu | debian | fedora) folder="$LINUX/$id-$version-$arch" ;;
        # RHEL's packages are theirs too, by major version.
        rhel | rocky | almalinux | centos) folder="$LINUX/rhel-${version%%.*}-$arch" ;;
        *) folder="" ;;
    esac
    if [[ -n "$folder" && -d "$folder" ]]; then
        echo "$folder"
    fi
}

# A value of os-release (ID, VERSION_ID), without its quotes.
os_value() {
    local name="$1"
    sed -n "s/^$name=//p" "$OS_RELEASE" | tr -d '"'
}

install_packages() {
    local folder="$1"
    if compgen -G "$folder/*.deb" >/dev/null; then
        run sudo apt-get install -y "$folder"/*.deb
    else
        # Only what's installed may fill a dependency: there's no internet to ask.
        run sudo dnf install -y --disablerepo='*' "$folder"/*.rpm
    fi
}

# Docker's "install from binaries": the programs in /usr/local/bin, the plugins
# where Docker looks for them, its systemd units pointed there.
install_standalone() {
    local folder="$1" plugins=/usr/local/lib/docker/cli-plugins
    [[ -d "$folder" ]] || die "No standalone programs in $folder."
    run sudo tar -xzf "$folder"/docker-*.tgz -C /usr/local/bin --strip-components=1
    run sudo install -D -m 755 "$folder/docker-compose" "$plugins/docker-compose"
    run sudo install -D -m 755 "$folder/docker-buildx" "$plugins/docker-buildx"
    run sudo install -m 644 "$LINUX/systemd/docker.socket" /etc/systemd/system/docker.socket
    run sudo sh -c "sed 's#/usr/bin/dockerd#/usr/local/bin/dockerd#' '$LINUX/systemd/docker.service' > /etc/systemd/system/docker.service"
    run sudo groupadd -f docker
    run sudo systemctl daemon-reload
}

start_docker() {
    run sudo systemctl enable --now docker
    run sudo usermod -aG docker "${SUDO_USER:-$USER}"
}

run() {
    if [[ "$DRY_RUN" == 1 ]]; then
        echo "+ $*"
    else
        "$@"
    fi
}

die() {
    echo "ERROR: $*" >&2
    exit 1
}

main "$@"
