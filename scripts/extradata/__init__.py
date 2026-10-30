"""
Fork: extra data, infrastructure from outside OpenStreetMap (scripts/extra_data.py
is the command line). base.py has what every source shares; each source is a
file (a Source class). To add one: a file here, and a line in SOURCES below.
"""

from .agence_ore import FranceAgenceORE
from .base import *
from .france import FrenchSource
from .georisques_icpe import GeorisquesICPE

SOURCES: dict[str, Source] = {
    source.id: source for source in [FranceAgenceORE(), GeorisquesICPE()]
}

__all__ = ["SOURCES", "FranceAgenceORE", "FrenchSource", "GeorisquesICPE"]
