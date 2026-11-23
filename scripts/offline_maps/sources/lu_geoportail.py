"""Fork: satellite imagery source: Luxembourg (geoportail.lu)."""

from .source import Source

SOURCE = Source(
    id="lu_geoportail",
    name="geoportail.lu",
    title="Luxembourg (geoportail.lu)",
    credit="© Geoportail Luxembourg (CC0)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.2,
    address=(
        "https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg"
    ),
    regions=("luxembourg",),
)
