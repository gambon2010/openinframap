"""
Fork: following a power line through the grid network (schema/grid.sql), from a
clicked piece to the stations at its ends: GET /grid/line (grid/line.py) and the check of
the whole network (grid_check.py).

The network (lines of 10 kV and more, split into stretches between junctions) is
loaded once into memory (`GridIndex`) and reloaded when the grid is rebuilt. A way
carrying several voltages ("225000;63000", two lines on the same pylons) belongs to
each of them.

A line is followed through junctions (pylons where OSM ways join, or that lines
share), never through stations, and only along what continues it:
- the same OSM way;
- a way with the same name, compared by the places it joins ("Liaison 225 kV n°1
  A - B" = "a - b"; ";" separates the lines of shared pylons);
- where its way ends: the single way starting there that has no other line's name,
  or where several start (a double line splitting in two near a substation), the
  straightest if clearly so, else the one leading to a station named after one of
  its places. If none can be told, the first stretch of each is shown, not followed.
Every place the trace stops at something other than a station is a loose end, with
the reason (`Trace.loose`): those are where the map's data is probably wrong.

- network.py: the network in memory (GridIndex, load_index);
- names.py: comparing ways' names by the places they join;
- trace.py: following a line (trace_line), what continues it at each junction.
"""

from .names import CIRCUIT, LineEnds, line_ends, place, same_line, shares_a_place
from .network import Edge, GridIndex, Node, Vector, grid_version, load_index, voltages_of
from .trace import Trace, trace_line, turn

__all__ = [
    "CIRCUIT",
    "Edge",
    "GridIndex",
    "LineEnds",
    "Node",
    "Trace",
    "Vector",
    "grid_version",
    "line_ends",
    "load_index",
    "place",
    "same_line",
    "shares_a_place",
    "trace_line",
    "turn",
    "voltages_of",
]
