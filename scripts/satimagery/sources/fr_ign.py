"""Fork: satellite imagery source: France (IGN, BD ORTHO)."""

from .source import Source

SOURCE = Source(
    id="fr_ign",
    name="IGN",
    title="France (IGN, BD ORTHO)",
    credit="© IGN (Licence Ouverte)",
    layer="detailed",
    fetch="files",
    first_zoom=12,
    last_zoom=19,
    detail_m=0.2,
    address="bdortho",
    regions=("france",),
    units="départements",
    format="webp",
    # Measured on Bas-Rhin (2024, 4,761 km², mostly countryside): a WebP tile
    # (1.17 GB to zoom 17: 7.5 KB; Paris, all city, 11 KB), and the archive per
    # km² (22.8 GB), read whole whatever the zoom.
    tile_bytes=8_000,
    read_per_km2=4_800_000,
)
