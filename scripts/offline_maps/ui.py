"""Fork: offline maps. Every screen's printing and asking, so they all look the
same: short labels, numbers in aligned columns, the default in brackets, Enter to
go back. Everything goes to stderr (stdout stays for what scripts read)."""

from __future__ import annotations

import sys
from collections.abc import Callable, Sequence


def say(text: str = "") -> None:
    print(text, file=sys.stderr)


def human(n: float) -> str:
    """Bytes as people read them: 512 MB, 1.3 GB, 2.6 TB."""
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1000 or unit == "TB":
            if unit in ("B", "KB", "MB") or n >= 10:
                return f"{n:.0f} {unit}"
            return f"{n:.1f} {unit}"
        n /= 1000
    return ""


def part(have: float, of: float) -> str:
    """16/48 GB: so far, of how much, in the unit of the whole."""
    whole = human(of)
    unit = whole.split()[-1]
    scale = {"B": 1, "KB": 1e3, "MB": 1e6, "GB": 1e9, "TB": 1e12}[unit]
    return f"{have / scale:.0f}/{whole}"


def duration(seconds: float) -> str:
    hours = seconds / 3600
    if hours < 1:
        return f"{max(1, round(seconds / 60))} min"
    if hours < 48:
        return f"{hours:.0f} h"
    return f"{hours / 24:.0f} days"


def zooms(first: int, last: int) -> str:
    return f"{first}–{last}" if first != last else str(first)


def table(rows: Sequence[Sequence[str]], header: Sequence[str] = (), right=()) -> None:
    """Rows in aligned columns; `right`: the columns aligned right (sizes)."""
    every = [list(header)] if header else []
    every += [list(r) for r in rows]
    if not every:
        return
    count = max(len(r) for r in every)
    every = [r + [""] * (count - len(r)) for r in every]
    widths = [max(len(r[i]) for r in every) for i in range(count)]
    for row in every:
        cells = [
            c.rjust(widths[i]) if i in right else c.ljust(widths[i])
            for i, c in enumerate(row)
        ]
        say(" " + "   ".join(cells).rstrip())


def answer(prompt: str) -> str:
    """One line typed (stripped); end of input stops the menu."""
    print(f"{prompt} ", end="", file=sys.stderr, flush=True)
    line = sys.stdin.readline()
    if not line:
        sys.exit("Stopped.")
    return line.strip()


def ask(prompt: str, check: Callable[[str], object], default: str = "") -> object:
    """A typed answer that `check` turns into something (None: ask again; it
    says why itself). Enter is `default`."""
    while True:
        got = check(answer(prompt) or default)
        if got is not None:
            return got


def choose(options: Sequence[str], prompt: str = ">", back: str = "back") -> int | None:
    """One of the options, shown on one line as "1 Add   2 Remove"; its index,
    None for Enter."""
    say("")
    say(
        " "
        + "   ".join(f"{n} {o}" for n, o in enumerate(options, 1))
        + f"      Enter: {back}"
    )

    def check(text: str):
        if not text:
            return -1
        if text.isdigit() and 1 <= int(text) <= len(options):
            return int(text) - 1
        say(f"Type 1 to {len(options)}, or Enter.")
        return None

    picked = ask(prompt, check)
    return None if picked == -1 else picked  # type: ignore[return-value]


def pick_row(count: int, prompt: str = ">") -> int | None:
    """One of `count` numbered rows shown just before; its index, None for Enter."""

    def check(text: str):
        if not text:
            return -1
        if text.isdigit() and 1 <= int(text) <= count:
            return int(text) - 1
        say(f"Type a number from the list (1 to {count}), or Enter to go back.")
        return None

    picked = ask(prompt, check)
    return None if picked == -1 else picked  # type: ignore[return-value]


def codes(
    prompt: str,
    valid: Sequence[str],
    normalise: Callable[[str], str] = str,
    listing: Callable[[], None] | None = None,
) -> list[str]:
    """Some of the codes (Enter: all of them); `?` shows the list (listing)."""

    def check(text: str):
        if text == "?" and listing:
            listing()
            return None
        words = [normalise(w) for w in text.replace(",", " ").split()]
        wrong = [w for w in words if w not in valid]
        if wrong:
            say(
                f"Not offered: {' '.join(wrong)}"
                + (" (? shows the list)" if listing else "")
            )
            return None
        return list(dict.fromkeys(words)) or list(valid)

    return ask(prompt, check)  # type: ignore[return-value]


def confirm(prompt: str, default: bool = True) -> bool:
    def check(text: str):
        if text.lower() in ("y", "yes", "o", "oui"):
            return True
        if text.lower() in ("n", "no", "non"):
            return False
        say("Type y or n.")
        return None

    return bool(
        ask(f"{prompt} [{'Y/n' if default else 'y/N'}]", check, "y" if default else "n")
    )


def columns(items: Sequence[str], width: int = 78) -> None:
    """Short items in as many columns as fit."""
    if not items:
        return
    cell = max(len(i) for i in items) + 3
    per_line = max(1, width // cell)
    for start in range(0, len(items), per_line):
        say(
            " "
            + "".join(i.ljust(cell) for i in items[start : start + per_line]).rstrip()
        )
