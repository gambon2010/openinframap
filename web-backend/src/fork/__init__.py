"""
Fork: the backend's additions, kept apart from upstream's code. main.py puts
these routes ahead of upstream's, so a fork route can replace one of upstream's
(the search). See docs/FORK_CHANGES.md.
"""

from starlette.routing import BaseRoute, Mount
from starlette.staticfiles import StaticFiles

from ..config import IMAGES_DIR
from . import grid, search, userdata

IMAGES_DIR.mkdir(parents=True, exist_ok=True)

routes: list[BaseRoute] = [
    # Offline Wikidata images (scripts/fetch_images.py).
    Mount("/local-images", app=StaticFiles(directory=str(IMAGES_DIR)), name="local-images"),
    *search.routes,
    *userdata.routes,
    *grid.routes,
]
