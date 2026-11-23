"""Fork: satellite imagery source: Netherlands (PDOK)."""

from .source import Source

SOURCE = Source(
    id="nl_pdok",
    name="PDOK",
    title="Netherlands (PDOK)",
    credit="© Beeldmateriaal Nederland, PDOK (CC BY 4.0)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.08,
    address=(
        "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg"
    ),
    regions=("netherlands",),
)
