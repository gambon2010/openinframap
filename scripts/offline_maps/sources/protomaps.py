"""Fork: offline map source: the background map (streets, places, buildings),
cut out of Protomaps' daily world build (scripts/lib/basemap.sh)."""

from .source import Source

SOURCE = Source(
    id="protomaps",
    name="Background map",
    title="Background map (Protomaps, from OpenStreetMap)",
    credit="© OpenStreetMap contributors, Protomaps",
    layer="basemap",
    fetch="extract",
    first_zoom=0,
    last_zoom=15,
    address="https://build.protomaps.com",
    format="mvt",
)
