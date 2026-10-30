"""scripts/make_symbol_catalog.py: codes and names from the MIL-STD-2525 tables."""

from make_symbol_catalog import sidc, title


def row(**values):
    base = {
        "codingscheme": "S",
        "affiliation": "*",
        "battledimension": "G",
        "status": "*",
        "functionid": "UCI---",
    }
    return {**base, **values}


def test_codes():
    assert sidc(row()) == "S*G*UCI---------"[:15]
    assert (
        sidc(row(functionid="IUE---")) == "S*G*IUE---H----"
    )  # installations get the H modifier
    assert sidc(
        row(
            codingscheme="E",
            affiliation="F",
            battledimension="F",
            status="P",
            functionid="A-----",
        )
    ) == ("EFFPA-----H----")
    assert (
        sidc(row(codingscheme="G", battledimension="T", functionid="B-----"))
        == "G*T*B----------"
    )


def test_headers_and_broken_rows_are_skipped():
    assert sidc(row(affiliation="-", functionid="------")) is None
    assert sidc(row(functionid="UCI")) is None
    assert sidc(row(battledimension="")) is None


def test_titles():
    assert title("CIVIL RIOTING") == "Civil rioting"
    assert title("SOF UNIT") == "SOF unit"
    assert title("ARMOUR (TRACKED)") == "Armour (tracked)"
    assert title("UNMANNED AERIAL VEHICLE (UAV)") == "Unmanned aerial vehicle (UAV)"
