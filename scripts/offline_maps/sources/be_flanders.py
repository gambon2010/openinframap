"""Fork: satellite imagery source: Belgium: Flanders."""

from .source import Source

SOURCE = Source(
    id="be_flanders",
    name="Flanders",
    title="Belgium: Flanders",
    credit="© Digitaal Vlaanderen (Modellicentie Gratis Hergebruik)",
    layer="detailed",
    fetch="tiles",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.25,
    address=(
        "https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?SERVICE=WMTS&REQUEST=GetTile"
        "&VERSION=1.0.0&LAYER=omwrgbmrvl&STYLE=&TILEMATRIXSET=GoogleMapsVL"
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png"
    ),
    regions=("belgium",),
    bbox=(2.53, 50.67, 5.93, 51.51),
    format="png",
    tile_bytes=80_000,
)
