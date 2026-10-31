"""
Fork: who is asking. There are no accounts yet, so it's anyone, with every right.
Login and access control (docs/plans/sync.md) go here: the routes and changes.py
ask current_user() and never look at the request themselves.
"""

from dataclasses import dataclass

from ... import Request


@dataclass(frozen=True)
class User:
    id: str | None
    name: str | None


ANYONE = User(id=None, name=None)


def current_user(request: Request) -> User:
    """The user making the request (anyone, until there's a login)."""
    return ANYONE


def can_set_statuses(user: User) -> bool:
    """Whether a user may set map features' statuses (docs/plans/feature-status.md:
    only some users, once there are accounts). Everyone may see them."""
    return True
