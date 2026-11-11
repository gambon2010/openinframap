"""Fork: satellite imagery source: Sentinel-2 (10 m, 2021, cloud-free), from the
ESA WorldCover composite, for any area or the whole world."""

from .source import Source

SOURCE = Source(
    id="sentinel2",
    name="Sentinel-2",
    title="Sentinel-2 (ESA WorldCover 2021)",
    credit="Contains modified Copernicus Sentinel data (2021), ESA WorldCover (CC BY 4.0)",
    layer="regional",
    fetch="cells",
    # From zoom 7 for every area: made from there, and shown from there
    # (scripts/lib/satellite.sh REGIONAL_FIRST_ZOOM, checked equal by a test).
    first_zoom=7,
    last_zoom=13,
    detail_m=10,
    address=(
        "https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/"
        "{lat_name}/ESA_WorldCover_10m_2021_v200_{cell}_S2RGBNIR.tif"
    ),
    format="webp",
    # Measured on Luxembourg and Alsace.
    tile_bytes=9_000,
    sizes={
        # Kept per km² of land, zoom 9 up to the key (France to 12: 195 MB for
        # 551,000 km²; each zoom more is four times as many tiles).
        "kept_per_km2": {9: 6, 10: 22, 11: 89, 12: 354, 13: 1_416},
        # Read from the composite per km² (RGBN, deflate), by last zoom: full
        # resolution for 13, the 20 m overview for 12 and below.
        "read_per_km2": {13: 70_000, 12: 18_000, 11: 4_500, 10: 1_100, 9: 300},
        # Land the composite covers (no Antarctica; it stops near 84° N).
        "world_land_km2": 134_000_000,
    },
)
