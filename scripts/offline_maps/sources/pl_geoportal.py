"""Fork: satellite imagery source: Poland (Geoportal)."""

from .source import Source

SOURCE = Source(
    id="pl_geoportal",
    name="Geoportal.gov.pl",
    title="Poland (Geoportal)",
    credit="© GUGiK, Geoportal.gov.pl",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.25,
    address=(
        "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default"
        "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}"
        "&FORMAT=image/jpeg"
    ),
    regions=("poland",),
)
