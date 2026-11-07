"""Fork: tower numbers (tower_numbers/__init__.py): the register (userdata.tower_line_ref,
tower_ref), so a tower keeps the number people saw, rebuild after rebuild."""

from __future__ import annotations

from collections import Counter

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .labels import label_towers
from .numbering import Line


async def number_from_register(
    database: AsyncConnection, lines: list[Line], towers: dict[int, list[int]]
) -> list[tuple[int, int, str, int]]:
    """(line_id, tower, label, towers on the line) for every tower, from the register
    (userdata.tower_line_ref, tower_ref), which gets the new lines and towers."""
    voltage_of = {
        key: v
        for key, v in await database.execute(text("SELECT line_key, voltage FROM userdata.tower_line_ref"))
    }
    registered: dict[int, dict[int, str]] = {}
    on_lines: dict[int, list[int]] = {}
    for key, osm_id, label in await database.execute(
        text("SELECT line_key, osm_id, label FROM userdata.tower_ref")
    ):
        registered.setdefault(key, {})[osm_id] = label
        on_lines.setdefault(osm_id, []).append(key)
    next_key = max(voltage_of, default=0) + 1
    claimed: set[int] = set()
    new_lines: list[tuple[int, int]] = []
    new_refs: list[tuple[int, int, str]] = []
    out: list[tuple[int, int, str, int]] = []
    # The longest first: they take the register's line they share most towers with.
    for line in sorted(lines, key=lambda x: -len(towers.get(x.line_id, []))):
        along = towers.get(line.line_id, [])
        if not along:
            continue
        shared = Counter(
            key
            for t in along
            for key in on_lines.get(t, [])
            if voltage_of.get(key) == line.voltage and key not in claimed
        )
        key = None
        if shared:
            best, count = shared.most_common(1)[0]
            if count >= max(1, 0.3 * len(along)):
                key = best
        if key is None:
            key, next_key = next_key, next_key + 1
            voltage_of[key] = line.voltage
            new_lines.append((key, line.voltage))
        claimed.add(key)
        known = registered.setdefault(key, {})
        ordered, labels = label_towers(along, known, set(known.values()))
        for tower, label in zip(ordered, labels):
            if tower not in known:
                known[tower] = label
                new_refs.append((tower, key, label))
            out.append((line.line_id, tower, label, len(along)))
    raw = (await database.get_raw_connection()).driver_connection
    assert raw is not None
    await raw.copy_records_to_table(
        "tower_line_ref", schema_name="userdata", columns=["line_key", "voltage"], records=new_lines
    )
    await raw.copy_records_to_table(
        "tower_ref", schema_name="userdata", columns=["osm_id", "line_key", "label"], records=new_refs
    )
    await database.execute(
        text("SELECT setval(pg_get_serial_sequence('userdata.tower_line_ref', 'line_key'), :key)"),
        {"key": next_key},
    )
    print(f"{len(new_lines):,} new lines and {len(new_refs):,} new towers in the register.")
    return out
