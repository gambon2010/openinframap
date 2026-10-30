"""scripts/osm_filter.py: the osmium pre-filter keeps what the import mapping needs."""

import subprocess
import sys

from conftest import SCRIPTS


def test_filter_includes_the_forks_tags():
    out = subprocess.run(
        [sys.executable, str(SCRIPTS / "osm_filter.py")],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    # Upstream's infrastructure and the fork's critical sites and places.
    for expected in ("power=", "supermarket", "wholesale", "place="):
        assert expected in out, expected
