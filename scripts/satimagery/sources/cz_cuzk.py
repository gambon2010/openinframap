"""Fork: satellite imagery source: Czechia (ČÚZK)."""

from .source import Source

SOURCE = Source(
    id="cz_cuzk",
    name="ČÚZK",
    title="Czechia (ČÚZK)",
    credit="© ČÚZK (CC BY 4.0)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.2,
    address=(
        "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}"
    ),
    regions=("czech-republic",),
)
