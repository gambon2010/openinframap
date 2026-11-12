"""
Fork: offline satellite imagery (scripts/satellite.py is the command line). The
modules, by what they do: sources, tiles, estimate, download, gdal, bdortho, aerial,
regions, inventory, coverage, extract, ui, maps (the menu), cli.
Everything is also available from here (and from satellite.py) for the tests.
"""

from .aerial import *
from .cli import *
from .download import *
from .estimate import *
from .gdal import *
from .inventory import attribution_for as attribution_for
from .regions import *
from .sources import *
from .tiles import *
