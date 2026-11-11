"""Fork: satellite imagery source: Belgium: Wallonia."""

from .source import Source

SOURCE = Source(
    id="be_wallonia",
    name="Wallonia",
    title="Belgium: Wallonia",
    credit="© SPW, Wallonie (CC BY 4.0)",
    layer="detailed",
    fetch="wms",
    first_zoom=12,
    last_zoom=17,
    detail_m=0.25,
    address=(
        "https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer"
        "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857"
        "&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg"
    ),
    regions=("belgium",),
    bbox=(2.83, 49.49, 6.41, 50.82),
)
