"""Fork: offline maps. A download the menu runs (one of offline-maps.py's commands),
with what it keeps, downloads and takes; the queue of those left (queue.json, so
Resume goes on after a stop)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

QUEUE = "queue.json"
# Stands for the maps folder in the saved queue's paths.
MAPS_FOLDER = "{maps}"


@dataclass
class Job:
    label: str  # "IGN 20 cm, 94 départements, z17"
    argv: list[str]  # offline-maps.py's arguments
    kept: int = 0
    download: int = 0
    seconds: float = 0
    peak: int = 0  # free space needed while it runs, besides what it keeps


def read_queue(folder: Path) -> list[Job]:
    """The jobs left, their paths inside the maps folder where the folder is now."""
    try:
        saved = [Job(**j) for j in json.loads((folder / QUEUE).read_text())]
    except (OSError, ValueError, TypeError):
        return []
    for job in saved:
        job.argv = [located(arg, folder) for arg in job.argv]
    return saved


def save_queue(folder: Path, jobs: list[Job]) -> None:
    """The jobs left, saved with paths inside the maps folder relative to it, so
    Resume still works once the folder has moved (to another place, or a drive)."""
    path = folder / QUEUE
    if not jobs:
        path.unlink(missing_ok=True)
        return
    saved = [
        asdict(j) | {"argv": [relative(arg, folder) for arg in j.argv]} for j in jobs
    ]
    path.write_text(json.dumps(saved, indent=1) + "\n")


def relative(arg: str, folder: Path) -> str:
    """An argument as saved: a path inside the maps folder starts with MAPS_FOLDER."""
    if arg == str(folder):
        return MAPS_FOLDER
    if arg.startswith(f"{folder}/"):
        return MAPS_FOLDER + arg[len(str(folder)) :]
    return arg


def located(arg: str, folder: Path) -> str:
    """A saved argument, its path inside the maps folder where the folder is now."""
    if arg == MAPS_FOLDER or arg.startswith(f"{MAPS_FOLDER}/"):
        return str(folder) + arg[len(MAPS_FOLDER) :]
    return arg


def work_zoom(work: Path) -> int | None:
    """The zoom a stopped job was making (its tiles-z17 or warped-z17)."""
    for path in work.glob("*-z*"):
        tail = path.name.split("-z")[-1].split(".")[0]
        if tail.isdigit():
            return int(tail)
    return None
