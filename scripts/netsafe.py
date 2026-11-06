"""
Fork: downloads that survive a lost connection, for every Python script that
downloads (satellite imagery, extra data, the Wikidata cache). The shell scripts
do the same with `download` / `safely` (scripts/lib/net.sh), with the same settings.

    safely(call, url)       call() until it works (call: one request, or one
                            whole download that can be run again)
    checked(response)       an httpx response, its HTTP error raised (inside call)
    fetch(url)              a URL's bytes (standard library), through safely()
    run_until_connected(main)  main(), exiting with CONNECTION_LOST (75) and a short
                            message instead of a traceback when the connection is lost

When a request fails (no network, the server hanging up, a timeout, 429, 5xx):

1. it's tried again `retries` times, `pause` × 1, 2, 3... seconds apart;
2. still failing, and the server answers: a busy server dropping requests, or this
   request failing. Rest (NET_CHECK_EVERY × 2 s) and try again, up to ROUNDS_UP
   times, then raise the error, as without this module;
3. the server doesn't answer: the connection is down. Wait for it, checking every
   NET_CHECK_EVERY seconds for up to NET_WAIT_SECONDS (15 min), then try again.
   It doesn't come back: ConnectionLost (what's downloaded stays; the scripts go
   on where they stopped when run again).

Standard library only (satellite.py runs with plain python3). httpx's errors are
recognised by their class names, without importing httpx.
"""

from __future__ import annotations

import http.client
import os
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from typing import TypeVar

T = TypeVar("T")

USER_AGENT = "OpenInfraMap-local (offline map setup)"

# The same settings as scripts/lib/net.sh (which exports them).
WAIT_LIMIT = float(os.environ.get("NET_WAIT_SECONDS", "900"))
WAIT_STEP = float(os.environ.get("NET_CHECK_EVERY", "15"))
RETRIES = 4
# Rounds of retries while the server answers, before giving up on the request.
ROUNDS_UP = 3

# The exit status when the connection is lost (EX_TEMPFAIL); the shell scripts
# stop the remaining downloads and say to run again.
CONNECTION_LOST = 75

# Server answers worth trying again: too many requests, the server's own trouble.
TRY_AGAIN = (408, 429, 500, 502, 503, 504)

# Answers that mean "nothing here": fetch() returns None for them.
MISSING = (400, 404)


class ConnectionLost(Exception):
    """The connection didn't come back in time: stop, keeping what's downloaded."""


# --- What went wrong --------------------------------------------------------------


def http_status(error: BaseException) -> int | None:
    """The HTTP status of an error answer (urllib's or httpx's), else None."""
    if isinstance(error, urllib.error.HTTPError):
        return error.code
    response = getattr(error, "response", None)  # httpx.HTTPStatusError
    return getattr(response, "status_code", None)


def worth_retrying(error: BaseException) -> bool:
    """A failure that may go away: the network, a timeout, the server's trouble."""
    status = http_status(error)
    if status is not None:
        return status in TRY_AGAIN
    if isinstance(error, (OSError, http.client.HTTPException)):
        return True  # URLError, TimeoutError, RemoteDisconnected, ConnectionReset...
    # httpx: its network errors (ConnectError, ReadTimeout, RemoteProtocolError...)
    # all derive from TransportError.
    return any(c.__name__ == "TransportError" for c in type(error).__mro__)


# --- The connection ---------------------------------------------------------------


def say(message: str) -> None:
    """A message on its own line (a progress counter may be rewriting its line)."""
    print(f"\n  {message}", file=sys.stderr, flush=True)


def host_of(url: str) -> str:
    return urllib.parse.urlsplit(url).netloc or url


def reachable(url: str) -> bool:
    """Whether the server answers at all (any answer, even an error, will do)."""
    parts = urllib.parse.urlsplit(url)
    request = urllib.request.Request(
        f"{parts.scheme}://{parts.netloc}/",
        method="HEAD",
        headers={"User-Agent": USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=20):
            return True
    except urllib.error.HTTPError:
        return True
    except (OSError, http.client.HTTPException):
        return False


class Connection:
    """Waiting for the connection, once for every thread: the first thread to find
    it down waits; the others wait for that thread, then go on (or stop) with it."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.came_back = 0.0  # time.monotonic() of the last time it came back
        self.lost = False

    def wait(self, url: str, failed_at: float) -> None:
        with self.lock:
            if self.lost:
                raise ConnectionLost()
            if self.came_back > failed_at:
                return  # another thread already waited for it
            say(
                f"No answer from {host_of(url)}: waiting for the connection "
                f"(up to {WAIT_LIMIT / 60:.0f} min)..."
            )
            deadline = time.monotonic() + WAIT_LIMIT
            while time.monotonic() < deadline:
                time.sleep(WAIT_STEP)
                if reachable(url):
                    say("Connection back: going on.")
                    self.came_back = time.monotonic()
                    return
            self.lost = True
            raise ConnectionLost()


connection = Connection()


# --- Downloading --------------------------------------------------------------------


def safely(
    call: Callable[[], T],
    url: str,
    retries: int = RETRIES,
    pause: float = 1.0,
    also_retry: tuple[type[BaseException], ...] = (),
    rounds_up: int = ROUNDS_UP,
    wait: bool = True,
    report: bool = False,
) -> T:
    """call(), again until it works (see the module's description). `url` is the
    server, to tell a lost connection from a failing request. also_retry: other
    errors that may be the network's (a Docker command reading URLs). rounds_up:
    rounds of retries while the server answers (0: give up then). wait=False: a
    lost connection raises the error instead of waiting (small requests made while
    the scripts ask their questions, which have a fallback). report: say each
    failed attempt (a few long downloads; not thousands of tiles)."""
    rounds = 0
    while True:
        if connection.lost:
            raise ConnectionLost()  # another thread gave up: stop at once
        started = time.monotonic()
        for attempt in range(1, retries + 1):
            try:
                return call()
            except Exception as error:
                if not (worth_retrying(error) or isinstance(error, also_retry)):
                    raise
                last = error
                if report:
                    print(
                        f"      attempt {attempt} failed ({str(error).splitlines()[0][:120]})",
                        flush=True,
                    )
            if attempt < retries:
                time.sleep(pause * attempt)
        if reachable(url):
            # The server answers: not the connection. A busy server: rest, try again.
            rounds += 1
            if rounds > rounds_up:
                raise last
            time.sleep(WAIT_STEP * 2)
            continue
        if not wait:
            raise last
        connection.wait(url, failed_at=started)


def fetch(url: str, timeout: float = 60, user_agent: str = USER_AGENT) -> bytes | None:
    """A URL's bytes, or None if the server has nothing there (400, 404)."""

    def get() -> bytes | None:
        request = urllib.request.Request(url, headers={"User-Agent": user_agent})
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code in MISSING:
                return None
            raise

    return safely(get, url)


def checked(response: T) -> T:
    """An httpx response, raising its HTTP error (for safely(): 5xx are retried)."""
    response.raise_for_status()  # type: ignore[attr-defined]
    return response


def run_until_connected(main: Callable[[], None]) -> None:
    """main(); a lost connection ends it with a short message and CONNECTION_LOST."""
    try:
        main()
    except ConnectionLost:
        say(
            f"The connection didn't come back in {WAIT_LIMIT / 60:.0f} min: stopped. "
            "What was downloaded is kept; run again to go on from there."
        )
        sys.exit(CONNECTION_LOST)
