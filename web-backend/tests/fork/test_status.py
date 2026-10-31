import pytest
from starlette.exceptions import HTTPException

from src.fork.userdata import status


def test_a_feature_is_its_table_and_id_whichever_layer_shows_it():
    assert status.feature_of("power_substation", "118086309") == ("substation", "osm_id", 118086309)
    assert status.feature_of("power_substation_point", 118086309)[:2] == ("substation", "osm_id")
    assert status.feature_of("extra_facility", 5) == ("extra.facility", "id", 5)


def test_unknown_layers_and_bad_ids_are_refused():
    with pytest.raises(HTTPException) as e:
        status.feature_of("label_place", 1)
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        status.feature_of("power_line", "abc")
    assert e.value.status_code == 400


def test_only_problems_are_shown():
    assert set(status.PROBLEMS) < set(status.STATUSES)
    assert not {"operational", "repaired", "unknown"} & set(status.PROBLEMS)


def test_extra_fields_are_checked():
    assert status.clean_details({"stock": "low", "short": " water, bread ", "capacity": ""}) == {
        "stock": "low",
        "short": "water, bread",
    }
    assert status.clean_details(None) == {}
    for bad in ({"stock": "plenty"}, {"colour": "red"}, ["stock"]):
        with pytest.raises(HTTPException) as e:
            status.clean_details(bad)
        assert e.value.status_code == 400


def test_a_status_typed_in_the_search_box():
    from src.fork.search import statuses_named

    assert statuses_named("Damaged") == ["damaged"]
    assert statuses_named("under rep") == ["under_repair"]
    assert statuses_named("dest") == ["destroyed"]
    assert statuses_named("dam") == []  # too short: also "dam" (a site)
    assert statuses_named("suspected  damage") == ["suspected_damage"]
    assert statuses_named("marlenheim") == []


def test_small_parts_cant_have_a_status():
    for layer in ("power_switch", "power_compensator", "telecoms_cabinet"):
        with pytest.raises(HTTPException) as e:
            status.feature_of(layer, 1)
        assert e.value.status_code == 404
