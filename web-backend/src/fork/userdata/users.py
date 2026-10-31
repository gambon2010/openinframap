"""
Fork: who is asking. The login middleware (auth/middleware.py) puts the logged-in
user on each request; the routes and changes.py ask current_user() and never look
at the request themselves. ANYONE (every right) is only for requests that didn't go
through the middleware (tests, scripts).
"""

from dataclasses import dataclass

from ... import Request


@dataclass(frozen=True)
class User:
    id: str | None
    name: str | None
    is_admin: bool = False
    can_set_statuses: bool = False


ANYONE = User(id=None, name=None, is_admin=True, can_set_statuses=True)


def current_user(request: Request) -> User:
    """The user making the request."""
    user = request.scope.get("user")
    return user if isinstance(user, User) else ANYONE


def can_set_statuses(user: User) -> bool:
    """Whether a user may set map features' statuses (docs/plans/feature-status.md:
    a right admins give). Everyone may see them."""
    return user.can_set_statuses or user.is_admin
