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


def iris(code, name):
    return {"properties": {"code_iris": code, "nom_iris": name}}


def test_a_city_s_neighbourhoods_are_its_grand_quartiers_named_from_their_iris():
    from extradata.neighbourhoods import neighbourhood_names, neighbourhoods_of

    found = [
        iris("674821205", "Neudorf Ouest Nord-Ouest"),
        iris("674821206", "Neudorf Ouest Sud"),
        iris("674821303", "Elsau Est"),
    ]
    of = neighbourhoods_of(found)
    assert of["674821205"] == of["674821206"] == "6748212"
    assert neighbourhood_names(found, of) == {
        "6748212": "Neudorf Ouest",
        "6748213": "Elsau Est",
    }


def test_a_town_in_one_grand_quartier_has_its_iris_as_neighbourhoods():
    from extradata.neighbourhoods import neighbourhood_names, neighbourhoods_of

    molsheim = [
        iris(f"6730001{n:02}", name)
        for n, name in enumerate(["Nord", "Est", "Sud-Est", "Sud-Ouest"], 1)
    ]
    of = neighbourhoods_of(molsheim)
    assert sorted(set(of.values())) == [
        "673000101",
        "673000102",
        "673000103",
        "673000104",
    ]
    assert sorted(neighbourhood_names(molsheim, of).values()) == [
        "Est",
        "Nord",
        "Sud-Est",
        "Sud-Ouest",
    ]


def test_two_neighbourhoods_of_a_commune_never_share_a_name():
    from extradata.neighbourhoods import neighbourhood_names, neighbourhoods_of

    found = [
        iris("674822601", "Canardière Est"),
        iris("674822602", "Canardière Est Nord"),
        iris("674822701", "Canardière Ouest"),
        iris("674822702", "Canardière Ouest Sud"),
        iris("674822801", "Polygone"),
    ]
    of = neighbourhoods_of(found)
    names = neighbourhood_names(found, of)
    assert (
        names["6748226"] == "Canardière Est" and names["6748227"] == "Canardière Ouest"
    )
    assert len(set(names.values())) == len(names)


def test_names_still_alike_get_their_code_s_digits():
    from extradata.neighbourhoods import unique_in_communes

    names = unique_in_communes(
        {"6748201": "Gare", "6748202": "Gare"}, {"6748201": "Gare", "6748202": "Gare"}
    )
    assert names == {"6748201": "Gare 01", "6748202": "Gare 02"}


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
