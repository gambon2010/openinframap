"""Fork: satellite imagery source: Germany: North Rhine-Westphalia."""

from .source import Source

SOURCE = Source(
    id="de_nrw",
    name="NRW",
    title="Germany: North Rhine-Westphalia",
    credit="© Geobasis NRW (dl-de/zero-2-0)",
    layer="detailed",
    fetch="wms",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.1,
    address=(
        "https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=nw_dop_rgb&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg"
    ),
    regions=("nordrhein-westfalen",),
)
