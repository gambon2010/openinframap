"""Fork: password hashing (scrypt, from the standard library)."""

import base64
import hashlib
import hmac
import os

# scrypt cost: about 50 ms and 16 MB per check.
N, R, P = 2**14, 8, 1
MIN_LENGTH = 8


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32)
    return "$".join(
        ["scrypt", str(N), str(R), str(P), base64.b64encode(salt).decode(), base64.b64encode(digest).decode()]
    )


def check_password(password: str, stored: str) -> bool:
    try:
        kind, n, r, p, salt, digest = stored.split("$")
    except ValueError:
        return False
    if kind != "scrypt":
        return False
    computed = hashlib.scrypt(
        password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32
    )
    return hmac.compare_digest(computed, base64.b64decode(digest))
