"""Fork: offline maps. A download the menu runs (one of satellite.py's commands),
with what it keeps, downloads and takes; the queue of those left (queue.json, so
Resume goes on after a stop)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

QUEUE = "queue.json"


@dataclass
class Job:
    label: str  # "IGN 20 cm, 94 départements, z17"
    argv: list[str]  # satellite.py's arguments
    kept: int = 0
    download: int = 0
    seconds: float = 0
    peak: int = 0  # free space needed while it runs, besides what it keeps


def read_queue(folder: Path) -> list[Job]:
    try:
        return [Job(**j) for j in json.loads((folder / QUEUE).read_text())]
    except (OSError, ValueError, TypeError):
        return []


def save_queue(folder: Path, jobs: list[Job]) -> None:
    path = folder / QUEUE
    if jobs:
        path.write_text(json.dumps([asdict(j) for j in jobs], indent=1) + "\n")
    else:
        path.unlink(missing_ok=True)


def large_buildings_job() -> Job:
    return Job(
        "Large buildings, found again from the background maps (shown zoomed out)",
        ["large-buildings"],
        seconds=600,
    )


def work_zoom(work: Path) -> int | None:
    """The zoom a stopped job was making (its tiles-z17 or warped-z17)."""
    for path in work.glob("*-z*"):
        tail = path.name.split("-z")[-1].split(".")[0]
        if tail.isdigit():
            return int(tail)
    return None
