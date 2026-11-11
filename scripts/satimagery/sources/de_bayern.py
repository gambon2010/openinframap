"""Fork: satellite imagery source: Germany: Bavaria."""

from .source import Source

SOURCE = Source(
    id="de_bayern",
    name="Bavaria",
    title="Germany: Bavaria",
    credit="© Bayerische Vermessungsverwaltung (CC BY 4.0)",
    layer="detailed",
    fetch="wms",
    first_zoom=12,
    last_zoom=16,
    detail_m=0.4,
    address=(
        "https://geoservices.bayern.de/od/wms/dop/v1/dop40?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=&CRS=EPSG:3857&BBOX={bbox}&WIDTH=256"
        "&HEIGHT=256&FORMAT=image/jpeg"
    ),
    regions=("bayern",),
)
