"""
Fork: accounts and login for the whole app (docs/plans/sync.md, "Login for the
whole app"): passwords.py, sessions.py, routes.py (the login page, /auth/*) and
middleware.py (every other call needs a logged-in user).
"""

from .middleware import LoginMiddleware
from .routes import routes

__all__ = ["LoginMiddleware", "routes"]
