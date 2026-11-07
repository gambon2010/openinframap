"""Fork: tower numbers (tower_numbers/__init__.py): the labels of a line's towers in
order ("23", "23a" for one added later), keeping the ones already given."""

from __future__ import annotations

import re
from collections.abc import Iterator


def base(label: str) -> int:
    """The number of a label: 23 for "23" and "23a"."""
    digits = re.match(r"\d+", label)
    return int(digits.group()) if digits else 0


def letters() -> Iterator[str]:
    """a, b, ... z, za, zb, ... (sorting after the ones before)."""
    prefix = ""
    while True:
        for c in "abcdefghijklmnopqrstuvwxy":
            yield prefix + c
        prefix += "z"


def label_towers(towers: list[int], known: dict[int, str], used: set[str]) -> tuple[list[int], list[str]]:
    """The labels of a line's towers (in order along it): a tower `known` keeps its
    label; one added between two gets the one before's number and a letter ("23a");
    after the last known one, the next numbers; before the first, "0a", "0b"...
    `used` is every label ever given on the line (none is given twice) and gets the
    new ones. The towers come back turned round if the known labels count the
    other way."""
    places = [(i, base(known[t])) for i, t in enumerate(towers) if t in known]
    if len(places) >= 2:
        ups = sum(b > a for (_, a), (_, b) in zip(places, places[1:]))
        downs = sum(b < a for (_, a), (_, b) in zip(places, places[1:]))
        if downs > ups:
            towers = towers[::-1]
    known_later = [False] * len(towers)
    seen = False
    for i in range(len(towers) - 1, -1, -1):
        known_later[i] = seen
        seen = seen or towers[i] in known
    highest = max((base(label) for label in used), default=0)
    labels: list[str] = []
    previous: str | None = None
    for i, tower in enumerate(towers):
        if tower in known:
            label = known[tower]
        elif not known_later[i]:
            highest += 1
            label = str(highest)
        else:
            number = base(previous) if previous else 0
            label = next(f"{number}{x}" for x in letters() if f"{number}{x}" not in used)
        used.add(label)
        labels.append(label)
        previous = label
    return towers, labels
