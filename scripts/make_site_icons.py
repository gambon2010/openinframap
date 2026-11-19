#!/usr/bin/env python3
"""
Make the critical-site icons (web/src/icons/site_*.svg): a Maki glyph in a white
circle ringed in its category's colour, and a plain disc per category for groups. Maki is Mapbox's map icon set, CC0.

    npm pack @mapbox/maki@8.2.0 && tar xzf mapbox-maki-8.2.0.tgz
    python3 scripts/make_site_icons.py package/icons

Kinds and categories are those of schema/fork/sites.sql (and oil_facility, Oil & Natural Gas's); the colours must match
web/src/fork/modules/sites/style.ts.
"""

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "web" / "src" / "icons"

COLOURS = {
    "health": "#D32F2F",
    "government": "#A67C00",
    "police": "#1A237E",
    "religion": "#6A1B9A",
    "fuel": "#E65100",
    "transport": "#455A64",
    "military": "#2E7D32",
    # A kind's colour within its category, with groups of its own (grey among the
    # military: modules/sites/style.ts KIND_COLOURS, sites.sql's site_group).
    "military_disused": "#8D8D8D",
    "food": "#795548",
    "water_waste": "#00838F",
}

# kind -> (category, Maki icon, or None for a glyph drawn here)
KINDS = {
    "hospital": ("health", "hospital"),
    "clinic": ("health", "doctor"),
    "pharmacy": ("health", "pharmacy"),
    "fire_station": ("health", "fire-station"),
    "ambulance": ("health", "emergency-phone"),
    "siren": ("health", "caution"),
    "gendarmerie": ("police", None),  # a flaming grenade, drawn here
    "police_national": ("police", "police"),
    "police_municipal": ("police", "town"),
    "police": ("police", None),  # a plain shield, drawn here
    "townhall": ("government", "town-hall"),
    "tax": ("government", "bank"),
    "prefecture": ("government", None),  # a building flying a flag, drawn here
    "social": ("government", "heart"),
    "employment": ("government", "suitcase"),
    "customs": ("police", "toll"),
    "national": ("government", "landmark"),
    "government": ("government", "building"),
    "courthouse": ("government", None),  # scales, drawn here
    "prison": ("government", "prison"),
    "embassy": ("government", "embassy"),
    "university": ("government", "college"),
    "christian": ("religion", "religious-christian"),
    "muslim": ("religion", "religious-muslim"),
    "jewish": ("religion", "religious-jewish"),
    "buddhist": ("religion", "religious-buddhist"),
    "worship": ("religion", "place-of-worship"),  # also Hindu and Sikh (no Maki icon)
    "fuel": ("fuel", "fuel"),
    "storage_tank": ("fuel", None),  # a tank, drawn here
    # Not a site kind: Oil & Natural Gas's facilities (modules/sites/petroleum.ts).
    "oil_facility": ("fuel", "industry"),
    "airport": ("transport", "airport"),
    "port": ("transport", "harbor"),
    "border": ("police", "roadblock"),
    "rail_yard": ("transport", "rail"),
    "military_area": ("military", "fence"),
    "military_base": ("military", "star"),
    "military_school": ("military", "school"),
    "military_office": ("military", "lift-gate"),
    "military_depot": ("military", None),  # cartridges, drawn here
    "military_range": ("military", "danger"),
    "military_fort": ("military", "castle"),  # in use: green; disused, the same grey
    "military_radio": ("military", "communications-tower"),
    "military_disused": ("military_disused", "castle"),
    "silo": ("food", "farm"),
    "slaughterhouse": ("food", "slaughterhouse"),
    "distribution": ("food", "warehouse"),
    "wholesale": ("food", "grocery"),
    "supermarket": ("food", "commercial"),
    "convenience": ("food", "convenience"),
    "dam": ("water_waste", "dam"),
    "landfill": ("water_waste", "waste-basket"),
    "weather": ("water_waste", "observation-tower"),
}

# Glyphs Maki doesn't have, on its 15x15 grid.
OWN = {
    # The state's office: a pillared building, a flag above it.
    "prefecture": '<path d="M2 14h11v-1H2zM3 12.5h9V7H3zM2.5 6.5h10L7.5 4.2z"/>'
    '<path d="M4.3 8h1.2v3.7H4.3zM6.9 8h1.2v3.7H6.9zM9.5 8h1.2v3.7H9.5z" fill="#fff"/>'
    '<path d="M7.2 0.6h0.6v3.7h-0.6z"/><path d="M7.8 0.8h3.4v1.8H7.8z"/>',
    # Police, the force not given: a plain badge.
    "police": '<path d="M7.5 0.8 13.2 3v4.4c0 3.5-2.5 5.8-5.7 6.9-3.2-1.1-5.7-3.4-5.7-6.9V3z"/>'
    '<path d="M7.5 3.3l1 2 2.2 0.3-1.6 1.6 0.4 2.2-2-1-2 1 0.4-2.2-1.6-1.6 2.2-0.3z" fill="#fff"/>',
    # Ammunition: three cartridges, a pointed tip on each, standing on a rim.
    "military_depot": '<path d="M1.6 7c0-2.6 1.4-5 1.4-5s1.4 2.4 1.4 5v5.4H1.6z'
    'M6.1 7c0-2.6 1.4-5 1.4-5s1.4 2.4 1.4 5v5.4H6.1zM10.6 7c0-2.6 1.4-5 1.4-5s1.4 2.4 1.4 5v5.4h-2.8z"/>'
    '<path d="M1.2 13h3.6v1.2H1.2zM5.7 13h3.6v1.2H5.7zM10.2 13h3.6v1.2h-3.6z"/>'
    '<path d="M1.6 7.2h2.8M6.1 7.2h2.8M10.6 7.2h2.8" fill="none" stroke="#fff" stroke-width="0.6"/>',
    # The gendarmerie's badge: a grenade with its flame.
    "gendarmerie": '<path d="M7.5 0.4c1.6 0.9 1.9 2.1 1.2 3 1.2-0.2 1.9-1 2-2.1 1 1.2 0.8 2.6-0.4 3.4H4.7c-1.2-0.8-1.4-2.2'
    '-0.4-3.4 0.1 1.1 0.8 1.9 2 2.1-0.7-0.9-0.4-2.1 1.2-3z"/><path d="M6 5.3h3v1.2H6z"/><circle cx="7.5" cy="10.4" r="4.2"/>',
    # Scales: a post on a base, a beam, a pan hanging at each end.
    "courthouse": '<path d="M7 2h1v10.5H7z M4 12.5h7V14H4z M1.5 3h12v1h-12z"/>'
    '<path d="M2 4 0.5 8.5M2 4l1.5 4.5M13 4l-1.5 4.5M13 4l1.5 4.5" fill="none" stroke="currentColor" stroke-width="0.8"/>'
    '<path d="M0 8.5h4a2 1.6 0 0 1-4 0z M11 8.5h4a2 1.6 0 0 1-4 0z"/>',
    "storage_tank": '<path d="M2.5 3.5c0-1.1 2.2-2 5-2s5 0.9 5 2v8c0 1.1-2.2 2-5 2s-5-0.9-5-2z"/>'
    '<path d="M2.5 3.5c0 1.1 2.2 2 5 2s5-0.9 5-2M2.5 8c0 1.1 2.2 2 5 2s5-0.9 5-2" fill="none" stroke="#fff" stroke-width="1"/>',
}


def glyph(maki: Path, name: str) -> str:
    """The inside of a Maki SVG (its paths), without the <svg> wrapper."""
    svg = (maki / f"{name}.svg").read_text()
    inner = re.search(r"<svg[^>]*>(.*)</svg>", svg, re.DOTALL).group(1)
    return re.sub(r"\s+id=\"[^\"]*\"", "", inner).strip()


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    maki = Path(sys.argv[1])
    for kind, (category, icon) in KINDS.items():
        colour = COLOURS[category]
        inner = OWN[kind] if icon is None else glyph(maki, icon)
        svg = f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Fork: critical site "{kind}" ({category}). Generated by scripts/make_site_icons.py;
     glyph: {"drawn here" if icon is None else f"Maki {icon} (CC0)"}. -->
<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 30 30">
  <circle cx="15" cy="15" r="13.5" fill="#fff" stroke="{colour}" stroke-width="2.2"/>
  <g transform="translate(7.5 7.5)" fill="{colour}" color="{colour}">{inner}</g>
</svg>
"""
        (OUT / f"site_{kind}.svg").write_text(svg)
    # A group of nearby sites (modules/sites/style.ts writes the count on it): a disc in
    # the category's colour (or its kind's: disused military).
    for category, colour in COLOURS.items():
        svg = f"""<?xml version="1.0" encoding="utf-8"?>
<!-- Fork: a group of critical sites ({category}). Generated by scripts/make_site_icons.py. -->
<svg xmlns="http://www.w3.org/2000/svg" width="30px" height="30px" viewBox="0 0 30 30">
  <circle cx="15" cy="15" r="13.5" fill="{colour}" stroke="#fff" stroke-width="2.2"/>
</svg>
"""
        (OUT / f"site_group_{category}.svg").write_text(svg)
    print(f"{len(KINDS)} icons and {len(COLOURS)} group icons in {OUT}")


if __name__ == "__main__":
    main()
