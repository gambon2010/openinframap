"""
Critical sites: health and emergency services, government offices, places of
worship, fuel and weapons, transport hubs, military sites, food supply, dams and
landfills.

Fork-only. One table for all of them (points and areas); schema/sites.sql sorts
them into categories and kinds (e.g. a storage tank only counts if it holds fuel)
and decides how important each is. See docs/FORK_CHANGES.md.
"""

from funcs import table, str_col, type_col

# The matched key and value are kept as columns (handy, and upstream used to exclude
# amenity, office, shop... from the stored tags: imposm then can't match on them
# either, so main.py no longer excludes them).
key_col = {"name": "key", "type": "mapping_key"}

SITES = {
    # health and emergency
    "amenity": [
        "hospital",
        "clinic",
        "pharmacy",
        "fire_station",
        "police",
        # government and public services
        "townhall",
        "courthouse",
        "prison",
        "embassy",
        "university",
        # religion
        "place_of_worship",
        # fuel
        "fuel",
    ],
    "healthcare": ["hospital", "clinic", "centre", "pharmacy"],
    "emergency": ["ambulance_station", "siren"],
    "office": ["government", "diplomatic"],
    # fuel and weapons
    "industrial": ["fuel_depot", "oil_storage", "port", "slaughterhouse", "distributor"],
    "man_made": ["storage_tank", "silo", "monitoring_station"],
    "shop": ["weapons", "wholesale", "supermarket"],
    "craft": ["gunsmith"],
    # transport
    "aeroway": ["aerodrome"],
    "harbour": ["yes"],
    "barrier": ["border_control"],
    "railway": ["yard"],
    # military (in use, and disused fortifications: bunkers, trenches...)
    "landuse": ["military", "port", "landfill"],
    "military": ["__any__"],
    # water and waste
    "waterway": ["dam"],
}

table(
    "site",
    SITES,
    ["points", "polygons"],
    columns=[key_col, type_col, str_col("name")],
)
