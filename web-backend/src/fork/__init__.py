"""
Fork: the backend's additions, kept apart from upstream's code. main.py puts
these routes ahead of upstream's, so a fork route can replace one of upstream's
(the search). See docs/FORK_CHANGES.md.
"""

from starlette.middleware import Middleware
from starlette.routing import BaseRoute, Mount
from starlette.staticfiles import StaticFiles

from ..config import IMAGES_DIR
from . import about, auth, circuits, grid, grid_supply, map_data, search, userdata
from .auth import LoginMiddleware
from .userdata.events import STREAMING as events_streaming

IMAGES_DIR.mkdir(parents=True, exist_ok=True)

routes: list[BaseRoute] = [
    # Logging in, the accounts (every other call needs a logged-in user: LoginMiddleware).
    *auth.routes,
    # Offline Wikidata images (scripts/fetch_images.py).
    Mount("/local-images", app=StaticFiles(directory=str(IMAGES_DIR)), name="local-images"),
    # Replaces upstream's about page: this map, its data, credits, help.
    *about.routes,
    *search.routes,
    # Replaces upstream's at the same URLs: every circuit named.
    *circuits.routes,
    *userdata.routes,
    *map_data.routes,
    *grid.routes,
    *grid_supply.routes,
]

# main.py adds these after its database middleware (they need the connection).
middleware = [Middleware(LoginMiddleware)]

# Paths main.py's database middleware leaves alone: streams holding no connection.
streaming_paths = events_streaming
