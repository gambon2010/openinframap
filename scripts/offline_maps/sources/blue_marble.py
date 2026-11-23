"""Fork: satellite imagery source: NASA Blue Marble (500 m), the whole world."""

from .source import Source

SOURCE = Source(
    id="blue_marble",
    name="Blue Marble",
    title="The world (NASA Blue Marble)",
    credit="NASA Blue Marble",
    layer="overview",
    fetch="tiles",
    first_zoom=0,
    last_zoom=8,
    detail_m=500,
    address=(
        "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration"
        "/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"
    ),
    # Measured on Luxembourg and Alsace.
    tile_bytes=6_500,
    sizes={
        # The whole world to zoom 8 (overview --world, shared by every region):
        # 87,381 tiles, about 3.8 KB each (mostly ocean).
        "world": 330_000_000,
        # A region's own file: the world to this zoom, then its box to the last.
        "world_zoom": 5,
    },
)
