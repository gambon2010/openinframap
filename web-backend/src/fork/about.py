"""
Fork: the "about" page, replacing upstream's at /about (upstream's described the
public website). What this map is, the data it was built from (region, OpenStreetMap
extract date: oim_build_info; outside datasets: extra.source), credits and
licences, and how to use it. Its template is the fork's (templates/about.html),
built on upstream's page layout (_base.html).
"""

from pathlib import Path
from typing import cast

from jinja2 import ChoiceLoader, Environment, FileSystemLoader
from sqlalchemy import text
from starlette.requests import Request as StarletteRequest
from starlette.responses import Response
from starlette.routing import Route
from starlette.templating import Jinja2Templates

from .. import Request, get_db
from ..config import WIKIDATA_JSON_DIR
from ..templates import templates as upstream

FORK_TEMPLATES = Path(__file__).parent / "templates"

# The fork's templates first, then upstream's (for the layout), with upstream's filters.
_env = Environment(
    loader=ChoiceLoader([FileSystemLoader(str(FORK_TEMPLATES)), upstream.env.loader]),  # type: ignore[list-item]
    autoescape=True,
)
_env.filters.update(upstream.env.filters)
_env.globals.update(upstream.env.globals)
templates = Jinja2Templates(env=_env)


async def build_info(db) -> dict[str, str]:
    """What the map was built from (scripts' oim_build_info), empty if unknown."""
    if (await db.execute(text("SELECT to_regclass('public.oim_build_info')"))).scalar() is None:
        return {}
    rows = await db.execute(text("SELECT key, value FROM oim_build_info"))
    return {key: value for key, value in rows}


async def extra_sources(db) -> list[dict]:
    """The datasets from outside OpenStreetMap (scripts/extra_data.py)."""
    if (await db.execute(text("SELECT to_regclass('extra.source')"))).scalar() is None:
        return []
    rows = await db.execute(
        text("SELECT name, licence, attribution, url, features, imported_at FROM extra.source ORDER BY name")
    )
    return [dict(row._mapping) for row in rows]


def wikidata_count() -> int:
    """How many Wikidata entries are kept offline (scripts/fetch_images.py)."""
    try:
        return sum(1 for _ in WIKIDATA_JSON_DIR.glob("*.json"))
    except OSError:
        return 0


async def about(request: Request) -> Response:
    db = get_db(request)
    context = {
        "request": request,
        "build": await build_info(db),
        "sources": await extra_sources(db),
        "wikidata": wikidata_count(),
    }
    return templates.TemplateResponse(cast(StarletteRequest, request), "fork_about.html", context)


routes = [Route("/about", endpoint=about, name="fork_about")]
