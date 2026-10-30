"""
Fork: offline satellite imagery (scripts/satellite.py is the command line). The
modules, by what they do: sources, tiles, estimate, download, gdal, menu, cli.
Everything is also available from here (and from satellite.py) for the tests.
"""

from .cli import *
from .download import *
from .estimate import *
from .gdal import *
from .menu import *
from .sources import *
from .tiles import *
