"""
Fork: the backend's additions, kept apart from upstream's code. main.py puts
these routes ahead of upstream's, so a fork route can replace one of upstream's
(the search). See docs/FORK_CHANGES.md.
"""

from starlette.middleware import Middleware
from starlette.routing import BaseRoute, Mount

from . import (
    about,
    auth,
    background,
    building_numbers,
    indoor,
    circuits,
    grid,
    imagery,
    map_data,
    search,
    terrain,
    userdata,
    wikidata_offline,
)
from .auth import LoginMiddleware
from .background import buildings as background_buildings
from .background import transit as background_transit
from .paths import IMAGES_DIR
from .userdata.events import STREAMING as events_streaming

# Popups from the offline Wikidata cache (upstream's functions wrapped).
wikidata_offline.install()

routes: list[BaseRoute] = [
    # Logging in, the accounts (every other call needs a logged-in user: LoginMiddleware).
    *auth.routes,
    # Offline Wikidata images (scripts/fetch_images.py).
    Mount("/local-images", app=wikidata_offline.ImagesFolder(IMAGES_DIR), name="local-images"),
    # Replaces upstream's about page: this map, its data, credits, help.
    *about.routes,
    *search.routes,
    # Replaces upstream's at the same URLs: every circuit named.
    *circuits.routes,
    *userdata.routes,
    *map_data.routes,
    *grid.routes,
    # The background map's tiles, from every area downloaded (data/map/offline-maps/).
    *background.routes,
    *background_buildings.routes,
    *background_transit.routes,
    # Numbers for the buildings of a commune ("WIS-47"), kept for everyone.
    *building_numbers.routes,
    *indoor.routes,
    # The terrain's elevation tiles, from every area downloaded (data/map/offline-maps/).
    *terrain.routes,
    # The satellite imagery the map shows (the list the scripts write).
    *imagery.routes,
]

# main.py adds these after its database middleware (they need the connection).
middleware = [Middleware(LoginMiddleware)]

# Paths main.py's database middleware leaves alone: streams holding no connection.
streaming_paths = events_streaming
