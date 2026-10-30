#!/usr/bin/env python3
# /// script
# requires-python = ">=3.11"
# dependencies = ["httpx", "psycopg2-binary"]
# ///
"""
Import infrastructure data from outside OpenStreetMap ("extra data") into the
extra schema (schema/extra.sql), for the region the database was built for.

    uv run scripts/extra_data.py list                 # sources covering the built region
    uv run scripts/extra_data.py import [SOURCE ...]  # import them (all by default)
    uv run scripts/extra_data.py remove SOURCE        # remove an import

Importing a source replaces what it imported before, one dataset at a time:
each dataset's old rows are deleted and its new ones inserted in a single
transaction, once the new copy has downloaded. So re-running never duplicates
rows, what's done shows on the map while the rest downloads, and a failed run
keeps the previous copy of every dataset it didn't finish. extra.source.features
stays empty until a whole import has finished. The code is in scripts/extradata/:
one file per data provider (a Source class), listed in SOURCES there.
"""

import sys
from pathlib import Path

# The code is in scripts/extradata/. Run as a script, Python doesn't look next to it.
sys.path.insert(0, str(Path(__file__).resolve().parent))

from extradata import *
from extradata.base import *
from extradata.cli import *
from extradata.cli import main

if __name__ == "__main__":
    main()
