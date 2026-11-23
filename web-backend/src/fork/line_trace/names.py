"""Fork: following a line (line_trace/__init__.py): whether two ways' names are of the
same line, by the places they join ("Liaison 225 kV n°1 A - B" = "a - b")."""

from __future__ import annotations

import re
import unicodedata

LineEnds = tuple[frozenset[str], int | None]
# A circuit number: "n°1", "N° 2", "No 3", "N0 1" (a zero typed for the °).
CIRCUIT = re.compile(r"(?i)\bn\s*[°º0o]\.?\s*(\d+)\b")


def place(text: str) -> str:
    """A place name compared loosely: lower case, no accents, "St-" = "Saint-"."""
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(c for c in text if not unicodedata.combining(c))
    text = re.sub(r"\bste?\b\.?", lambda m: "sainte" if m.group(0).startswith("ste") else "saint", text)
    return " ".join(re.sub(r"[-'’]", " ", text).split())


def line_ends(name: str | None) -> set[LineEnds]:
    """The places a line's name joins, and its circuit number if it says:
    "Liaison 225 kV n°1 Graffenstaden - Marlenheim" gives ({graffenstaden,
    marlenheim}, 1), "graffenstaden - marlenheim" the same places and no number; a
    line with a tee names three ("A - B - C"); a name for several lines on shared
    pylons ("…;…") gives each."""
    found = set()
    for part in (name or "").split(";"):
        number = re.search(CIRCUIT, part)
        part = re.sub(
            r"(?i)\([^)]*\)|\b(liaisons?|lignes?|et|à)\b|\b\d+([.,]\d+)?\s*kv\b", " ", CIRCUIT.sub(" ", part)
        )
        places = [place(p) for p in re.split(r"\s+-\s+|\s*[–—]\s*", part)]
        places = [p for p in places if p]
        if len(places) >= 2:
            found.add((frozenset(places), int(number.group(1)) if number else None))
    return found


def same_line(a: set[LineEnds], b: set[LineEnds]) -> bool:
    """Whether two names are of the same line: the same places (or one naming part
    of the other's: "A - B" of "A - B - C"), and the same circuit number when both
    give one (n°1 and n°2 are two lines)."""
    return any(
        (pa <= pb or pb <= pa) and (na is None or nb is None or na == nb) for pa, na in a for pb, nb in b
    )


def shares_a_place(a: set[LineEnds], b: set[LineEnds]) -> bool:
    """Whether two lines' names have a place in common (two lines going into the
    same substation on shared pylons)."""
    return any(pa & pb for pa, _ in a for pb, _ in b)
