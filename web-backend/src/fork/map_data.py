"""
Fork: map data for the frontend that tiles don't give: the full geometry of a map
feature (tiles only have it cut at tile edges and simplified at low zoom), to copy
it into one of My layers.
"""

import json

from sqlalchemy import text
from starlette.exceptions import HTTPException
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from .. import Request, get_db

# Tile layer -> (table, id column): where a copied map feature's full geometry is.
SOURCE_TABLES: dict[str, tuple[str, str]] = {
    "power_line": ("osm_power_line", "osm_id"),
    "power_tower": ("osm_power_tower", "osm_id"),
    "power_portal_way": ("osm_power_tower", "osm_id"),
    "power_substation": ("substation", "osm_id"),
    "power_substation_point": ("substation", "osm_id"),
    "power_plant": ("power_plant", "osm_id"),
    "power_plant_point": ("power_plant", "osm_id"),
    "power_generator": ("osm_power_generator", "osm_id"),
    "power_generator_area": ("osm_power_generator", "osm_id"),
    "power_transformer": ("osm_power_switchgear", "osm_id"),
    "power_compensator": ("osm_power_switchgear", "osm_id"),
    "power_switch": ("osm_power_switchgear", "osm_id"),
    "telecoms_communication_line": ("osm_telecom_cable", "osm_id"),
    "telecoms_data_center": ("osm_telecom_building", "osm_id"),
    "telecoms_data_center_point": ("osm_telecom_building", "osm_id"),
    "telecoms_mast": ("osm_mast", "osm_id"),
    "telecoms_antenna": ("osm_telecom_antenna", "osm_id"),
    "telecoms_cabinet": ("osm_street_cabinet", "osm_id"),
    "petroleum_pipeline": ("osm_pipeline", "osm_id"),
    "other_pipeline": ("osm_pipeline", "osm_id"),
    "water_pipeline": ("osm_pipeline", "osm_id"),
    "petroleum_well": ("osm_petroleum_well", "osm_id"),
    "petroleum_site": ("osm_petroleum_site", "osm_id"),
    "pressurised_waterway": ("osm_pressurised_waterway", "osm_id"),
    "water_treatment_plant_polygon": ("osm_water_treatment_plant", "osm_id"),
    "water_treatment_plant_point": ("osm_water_treatment_plant", "osm_id"),
    "wastewater_plant_polygon": ("osm_wastewater_plant", "osm_id"),
    "wastewater_plant_point": ("osm_wastewater_plant", "osm_id"),
    "water_reservoir": ("osm_water_reservoir", "osm_id"),
    "water_reservoir_point": ("osm_water_reservoir", "osm_id"),
    "water_tower": ("osm_water_tower", "osm_id"),
    "water_well": ("osm_water_well", "osm_id"),
    "pumping_station_polygon": ("osm_pumping_station", "osm_id"),
    "pumping_station_point": ("osm_pumping_station", "osm_id"),
    "water_cabinet": ("osm_street_cabinet", "osm_id"),
    "extra_power_line": ("extra.power_line", "id"),
    "extra_power_substation": ("extra.power_substation", "id"),
    "extra_pipeline": ("extra.pipeline", "id"),
    "extra_facility": ("extra.facility", "id"),
    "sites_area": ("osm_site", "osm_id"),
    "sites_point": ("osm_site", "osm_id"),
}


async def source_feature(request: Request) -> Response:
    """The full geometry of a map feature (tile layer + id), to copy it into a layer."""
    db = get_db(request)
    layer = request.query_params.get("layer", "")
    if layer not in SOURCE_TABLES:
        raise HTTPException(404, "Can't copy from that layer")
    table, id_column = SOURCE_TABLES[layer]
    try:
        feature_id = int(request.query_params.get("id", ""))
    except ValueError:
        raise HTTPException(400, "Invalid id")
    row = (
        await db.execute(
            text(
                f"""SELECT ST_AsGeoJSON(ST_Transform(geometry, 4326), 7) AS geometry
                      FROM {table} WHERE {id_column} = :id LIMIT 1"""
            ),
            {"id": feature_id},
        )
    ).first()
    if not row:
        raise HTTPException(404, "Not found")
    return JSONResponse({"geometry": json.loads(row.geometry)})


routes = [Route("/userdata/source-feature", endpoint=source_feature)]
