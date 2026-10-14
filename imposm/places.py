"""
Places (countries down to hamlets and neighbourhoods) for the local search box.

Fork-only: upstream searches places online with OpenCage; this fork searches
them in the local database so the search box works offline. See
docs/FORK_CHANGES.md.
"""

from funcs import table, tables, type_col, str_col

# Settlements and islands are also mapped as areas (often without a point), so
# both are imported; the search uses a point inside the area.
AREA_PLACES = [
    "city",
    "town",
    "village",
    "hamlet",
    "borough",
    "suburb",
    "quarter",
    "neighbourhood",
    "island",
    "islet",
]
# Big administrative places: points only. Their areas are huge outlines that
# would bloat the pre-filtered extract (Russia: 53 MB -> 135 MB) for nothing,
# as the search only needs one point per place.
POINT_ONLY_PLACES = [
    "country",
    "state",
    "province",
    "region",
    "county",
    "municipality",
    "archipelago",
]

table(
    "place",
    {"place": POINT_ONLY_PLACES + AREA_PLACES},
    ["points", "polygons"],
    columns=[type_col, str_col("name"), str_col("population")],
)
tables["place"]["type_mappings"]["polygons"] = {"place": AREA_PLACES}
