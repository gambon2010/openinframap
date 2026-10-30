#!/usr/bin/env python3
"""
Make the symbol catalogue of "My layers" (web/src/fork/userlayers/symbols-2525c.json):
the MIL-STD-2525C point symbols ODINv2 offers, with their names, for the symbol
palette. The symbols themselves are drawn in the browser by @syncpoint/signs (MIT),
the library ODINv2 uses; ODINv2's own code and catalogue are AGPL, so they aren't
used. The names and codes come from the MIT-licensed tables of
https://github.com/spatialillusions/mil-std-2525 (Måns Beckman):

    npm pack mil-std-2525@0.2.8 && tar xzf mil-std-2525-0.2.8.tgz
    python3 scripts/make_symbol_catalog.py package/tsv-tables/2525c

Tactical graphics are included: point ones are drawn by signs like the other
symbols; lines, areas and arrows (4th field "L", "A" or "M") are drawn by the C5ISR
renderer (@armyc2.c5isr.renderer/mil-sym-ts-web, Apache-2.0) from the points the user
clicks (web/src/fork/userlayers/graphics.ts).
"""

import csv
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUT = REPO_ROOT / "web" / "src" / "fork" / "userlayers" / "symbols-2525c.json"

# Tables in palette order (infrastructure and emergencies first), with group names.
TABLES = [
    ("emergency-management", "Emergency management"),
    ("ground-installation", "Installations"),
    ("ground-equipment", "Ground equipment"),
    ("ground-unit", "Ground units"),
    ("stability-operations", "Stability operations"),
    ("air", "Air"),
    ("sea-surface", "Sea surface"),
    ("sub-surface", "Subsurface"),
    ("sof", "Special operations forces"),
    ("space", "Space"),
    ("signals-intelligence", "Signals intelligence"),
]

# Tactical graphics, by the second part of their hierarchy (TACGRP.<section>).
GRAPHIC_SECTIONS = [
    ("TSK", "Tasks"),
    ("C2GM", "Command, control and manoeuvre"),
    ("MOBSU", "Mobility and survivability"),
    ("FSUPP", "Fire support"),
    ("CSS", "Combat service support"),
    ("OTH", "Other graphics"),
]
# Geometry column -> the 4th field of an entry (none: a point symbol).
GEOMETRY = {"POINT": None, "LINE": "L", "POLYGON": "A", "MULTIPOINT": "M"}

# Kept in capitals when sentence-casing the names.
ACRONYMS = {
    "AEW", "APC", "ASW", "ATGM", "ATM", "C2", "CBRN", "CSAR", "EOD", "ECM", "ESM", "EW", "HQ", "IED",
    "IFV", "LORAN", "MEDEVAC", "MLRS", "MP", "NATO", "NBC", "POL", "RPG", "SAM", "SIGINT", "SOF",
    "TACAN", "UAV", "UGV", "UN", "US", "VIP", "VHF", "UHF", "HF", "EHF", "SHF", "VLF", "LF", "MF",
    "GPS", "IFF", "SATCOM", "TV", "CIVIL", "RADAR",
}


def title(name: str) -> str:
    """'CIVIL RIOTING' -> 'Civil rioting', keeping acronyms ('SOF', '(UAV)')."""
    out = []
    for i, word in enumerate(name.strip().split()):
        bare = word.strip("()/,.-")
        if bare in ACRONYMS - {"CIVIL", "RADAR"} or (word.startswith("(") and word.endswith(")") and len(bare) <= 6):
            out.append(word)
        else:
            out.append(word.capitalize() if i == 0 else word.lower())
    return " ".join(out)


def sidc(row: dict) -> str | None:
    """The 15-character code, with * where the user picks affiliation and status."""
    function_id = row["functionid"].strip()
    if len(function_id) != 6:
        return None
    scheme, affiliation, dimension, status = (
        row["codingscheme"].strip(),
        row["affiliation"].strip(),
        row["battledimension"].strip(),
        row["status"].strip(),
    )
    if not scheme or not dimension:
        return None
    # Headers ("INCIDENT", "INFRASTRUCTURE") have no symbol of their own.
    if affiliation == "-" and function_id == "------":
        return None
    affiliation = "*" if affiliation in ("*", "") else affiliation
    status = "*" if status in ("*", "") else status
    # Installations: the H modifier (a frame with a bar on top).
    installation = (scheme == "E" and dimension == "F") or (scheme == "S" and dimension == "G" and function_id.startswith("I"))
    return f"{scheme}{affiliation}{dimension}{status}{function_id}{'H----' if installation else '-----'}"


def graphic_groups(tables: Path, seen: set[str]) -> list[dict]:
    """The tactical graphics, one group per section, points first in each."""
    with open(tables / "tactical-graphics.tsv", newline="", encoding="utf-8") as f:
        rows = list(csv.DictReader(f, delimiter="\t"))
    groups = []
    for section, group in GRAPHIC_SECTIONS:
        symbols = []
        for row in rows:
            geometry = row["geometry"].strip()
            parts = row["hierarchy"].strip().split(".")
            if geometry not in GEOMETRY or len(parts) < 2 or parts[1] != section:
                continue
            code = sidc(row)
            if not code or code in seen:
                continue
            seen.add(code)
            entry = [code, title(row["name"]), len(parts) - 2]
            if GEOMETRY[geometry]:
                entry.append(GEOMETRY[geometry])
            symbols.append(entry)
        groups.append({"name": group, "symbols": symbols})
    return groups


def main() -> None:
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    tables = Path(sys.argv[1])
    groups = []
    seen = set()
    for table, group in TABLES:
        with open(tables / f"{table}.tsv", newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f, delimiter="\t"))
        symbols = []
        for row in rows:
            code = sidc(row)
            if not code or code in seen:
                continue
            seen.add(code)
            depth = row["hierarchy"].strip().count(".")
            symbols.append([code, title(row["name"]), depth])
        groups.append({"name": group, "symbols": symbols})
    groups += graphic_groups(tables, seen)
    catalogue = {
        "source": "MIL-STD-2525C symbols and tactical graphics, from https://github.com/spatialillusions/mil-std-2525 (MIT, Måns Beckman)",
        "format": "symbols: [code with * for affiliation and status, name, depth in the hierarchy, and for graphics drawn from several points: L (line), A (area) or M (other shapes)]",
        "groups": groups,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(catalogue, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(f"{sum(len(g['symbols']) for g in groups)} symbols in {len(groups)} groups -> {OUT}")


if __name__ == "__main__":
    main()
