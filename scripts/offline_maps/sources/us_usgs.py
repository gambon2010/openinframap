"""Fork: satellite imagery source: United States (USGS, NAIP)."""

from .source import Source

SOURCE = Source(
    id="us_usgs",
    name="NAIP",
    title="United States (USGS, NAIP)",
    credit="USDA NAIP, USGS The National Map (public domain)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=16,
    detail_m=0.6,
    address=(
        "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}"
    ),
    regions=("us",),
)
