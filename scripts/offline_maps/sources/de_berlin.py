"""Fork: satellite imagery source: Germany: Berlin."""

from .source import Source

SOURCE = Source(
    id="de_berlin",
    name="Berlin",
    title="Germany: Berlin",
    credit="© Geoportal Berlin (dl-de/zero-2-0)",
    layer="detailed",
    fetch="wms",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.2,
    address=(
        "https://gdi.berlin.de/services/wms/truedop_2024?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=truedop_2024&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg"
    ),
    regions=("berlin",),
)
