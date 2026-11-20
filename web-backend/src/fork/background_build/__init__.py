"""Fork: what's made from a background map once it's downloaded, not served: run by
scripts/offline_maps/ in the backend's image (its shapely, osmium and pmtiles
packages: docker.run_backend_module, python -m src.fork.background_build.<module>).

- zoomed_out.py: the companion, <area>.zoomed-out.pmtiles: the buildings
  (zoomed_buildings.py), roads (zoomed_roads.py, beyond_area.py, stand_lead_ins.py)
  and railways (zoomed_railways.py, close_lines.py) the background map leaves out
  zoomed out;
- loom_input.py, loom_tiles.py: the trams' and metros' lanes, <area>.transit.pmtiles
  (with transit_lines.py, line_stops.py);
- tiles.py: their tile geometry.

The files made are served by background/ (the tiles, with the companion appended;
transit.py, the lanes)."""
