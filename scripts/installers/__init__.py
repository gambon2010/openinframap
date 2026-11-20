"""Fork: installers kept for offline use in data/installers/ (scripts/fetch_installers.py):
Docker for every large Linux distribution and Windows, on Intel/AMD and ARM, and the
development tools. A computer without them is pointed there by the setup scripts.

- found.py: what an installer is (Installer), and reading the sites' listings;
- docker_linux.py: Docker's packages per distribution, and its standalone programs;
- windows.py: Docker Desktop and WSL;
- dev_tools.py: Node.js, uv, Python (for uv, offline), 7-Zip;
- readme.py: the README.txt written beside them;
- cli.py: finding them all, downloading what's missing, the manifest.
"""
