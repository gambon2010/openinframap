"""src/fork/terrain/bare_ground.py: where trees and buildings are added (France)."""

import asyncio

import shapely

from src.fork.terrain import bare_ground


class FakeDatabase:
    """Answers the outline query with a square from 0 to 1 degree, and counts queries."""

    def __init__(self):
        self.queries = 0

    async def execute(self, *args, **kwargs):
        self.queries += 1
        wkb = shapely.to_wkb(shapely.box(0, 0, 1, 1))

        class Result:
            def fetchone(self):
                return (wkb,)

        return Result()


def test_inside_the_outline_only_read_once(monkeypatch):
    monkeypatch.setattr(bare_ground, "_outline", None)
    database = FakeDatabase()
    inside = asyncio.run(bare_ground.bare_ground_test(database))
    assert inside(0.5, 0.5) and not inside(2.0, 0.5)
    asyncio.run(bare_ground.bare_ground_test(database))
    assert database.queries == 1
