"""
Fork: the power grid's routes (schema/grid.sql's network):

- route.py: paths between two stations (GET /grid/route);
- line.py: where a clicked power line goes (GET /grid/line/<osm_id>);
- tower.py: a tower's numbers along its lines (GET /grid/tower/<osm_id>).
"""

from starlette.routing import Route

from .line import circuit_of, line
from .route import build_graph, describe, distinct_paths, parse_station, route
from .tower import tower

routes = [
    Route("/grid/route", endpoint=route),
    Route("/grid/line/{osm_id}", endpoint=line),
    Route("/grid/tower/{osm_id}", endpoint=tower),
]

__all__ = ["build_graph", "circuit_of", "describe", "distinct_paths", "parse_station", "routes"]
