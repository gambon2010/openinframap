from src.fork.userdata.access import at_least, level_of
from src.fork.userdata.situations import visible
from src.fork.userdata.users import ANYONE, User

alice = User(id="1", name="Alice")
admin = User(id="2", name="Root", is_admin=True)


def test_the_owner_and_what_is_shared():
    assert level_of(alice, 1, None) == "owner"
    assert level_of(alice, 3, "view") == "view"
    assert level_of(alice, 3, "modify") == "modify"
    assert level_of(alice, 3, None) == "none"
    # Admins see nothing more of other people's layers.
    assert level_of(admin, 3, None) == "none"


def test_layers_from_before_accounts_are_open_to_everyone():
    assert level_of(alice, None, None) == "modify"
    assert level_of(admin, None, None) == "owner"
    assert level_of(ANYONE, 3, None) == "owner"


def test_levels_are_ordered():
    assert at_least("owner", "modify") and at_least("modify", "view")
    assert not at_least("view", "modify") and not at_least("none", "view")


def test_a_situation_is_seen_by_who_can_view_all_its_layers():
    assert visible(["a", "b"], {"a", "b", "c"})
    assert not visible(["a", "b"], {"a"})
    assert visible(None, set())
