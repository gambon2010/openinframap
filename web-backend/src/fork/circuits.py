"""
Fork: a name for every circuit (OSM route=power relation). Many have none in
OpenStreetMap (7 of the 10 at Sierentz): upstream lists them as "-". The fork's
routes replace upstream's /api/substation, /api/circuit and /api/line (same URLs,
same answers) and fill in the missing names from what the circuit is made of:

1. the name its lines carry that names the substations it joins, for its circuit
   number ("MUHLBL71SIERE" in ref:FR:RTE is circuit n°1: "Liaison 400 kV n°1
   Muhlbach - Sierentz" rather than "Liaisons 400 kV n°1 et n°2 Muhlbach -
   Sierentz"), else the most common;
2. else the substations it joins: "Muhlbach – Sierentz";
3. else its reference (ref:FR:RTE, ref).
"""

from __future__ import annotations

import re
from collections import Counter
from typing import Iterable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from .. import Request, get_db
from ..openapi import APIRoute
from ..views import api as upstream
from .line_trace import CIRCUIT, place

# "Poste électrique de Muhlbach" -> "Muhlbach"
STATION_PREFIX = re.compile(
    r"(?i)^(poste (électrique|electrique|source)|sous-station|substation)\s+"
    r"(de la |de l['’]|du |des |de |d['’])?"
)
# RTE's code: <place>L<voltage digit><circuit number><place>, "MUHLBL71SIERE".
RTE_CIRCUIT = re.compile(r"L\d(\d)")


def short_station(name: str) -> str:
    return STATION_PREFIX.sub("", name).strip() or name


def circuit_name(
    ref: str | None, line_names: Iterable[str | None], station_names: Iterable[str | None]
) -> str | None:
    """A name for a circuit without one (see the module's docstring)."""
    stations = list(dict.fromkeys(s for s in station_names if s))
    number = RTE_CIRCUIT.search(ref or "")
    wanted = number.group(1) if number else None
    names = Counter(part.strip() for name in line_names if name for part in name.split(";") if part.strip())
    if names:

        def fits(name: str) -> int:
            numbers = CIRCUIT.findall(name)
            if wanted is None or not numbers:
                return 1
            if numbers == [wanted]:
                return 3
            return 2 if wanted in numbers else 0

        # Named after the substations it joins (its lines can carry another link's name too).
        ends = [place(short_station(s)) for s in stations]

        def joins(name: str) -> int:
            return sum(end in place(name) for end in ends)

        best = max(names, key=lambda n: (fits(n), joins(n), names[n], -len(n)))
        if fits(best) > 0 and (len(ends) < 2 or joins(best) >= 2):
            return best
    if len(stations) >= 2:
        return " – ".join(short_station(s) for s in stations)
    return ref or None


async def fill_names(database: AsyncConnection, circuits: list[upstream.Circuit]) -> None:
    """Names (and voltages) for the circuits that have none."""
    missing = [c.id for c in circuits if not c.name or c.voltage is None]
    if not missing:
        return
    rows = await database.execute(
        text(
            """SELECT m.osm_id, m.role, m.tags -> 'name' AS name,
                      coalesce(r.tags -> 'ref:FR:RTE', r.tags -> 'ref') AS ref,
                      convert_voltage(m.tags -> 'voltage') AS voltage
                 FROM osm_power_circuit_relation_member AS m
                 JOIN osm_power_circuit_relation AS r USING (osm_id)
                WHERE m.osm_id = ANY(:ids)"""
        ),
        {"ids": missing},
    )
    parts: dict[int, tuple[list[str | None], list[str | None], list[str | None], Counter[float]]] = {}
    for osm_id, role, name, ref, voltage in rows:
        lines, stations, refs, voltages = parts.setdefault(osm_id, ([], [], [], Counter()))
        refs.append(ref)
        (stations if role == "substation" else lines).append(name)
        if role != "substation" and voltage:
            voltages[float(voltage)] += 1
    for c in circuits:
        if c.id not in parts:
            continue
        lines, stations, refs, voltages = parts[c.id]
        if not c.name:
            c.name = circuit_name(refs[0], lines, stations)
        if c.voltage is None and voltages:
            # Its lines' voltage (the most common), in kV as upstream gives it.
            c.voltage = round(voltages.most_common(1)[0][0] / 1000)


async def substation(request: Request) -> upstream.SubstationResponse:
    """Fetch circuit metadata for a substation (fork: every circuit named)."""
    response = await upstream.substation(request)
    await fill_names(get_db(request), [m.circuit for m in response.circuits])
    return response


async def circuit(request: Request) -> upstream.CircuitResponse:
    """Fetch a circuit (fork: named if it has no name)."""
    response = await upstream.circuit(request)
    await fill_names(get_db(request), [response])
    return response


async def line(request: Request) -> upstream.LineResponse:
    """Fetch circuits for a power line (fork: every circuit named)."""
    response = await upstream.line(request)
    await fill_names(get_db(request), [m.circuit for m in response.circuits])
    return response


routes = [
    APIRoute("/api/substation/{substation_id}", endpoint=substation),
    APIRoute("/api/circuit/{circuit_id}", endpoint=circuit),
    APIRoute("/api/line/{line_id}", endpoint=line),
]
