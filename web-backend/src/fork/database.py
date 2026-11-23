"""Fork: the database the backend's own build steps use when run on their own
(python -m src.fork.tower_numbers, src.fork.indoor, grid_check.py): DATABASE_URL, as
the backend has it in Docker, else the local one."""

import os

DEFAULT_URL = "postgresql+asyncpg://osm:osm@localhost:5432/osm"


def database_url() -> str:
    return os.environ.get("DATABASE_URL", DEFAULT_URL)
