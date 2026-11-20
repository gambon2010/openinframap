#!/usr/bin/env python3
"""
Installers kept for offline use in data/installers/: Docker for every large Linux
distribution and Windows (Intel/AMD and ARM) and the development tools (the code:
scripts/installers/). Run again to add what's new; what's there stays.

    uv run --project scripts scripts/fetch_installers.py [--list] [--only linux|windows|dev]
"""

from __future__ import annotations

import sys
from pathlib import Path

# The code is in scripts/installers/. Run as a script (python -I), Python doesn't look next to it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from installers.cli import main
from netsafe import run_until_connected

if __name__ == "__main__":
    run_until_connected(main)
