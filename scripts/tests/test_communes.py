"""scripts/extradata/communes.py: the communes' short codes ("WIS" for Wisches)."""

from extradata.communes import department_of, plain, short_codes


def test_a_commune_gets_its_first_three_letters():
    assert short_codes({"67539": "Wisches"}, department_of) == {"67539": "WIS"}


def test_small_words_and_saint_left_out():
    assert short_codes({"64483": "Saint-Jean-de-Luz"}, department_of)["64483"] == "JEA"


def test_unique_within_a_departement_the_first_in_insee_order_keeps_its_code():
    codes = short_codes({"67001": "Wisches", "67002": "Wissembourg"}, department_of)
    assert codes["67001"] == "WIS"
    assert codes["67002"] != "WIS" and codes["67002"].startswith("W")


def test_the_same_code_in_two_departements():
    codes = short_codes({"67539": "Wisches", "68001": "Wisches"}, department_of)
    assert codes["67539"] == codes["68001"] == "WIS"


def test_overseas_departements_have_three_digits():
    codes = short_codes({"97101": "Abymes", "97401": "Abymes"}, department_of)
    assert codes["97101"] == codes["97401"] == "ABY"


def test_accents_and_apostrophes():
    assert plain("L'Île-d'Yeu") == "L ILE D YEU"


def test_neighbourhoods_named_from_their_iris():
    from extradata.neighbourhoods import (
        neighbourhood_names,
        neighbourhood_of,
        shared_start,
    )

    def iris(code, name):
        return {"properties": {"code_iris": code, "nom_iris": name}}

    names = neighbourhood_names(
        [
            iris("674821205", "Neudorf Ouest Nord-Ouest"),
            iris("674821206", "Neudorf Est"),
            iris("674821303", "Elsau Est"),
        ]
    )
    assert names == {"6748212": "Neudorf", "6748213": "Elsau Est"}
    assert neighbourhood_of("674820501") == "6748205"
    # Nothing shared: the first word most of them start with.
    assert shared_start(["Kable Nord", "Kable Sud", "Port du Rhin"]) == "Kable"


def test_an_empty_answer_from_the_iris_service_is_tried_again(tmp_path, monkeypatch):
    import httpx

    import netsafe
    from extradata.neighbourhoods import iris_of_department

    monkeypatch.setattr(netsafe, "say", lambda message: None)
    monkeypatch.setattr("time.sleep", lambda seconds: None)
    answers = iter([b"", b'{"features": [{"properties": {"code_iris": "674820101"}}]}'])

    def reply(request):
        return httpx.Response(200, content=next(answers))

    client = httpx.Client(transport=httpx.MockTransport(reply))
    assert len(iris_of_department(client, "67", tmp_path)) == 1
