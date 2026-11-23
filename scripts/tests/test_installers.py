"""scripts/installers/: picking the newest packages from a listing, and
install-docker.sh choosing what to install for a computer (run with DRY_RUN=1:
it only says the commands)."""

import os
import subprocess
from pathlib import Path

from installers.docker_linux import newest
from installers.found import version_key

INSTALL_DOCKER = (
    Path(__file__).resolve().parents[1] / "installers" / "install-docker.sh"
)


def test_the_newest_of_a_package_and_not_its_namesakes():
    names = [
        "docker-ce_29.9.2-1~ubuntu.24.04~noble_amd64.deb",
        "docker-ce_29.10.0-1~ubuntu.24.04~noble_amd64.deb",
        "docker-ce-cli_29.11.0-1~ubuntu.24.04~noble_amd64.deb",
        "docker-ce_5:28.0.0-1~ubuntu.24.04~noble_amd64.deb",
    ]
    assert (
        newest(names, "docker-ce", is_deb=True)
        == "docker-ce_29.10.0-1~ubuntu.24.04~noble_amd64.deb"
    )
    rpms = [
        "docker-ce-29.10.0-1.fc44.x86_64.rpm",
        "docker-ce-cli-29.11.0-1.fc44.x86_64.rpm",
    ]
    assert (
        newest(rpms, "docker-ce", is_deb=False) == "docker-ce-29.10.0-1.fc44.x86_64.rpm"
    )
    assert newest(rpms, "containerd.io", is_deb=False) is None


def test_versions_compare_by_their_numbers():
    assert version_key("29.10.0-1") > version_key("29.9.2-1")


def installers(tmp_path: Path) -> Path:
    """An installers folder with a few distributions' packages."""
    linux = tmp_path / "docker" / "linux"
    for folder, package in (
        ("ubuntu-24.04-amd64", "docker-ce_29.10.0-1_amd64.deb"),
        ("rhel-9-arm64", "docker-ce-29.10.0-1.el9.aarch64.rpm"),
        ("any-amd64", "docker-29.10.0.tgz"),
    ):
        (linux / folder).mkdir(parents=True)
        (linux / folder / package).touch()
    script = tmp_path / "install-docker.sh"
    script.write_text(INSTALL_DOCKER.read_text())
    return script


def install(script: Path, os_release: str, machine: str) -> subprocess.CompletedProcess:
    release = script.parent / "os-release"
    release.write_text(os_release)
    env = {**os.environ, "OS_RELEASE": str(release), "MACHINE": machine, "DRY_RUN": "1"}
    return subprocess.run(
        ["bash", str(script)], check=False, capture_output=True, text=True, env=env
    )


def test_a_distributions_own_packages(tmp_path):
    script = installers(tmp_path)
    ubuntu = install(script, 'ID=ubuntu\nVERSION_ID="24.04"\n', "x86_64")
    assert ubuntu.returncode == 0, ubuntu.stderr
    assert (
        "apt-get install -y" in ubuntu.stdout
        and "ubuntu-24.04-amd64/docker-ce_" in ubuntu.stdout
    )
    assert "systemctl enable --now docker" in ubuntu.stdout
    # Rocky 9.4 on ARM: RHEL 9's packages, nothing asked of the internet.
    rocky = install(script, 'ID="rocky"\nVERSION_ID="9.4"\n', "aarch64")
    assert (
        "dnf install -y --disablerepo=*" in rocky.stdout
        and "rhel-9-arm64" in rocky.stdout
    )


def test_any_other_distribution_gets_the_standalone_programs(tmp_path):
    script = installers(tmp_path)
    arch = install(script, "ID=arch\n", "x86_64")
    assert arch.returncode == 0, arch.stderr
    assert "standalone programs" in arch.stdout
    assert "any-amd64/docker-29.10.0.tgz -C /usr/local/bin" in arch.stdout
    # A known distribution in a version not kept here: the same.
    old = install(script, 'ID=ubuntu\nVERSION_ID="20.04"\n', "x86_64")
    assert "standalone programs" in old.stdout


def test_an_unknown_processor_is_said(tmp_path):
    script = installers(tmp_path)
    result = install(script, "ID=ubuntu\n", "riscv64")
    assert result.returncode == 1
    assert "only Intel/AMD and ARM" in result.stderr
