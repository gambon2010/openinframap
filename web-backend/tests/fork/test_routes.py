"""The fork's routes come before upstream's (src/main.py), so a fork route at an
address upstream also serves replaces upstream's there. That's meant for a few
(REPLACES); anywhere else it would hide an upstream feature without anyone
noticing: after a merge from upstream, a new upstream route at an address the fork
uses fails this test."""

import re

from starlette.routing import Mount, Route

# The addresses where the fork means to replace upstream (docs/FORK_CHANGES.md).
REPLACES = {
    "/about",  # the about page: this map, its data, credits, help
    "/search/typeahead",  # the search box: substations, plants, places, towers...
    "/api/circuit/{}",  # circuits named even when OSM gives no name
    "/api/line/{}",
    "/api/substation/{}",
}


def addresses(routes) -> dict[str, set[str]]:
    """Each route's address (parameters as {}; a mount as its prefix + /*) and methods."""
    found: dict[str, set[str]] = {}
    for route in routes:
        if isinstance(route, Route):
            found.setdefault(re.sub(r"\{[^}]+\}", "{}", route.path), set()).update(route.methods or {"*"})
        elif isinstance(route, Mount):
            found.setdefault(route.path + "/*", set()).add("*")
    return found


def upstream_and_fork():
    from src import main
    from src.fork import routes as fork_routes

    fork = addresses(fork_routes)
    upstream = addresses(r for r in main.routes if r not in fork_routes)
    return upstream, fork


def test_the_fork_replaces_only_what_it_means_to():
    upstream, fork = upstream_and_fork()
    same = {
        path
        for path in set(upstream) & set(fork)
        if upstream[path] & fork[path] or "*" in upstream[path] | fork[path]
    }
    assert same == REPLACES


def test_no_fork_mount_covers_an_upstream_route():
    upstream, fork = upstream_and_fork()
    for mount in (p for p in fork if p.endswith("/*")):
        prefix = mount[:-1]
        assert not [p for p in upstream if p.startswith(prefix)], mount
