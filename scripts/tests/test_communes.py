"""scripts/extradata/communes.py: the communes' short codes ("WIS" for Wisches)."""

from extradata.communes import plain, short_codes


def test_a_commune_gets_its_first_three_letters():
    assert short_codes({"67539": "Wisches"}) == {"67539": "WIS"}


def test_small_words_and_saint_left_out():
    assert short_codes({"64483": "Saint-Jean-de-Luz"})["64483"] == "JEA"


def test_unique_within_a_departement_the_first_in_insee_order_keeps_its_code():
    codes = short_codes({"67001": "Wisches", "67002": "Wissembourg"})
    assert codes["67001"] == "WIS"
    assert codes["67002"] != "WIS" and codes["67002"].startswith("W")


def test_the_same_code_in_two_departements():
    codes = short_codes({"67539": "Wisches", "68001": "Wisches"})
    assert codes["67539"] == codes["68001"] == "WIS"


def test_overseas_departements_have_three_digits():
    codes = short_codes({"97101": "Abymes", "97401": "Abymes"})
    assert codes["97101"] == codes["97401"] == "ABY"


def test_accents_and_apostrophes():
    assert plain("L'Île-d'Yeu") == "L ILE D YEU"
