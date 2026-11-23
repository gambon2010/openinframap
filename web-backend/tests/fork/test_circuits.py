from src.fork.circuits import circuit_name, short_station


def test_a_circuit_takes_its_lines_name_for_its_number():
    lines = [
        "Liaisons 400 kV n°1 et n°2 Muhlbach - Sierentz",
        "Liaison 400 kV n°1 Muhlbach - Sierentz",
        "Liaison 400 kV n°2 Muhlbach - Sierentz",
    ]
    assert circuit_name("MUHLBL71SIERE", lines, []) == "Liaison 400 kV n°1 Muhlbach - Sierentz"
    assert circuit_name("MUHLBL72SIERE", lines, []) == "Liaison 400 kV n°2 Muhlbach - Sierentz"
    # Only the shared name: it's still right for n°1.
    assert circuit_name("MUHLBL71SIERE", lines[:1], []) == lines[0]


def test_else_the_substations_it_joins_else_its_ref():
    stations = ["Poste électrique de Muhlbach", "Poste électrique de Sierentz"]
    assert circuit_name("MUHLBL71SIERE", [None, ""], stations) == "Muhlbach – Sierentz"
    assert circuit_name("MUHLBL71SIERE", [], stations[:1]) == "MUHLBL71SIERE"
    assert circuit_name(None, [], []) is None


def test_station_names_are_shortened():
    assert short_station("Poste électrique d’Étupes") == "Étupes"
    assert short_station("Poste source de Hardt") == "Hardt"
    assert short_station("Flandre Maritime") == "Flandre Maritime"


def test_a_line_name_of_another_link_isnt_taken():
    lines = ["Liaison 225 kV n°1 Argiésans - Étupes", "Liaison 225 kV n°1 Argiésans - Étupes"]
    stations = ["Poste électrique de Argiesans", "Poste électrique de Sierentz"]
    assert circuit_name("ARGIEL61SIERE", lines, stations) == "Argiesans – Sierentz"
    lines.append("Liaison 225 kV n°1 Argiesans - Sierentz")
    assert circuit_name("ARGIEL61SIERE", lines, stations) == "Liaison 225 kV n°1 Argiesans - Sierentz"
