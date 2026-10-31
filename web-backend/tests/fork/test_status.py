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
