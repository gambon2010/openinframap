"""Fork: the search box (search/__init__.py): the order of results of every kind together."""

# Place types (fork: imposm/places.py), most important first. Countries down to
# towns rank above infrastructure with an equally good name match; smaller
# places below it.
PLACE_ORDER = [
    "country",
    "state",
    "province",
    "region",
    "county",
    "city",
    "municipality",
    "town",
    "archipelago",
    "island",
    "borough",
    "suburb",
    "village",
    "quarter",
    "islet",
    "hamlet",
    "neighbourhood",
]


MAJOR_PLACES = set(PLACE_ORDER[: PLACE_ORDER.index("island") + 1])


def result_tier(row: dict) -> int:
    """0 = big places, 1 = infrastructure, 2 = small places (for equally good matches)."""
    if row["type"] != "place":
        return 1
    return 0 if row["place_type"] in MAJOR_PLACES else 2


def sort_key(row: dict) -> int:
    if row["type"] == "substation" and row["voltage"]:
        return row["voltage"] // 1000

    if row["type"] == "plant" and row["output"]:
        return row["output"] // 1000000

    if row["type"] == "place" and row["population"]:
        return row["population"]

    return 0
