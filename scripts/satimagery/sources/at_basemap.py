"""Fork: satellite imagery source: Austria (basemap.at)."""

from .source import Source

SOURCE = Source(
    id="at_basemap",
    name="basemap.at",
    title="Austria (basemap.at)",
    credit="© basemap.at (CC BY 4.0)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.3,
    address=(
        "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg"
    ),
    regions=("austria",),
)
