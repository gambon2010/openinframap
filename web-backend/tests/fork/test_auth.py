from src.fork.auth.middleware import OPEN, cookie
from src.fork.auth.passwords import check_password, hash_password
from src.fork.auth.sessions import token_hash


def test_passwords_are_hashed_and_checked():
    stored = hash_password("correct horse")
    assert stored.startswith("scrypt$") and "correct horse" not in stored
    assert check_password("correct horse", stored)
    assert not check_password("wrong horse", stored)
    assert hash_password("correct horse") != stored  # a new salt each time
    assert not check_password("x", "not a hash")


def test_the_session_cookie_is_read_from_the_headers():
    scope = {"headers": [(b"accept", b"*/*"), (b"cookie", b"a=1; oim_session=abc-DEF_1; b=2")]}
    assert cookie(scope, "oim_session") == "abc-DEF_1"
    assert cookie({"headers": []}, "oim_session") is None


def test_tokens_are_stored_hashed():
    assert token_hash("abc") != "abc" and len(token_hash("abc")) == 64


def test_only_logging_in_is_open():
    assert "/login" in OPEN and "/auth/login" in OPEN
    assert "/userdata" not in OPEN and "/auth/users" not in OPEN
