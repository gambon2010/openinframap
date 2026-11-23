"""The scripts the build runs isolated (python -I, lib/python.sh scripts_python):
each starts, finding its neighbours (data_folders, offline_maps, extradata) itself.
indoor.py and building_names.py once didn't, and the build carried on without them."""

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parent.parent


@pytest.mark.parametrize("script", ["building_names.py", "indoor.py", "extra_data.py"])
def test_starts_when_run_isolated(script):
    ran = subprocess.run(
        [sys.executable, "-I", str(SCRIPTS / script), "--help"],
        capture_output=True,
        text=True,
    )
    assert ran.returncode == 0, ran.stderr
