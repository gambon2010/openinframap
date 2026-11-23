"""Fork: where a power line goes (grid/__init__.py): the clicked line followed
through junctions to the stations at its ends (line_trace/).

    GET /grid/line/<osm_id>
"""

import json

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response

from ... import Request, get_db
from ..line_trace import load_index, trace_line


def circuit_of(voltage_tag: str | None, voltage: int) -> dict:
    """Which of a way's voltages ("63000;20000") a line of `voltage` is: its index
    (1-based) and how many there are, as the map draws them side by side."""
    voltages: list[float | None] = []
    for value in (voltage_tag or "").split(";"):
        try:
            voltages.append(float(value.strip()))
        except ValueError:
            voltages.append(None)
    index = next((i + 1 for i, v in enumerate(voltages) if v == voltage), 1)
    return {"index": index, "count": max(1, len(voltages))}


async def line(request: Request) -> Response:
    """Where a power line goes: the clicked line followed through junctions to the
    stations at its ends (line_trace/ says how).

        GET /grid/line/<osm_id>
    """
    database = get_db(request)
    try:
        osm_id = int(request.path_params["osm_id"])
    except ValueError:
        raise HTTPException(400, "Invalid line id")

    has_grid = (await database.execute(text("SELECT to_regclass('grid_edge') IS NOT NULL"))).scalar()
    index = await load_index(database) if has_grid else None
    trace = trace_line(index, osm_id) if index else None
    if index is None or trace is None:
        # Not in the network (no known voltage, or below 10 kV): just the line itself.
        rows = await database.execute(
            text(
                """SELECT ST_AsGeoJSON(ST_Transform(geometry, 4326)) AS geometry,
                          ST_Length(ST_Transform(geometry, 4326)::geography) AS length_m
                     FROM osm_power_line WHERE osm_id = :osm_id"""
            ),
            {"osm_id": osm_id},
        )
        found = [dict(r._mapping) for r in rows]
        if not found:
            raise HTTPException(404, "Line not found")
        return JSONResponse(
            {
                "stations": [],
                "length_km": round(sum(r["length_m"] for r in found) / 1000, 1),
                "voltages_kv": [],
                "complete": True,
                "geometry": {
                    "type": "MultiLineString",
                    "coordinates": [json.loads(r["geometry"])["coordinates"] for r in found],
                },
            }
        )

    stations = [
        {"kind": node.kind, "osm_id": node.osm_id, "name": node.name}
        for node in (index.nodes[n] for n in trace.stations)
    ]
    # Drawn: the ways followed, whole (the network leaves out the part of a line
    # inside the substation it ends in), and the stubs as far as taken.
    whole = trace.ways(index) - trace.stubs
    drawn = await database.execute(
        text(
            """SELECT ST_AsGeoJSON(ST_Transform(geometry, 4326)), voltage
                 FROM osm_power_line WHERE osm_id = ANY(:ids)"""
        ),
        {"ids": list(whole)},
    )
    parts = [
        {"coordinates": json.loads(geometry)["coordinates"], **circuit_of(tag, trace.voltage)}
        for geometry, tag in drawn
    ]
    stub_edges = [e for e in trace.edges if index.edges[e].way in trace.stubs]
    if stub_edges:
        rows = await database.execute(
            text(
                """SELECT ST_AsGeoJSON(ST_Transform(geom, 4326)), voltage_tag
                     FROM grid_edge WHERE edge_id = ANY(:ids)"""
            ),
            {"ids": stub_edges},
        )
        parts += [
            {"coordinates": json.loads(geometry)["coordinates"], **circuit_of(tag, trace.voltage)}
            for geometry, tag in rows
        ]
    # Parallel circuits between the same two points count once in the length.
    by_pair: dict[frozenset[int], float] = {}
    for e in (index.edges[i] for i in trace.edges):
        pair = frozenset((e.source, e.target))
        by_pair[pair] = min(by_pair.get(pair, e.length_m), e.length_m)
    return JSONResponse(
        {
            "stations": sorted(stations, key=lambda s: s["name"] or ""),
            "length_km": round(sum(by_pair.values()) / 1000, 1),
            "voltages_kv": [trace.voltage // 1000],
            "complete": trace.complete,
            "geometry": {
                "type": "MultiLineString",
                "coordinates": [part["coordinates"] for part in parts],
            },
            # The same, one per way, with which of its voltages is this line's: a
            # way carrying several is drawn as parallel lines, one per voltage.
            "parts": parts,
        }
    )
