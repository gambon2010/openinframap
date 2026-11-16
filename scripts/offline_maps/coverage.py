"""Fork: offline maps. What's worth offering: zooms stack (Blue Marble 0–8,
Sentinel-2 7–13, aerial photos from 12), so a coarser source is only worth the
zooms where no finer one takes over, and an area inside one already there to the
same zoom adds nothing. `within(a, b)`: whether region a is region b or inside it
(Geofabrik's index, menu.Index.within)."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from .inventory import Entry, converter
from .sources import SENTINEL2, SOURCES, Source

Within = Callable[[str, str], bool]


def inside(area: str, other: str, within: Within) -> bool:
    return other == "world" or area == other or within(area, other)


def aerial_over(area: str, within: Within) -> list[Source]:
    """The aerial photos that cover all of an area (downloaded or not)."""
    return [
        s
        for s in SOURCES.values()
        if s.layer == "detailed" and any(inside(area, r, within) for r in s.regions)
    ]


def aerial_touching(area: str, within: Within) -> list[Source]:
    """The aerial photos that cover all or part of an area."""
    return [
        s
        for s in SOURCES.values()
        if s.layer == "detailed"
        and any(inside(area, r, within) or inside(r, area, within) for r in s.regions)
    ]


@dataclass
class Top:
    zoom: int  # the most worth making
    why: str = ""  # why it's less than the source's own most ("IGN from 12")


def top_zoom(source: Source, area: str, within: Within) -> Top:
    """How far a source is worth making for an area: its most, but Sentinel-2
    stops below where aerial photos take over (they're offered there, even if
    not downloaded yet: zooms that would become useless aren't downloaded)."""
    if source.id == SENTINEL2.id:
        over = aerial_over(area, within)
        if over:
            first = min(over, key=lambda s: s.first_zoom)
            return Top(
                min(source.last_zoom, first.first_zoom - 1),
                f"{first.name} from {first.first_zoom}",
            )
    return Top(source.last_zoom)


def covered_by(
    source: Source, area: str, zoom: int, entries: list[Entry], within: Within
) -> Entry | None:
    """A file of the same source, of this area or one around it, already to
    `zoom`: then there's nothing to add."""
    for e in entries:
        if (
            e.source == source.id
            and e.status == "done"
            and not e.unit
            and inside(area, e.area, within)
            and e.zooms
            and e.zooms[1] >= zoom
        ):
            return e
    return None


def units_done(source: Source, entries: list[Entry], zoom: int) -> set[str]:
    """The units of a source already there to `zoom`."""
    return {
        e.unit
        for e in entries
        if e.source == source.id
        and e.status == "done"
        and e.unit
        and e.zooms[1] >= zoom
    }


def downloaded_over(
    source: Source, area: str, entries: list[Entry], within: Within
) -> bool:
    """Whether a source's files cover all of an area (every unit in it, or one
    file of an area around it)."""
    if source.units:
        units = converter(source).units_in(area, within)
        have = {e.unit for e in entries if e.source == source.id and e.status == "done"}
        return bool(units) and set(units) <= have
    return covered_by(source, area, source.first_zoom, entries, within) is not None


@dataclass
class Freeable:
    entry: Entry
    bytes: int
    why: str


def could_free(entries: list[Entry], within: Within) -> list[Freeable]:
    """Files, or zooms of them, that others make useless: shown in Remove, never
    deleted by themselves. A file of an area inside another of the same source
    to as high a zoom; Sentinel-2's zooms where aerial photos are downloaded
    over the whole area."""
    out = []
    done = [e for e in entries if e.status == "done" and e.zooms and not e.unit]
    for e in done:
        bigger = next(
            (
                o
                for o in done
                if o is not e
                and o.source == e.source
                and o.area != e.area
                and inside(e.area, o.area, within)
                and o.zooms[1] >= e.zooms[1]
            ),
            None,
        )
        if bigger:
            out.append(Freeable(e, e.bytes, f"covered by {bigger.area}"))
            continue
        if e.source != SENTINEL2.id:
            continue
        for aerial in aerial_over(e.area, within):
            last = aerial.first_zoom - 1
            kept = SENTINEL2.sizes["kept_per_km2"]
            if e.zooms[1] <= last or last not in kept or e.zooms[1] not in kept:
                continue
            if downloaded_over(aerial, e.area, entries, within):
                share = 1 - kept[last] / kept[e.zooms[1]]
                out.append(
                    Freeable(
                        e,
                        int(e.bytes * share),
                        f"zooms {last + 1}–{e.zooms[1]}: {aerial.name} there",
                    )
                )
                break
    return out
