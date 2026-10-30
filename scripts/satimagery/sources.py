"""Fork: satellite imagery. Where the imagery comes from: NASA GIBS (Blue Marble), the ESA WorldCover Sentinel-2 composite, and the aerial photo sources by country (DETAILED_SOURCES), with their credits."""

from __future__ import annotations

from pathlib import Path

GDAL_IMAGE = "ghcr.io/osgeo/gdal:alpine-small-3.10.3"
USER_AGENT = (
    "openinframap-local (offline satellite cache; github.com/gambon2010/openinframap)"
)

GIBS_URL = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/BlueMarble_NextGeneration/default/"
    "GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg"
)
WORLDCOVER_URL = (
    "https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/"
    "{lat_name}/ESA_WorldCover_10m_2021_v200_{cell}_S2RGBNIR.tif"
)
IGN_URL = (
    "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
    "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM"
    "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg"
)

# High-resolution aerial photos, by country (the "detailed" tier, zoom 14 and up):
# open data from national or regional mapping agencies, each checked to answer
# tile requests and to allow reuse. "regions": the Geofabrik regions they cover
# (downloads are cut to them); "bbox": a tighter limit (Belgium's two regions);
# "wms": a WMS GetMap URL with {bbox} (EPSG:3857) instead of a tile template.
# Left out: Switzerland (offline copies must come from its file download service,
# not the tile server), Denmark (needs a key), Norway (no open imagery tiles).
DETAILED_SOURCES: dict[str, dict] = {
    "fr_ign": {
        "name": "France (IGN)",
        "regions": ["france"],
        "url": IGN_URL,
        "resolution": "20 cm",
        "attribution": "© IGN (Licence Ouverte)",
        "per_second": 20,
    },
    "es_pnoa": {
        "name": "Spain (IGN, PNOA)",
        "regions": ["spain"],
        "url": "https://www.ign.es/wmts/pnoa-ma?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0"
        "&LAYER=OI.OrthoimageCoverage&STYLE=default&TILEMATRIXSET=GoogleMapsCompatible"
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© IGN España, PNOA (CC BY 4.0)",
    },
    "nl_pdok": {
        "name": "Netherlands (PDOK)",
        "regions": ["netherlands"],
        "url": "https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_orthoHR/EPSG:3857/{z}/{x}/{y}.jpeg",
        "resolution": "8 cm",
        "attribution": "© Beeldmateriaal Nederland, PDOK (CC BY 4.0)",
    },
    "lu_geoportail": {
        "name": "Luxembourg (geoportail.lu)",
        "regions": ["luxembourg"],
        "url": "https://wmts1.geoportail.lu/opendata/wmts/ortho_latest/GLOBAL_WEBMERCATOR_4_V3/{z}/{x}/{y}.jpeg",
        "resolution": "20 cm",
        "attribution": "© Geoportail Luxembourg (CC0)",
    },
    "at_basemap": {
        "name": "Austria (basemap.at)",
        "regions": ["austria"],
        "url": "https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg",
        "resolution": "30 cm",
        "attribution": "© basemap.at (CC BY 4.0)",
    },
    "be_flanders": {
        "name": "Belgium: Flanders",
        "regions": ["belgium"],
        "bbox": (2.53, 50.67, 5.93, 51.51),
        "url": "https://geo.api.vlaanderen.be/OMWRGBMRVL/wmts?SERVICE=WMTS&REQUEST=GetTile"
        "&VERSION=1.0.0&LAYER=omwrgbmrvl&STYLE=&TILEMATRIXSET=GoogleMapsVL"
        "&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png",
        "format": "png",
        "bytes": 80_000,
        "resolution": "25 cm",
        "attribution": "© Digitaal Vlaanderen (Modellicentie Gratis Hergebruik)",
    },
    "be_wallonia": {
        "name": "Belgium: Wallonia",
        "regions": ["belgium"],
        "bbox": (2.83, 49.49, 6.41, 50.82),
        "wms": "https://geoservices.wallonie.be/arcgis/services/IMAGERIE/ORTHO_LAST/MapServer/WMSServer"
        "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=0&STYLES=&CRS=EPSG:3857"
        "&BBOX={bbox}&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© SPW, Wallonie (CC BY 4.0)",
    },
    "de_nrw": {
        "name": "Germany: North Rhine-Westphalia",
        "regions": ["nordrhein-westfalen"],
        "wms": "https://www.wms.nrw.de/geobasis/wms_nw_dop?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=nw_dop_rgb&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "10 cm",
        "attribution": "© Geobasis NRW (dl-de/zero-2-0)",
    },
    "de_bayern": {
        "name": "Germany: Bavaria",
        "regions": ["bayern"],
        "wms": "https://geoservices.bayern.de/od/wms/dop/v1/dop40?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=by_dop40c&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "40 cm",
        "maxzoom": 16,
        "attribution": "© Bayerische Vermessungsverwaltung (CC BY 4.0)",
    },
    "de_berlin": {
        "name": "Germany: Berlin",
        "regions": ["berlin"],
        "wms": "https://gdi.berlin.de/services/wms/truedop_2024?SERVICE=WMS&VERSION=1.3.0"
        "&REQUEST=GetMap&LAYERS=truedop_2024&STYLES=&CRS=EPSG:3857&BBOX={bbox}"
        "&WIDTH=256&HEIGHT=256&FORMAT=image/jpeg",
        "resolution": "20 cm",
        "attribution": "© Geoportal Berlin (dl-de/zero-2-0)",
    },
    "cz_cuzk": {
        "name": "Czechia (ČÚZK)",
        "regions": ["czech-republic"],
        "url": "https://ags.cuzk.gov.cz/arcgis1/rest/services/ORTOFOTO_WM/MapServer/tile/{z}/{y}/{x}",
        "resolution": "20 cm",
        "attribution": "© ČÚZK (CC BY 4.0)",
    },
    "pl_geoportal": {
        "name": "Poland (Geoportal)",
        "regions": ["poland"],
        "url": "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution"
        "?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default"
        "&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg",
        "resolution": "25 cm",
        "attribution": "© GUGiK, Geoportal.gov.pl",
    },
    "ee_maaamet": {
        "name": "Estonia (Maa- ja Ruumiamet)",
        "regions": ["estonia"],
        "url": "https://tiles.maaamet.ee/tm/tms/1.0.0/foto@GMC/{z}/{x}/{ty}.jpg",
        "resolution": "25 cm",
        "attribution": "© Maa- ja Ruumiamet",
    },
    "us_usgs": {
        "name": "United States (USGS, NAIP)",
        "regions": ["us"],
        "url": "https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}",
        "resolution": "60 cm to 1 m",
        "maxzoom": 16,
        "attribution": "USDA NAIP, USGS The National Map (public domain)",
    },
}
DETAILED_DEFAULTS = {"format": "jpg", "maxzoom": 17, "per_second": 10, "bytes": 22_000}


def detailed_source(source_id: str) -> dict:
    return {**DETAILED_DEFAULTS, **DETAILED_SOURCES[source_id], "id": source_id}


def attribution_for(name: str) -> str:
    """The credit line for an imagery file, from its name (<area>.sat-<tier>[-<source>]).
    The scripts pass it to the frontend with the file (VITE_SATELLITE_TIERS), so this
    is the only list of credits."""
    stem = Path(name).name.removesuffix(".pmtiles")
    tier = stem.rsplit(".sat-", 1)[-1]
    if tier.startswith("detailed-") and tier[len("detailed-") :] in DETAILED_SOURCES:
        return DETAILED_SOURCES[tier[len("detailed-") :]]["attribution"]
    if tier == "detailed":  # before there were several sources: IGN's
        return DETAILED_SOURCES["fr_ign"]["attribution"]
    return TIERS[tier][3] if tier in TIERS else ""


def tile_url(source: dict, z: int, x: int, y: int) -> str:
    """A tile's URL from a source (a tile template, or a WMS GetMap for the tile)."""
    if "wms" in source:
        size = EARTH_CIRCUMFERENCE_M / 2**z
        half = EARTH_CIRCUMFERENCE_M / 2
        west, north = -half + x * size, half - y * size
        return source["wms"].format(
            bbox=f"{west:.2f},{north - size:.2f},{west + size:.2f},{north:.2f}"
        )
    return source["url"].format(z=z, x=x, y=y, ty=2**z - 1 - y)


TIERS = {
    # name: (minzoom, maxzoom, tile format, attribution)
    "overview": (0, 8, "jpg", "NASA Blue Marble"),
    "regional": (
        9,
        12,
        "webp",
        "Contains modified Copernicus Sentinel data (2021), ESA WorldCover (CC BY 4.0)",
    ),
    "detailed": (14, 16, "jpg", "IGN orthophotos (Licence Ouverte)"),
}
WORLD_OVERVIEW_ZOOM = 5
# The whole world to zoom 8 (overview --world, shared by every region): 87,381
# tiles, measured at about 3.8 KB each (mostly ocean).
WORLD_OVERVIEW_BYTES = 330_000_000
WORLD_BBOX = (-180.0, -85.0511, 180.0, 85.0511)

# Average tile sizes measured on Luxembourg and Alsace (bytes), for estimates.
AVERAGE_TILE_BYTES = {"overview": 6_500, "regional": 9_000, "detailed": 22_000}
# Bytes read from the 10 m composite per km² (RGBN, deflate): full resolution for
# zoom 13, the 20 m overview for zoom 12 and below.
WORLDCOVER_BYTES_PER_KM2 = {13: 70_000, 12: 18_000, 11: 4_500, 10: 1_100, 9: 300}
# Size of the regional tier per km² of land, zoom 9 up to the key (France to 12:
# 195 MB for 551,000 km²; each zoom level more is four times as many tiles).
REGIONAL_BYTES_PER_KM2 = {9: 6, 10: 22, 11: 89, 12: 354, 13: 1_416}
# Land the composite covers (no Antarctica; it stops near 84° N).
WORLD_LAND_KM2 = 134_000_000
WORLDCOVER_LATITUDES = range(-60, 84)

EARTH_CIRCUMFERENCE_M = 40_075_016.686
# Below this a tile may be a server's blank "no data" tile (download_tiles).
SMALL_TILE = 8_000


def worldcover_url(cell: str) -> str:
    return WORLDCOVER_URL.format(lat_name=cell[:3], cell=cell)
