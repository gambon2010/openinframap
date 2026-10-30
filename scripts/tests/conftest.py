"""Tests for the fork's setup scripts. Run from the repository root:

    uv run --with pytest --with httpx --with psycopg2-binary pytest scripts/tests

They don't touch the database, Docker or the network (a local HTTP server stands in
for tile servers).
"""

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SCRIPTS))
