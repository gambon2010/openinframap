"""Fork: satellite imagery source: Spain (IGN, PNOA)."""

from .source import Source

SOURCE = Source(
    id="es_pnoa",
    name="PNOA",
    title="Spain (IGN, PNOA)",
    credit="© IGN España, PNOA (CC BY 4.0)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.25,
    address=(
        "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        "&LAYER=OI.OrthoimageCoverage&STYLE=default"
        "&TILEMATRIXSET=GoogleMapsCompatible&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}"
        "&FORMAT=image/jpeg"
    ),
    regions=("spain",),
)
