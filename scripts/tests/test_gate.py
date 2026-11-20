"""gate/: the map's service worker never stands between the browser and the gate.

Upstream's Vite config builds a worker that answers every page visit itself: in the
built page it served the map for /login (the login page unreachable, a loop when
the session ended) and kept an old build showing after going back to Vite's dev
server."""

import re
from pathlib import Path

GATE = Path(__file__).resolve().parents[2] / "gate"


def location(name: str) -> str:
    """The body of the gate's `location = <name> { ... }`."""
    config = (GATE / "nginx.conf").read_text()
    found = re.search(r"location = " + re.escape(name) + r" \{(.*?)\}", config, re.S)
    assert found, f"nginx.conf has no location for {name}"
    return found.group(1)


def test_the_page_never_registers_the_worker():
    assert 'return 200 "";' in location("/registerSW.js")


def test_a_browser_that_has_the_worker_gets_one_that_removes_itself():
    served = location("/sw.js")
    assert "root /etc/nginx/service-worker;" in served
    assert 'Cache-Control "no-store"' in served
    worker = (GATE / "service-worker" / "sw.js").read_text()
    assert "self.skipWaiting()" in worker
    assert "self.registration.unregister()" in worker
    assert "caches.delete(name)" in worker
    dockerfile = (GATE / "Dockerfile").read_text()
    assert "COPY service-worker/ /etc/nginx/service-worker/" in dockerfile
