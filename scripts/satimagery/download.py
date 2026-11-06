"""Fork: satellite imagery. Downloading tiles into an MBTiles file: polite, lazy, resumable, without blank tiles."""

from __future__ import annotations

import hashlib
import http.client
import sqlite3
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable, Iterable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .sources import SMALL_TILE, USER_AGENT, worldcover_url

# --- Writing tiles ------------------------------------------------------------


class MBTiles:
    """A minimal MBTiles writer (rows in TMS order, as the format wants)."""

    def __init__(
        self,
        path: Path,
        name: str,
        fmt: str,
        minzoom: int,
        maxzoom: int,
        attribution: str,
        bounds,
        resume: bool = False,
    ):
        # An interrupted download goes on where it stopped (resume=True).
        resuming = resume and path.exists()
        if not resuming:
            path.unlink(missing_ok=True)
        self.db = sqlite3.connect(path, check_same_thread=False)
        self.lock = threading.Lock()
        self.pending = 0
        if resuming:
            return
        self.db.executescript(
            "CREATE TABLE metadata (name text, value text);"
            "CREATE TABLE tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);"
            "CREATE UNIQUE INDEX tile_index ON tiles (zoom_level, tile_column, tile_row);"
        )
        meta = {
            "name": name,
            "format": fmt,
            "type": "baselayer",
            "minzoom": str(minzoom),
            "maxzoom": str(maxzoom),
            "attribution": attribution,
            "bounds": ",".join(f"{v:.5f}" for v in bounds),
        }
        self.db.executemany("INSERT INTO metadata VALUES (?, ?)", meta.items())

    def put(self, z: int, x: int, y: int, data: bytes) -> None:
        with self.lock:
            self.db.execute(
                "INSERT OR REPLACE INTO tiles VALUES (?, ?, ?, ?)",
                (z, x, 2**z - 1 - y, data),
            )
            # Saved as it goes, so stopping loses little.
            self.pending += 1
            if self.pending >= 500:
                self.db.commit()
                self.pending = 0

    def delete(self, z: int, x: int, y: int) -> None:
        with self.lock:
            self.db.execute(
                "DELETE FROM tiles WHERE zoom_level = ? AND tile_column = ? AND tile_row = ?",
                (z, x, 2**z - 1 - y),
            )

    def has(self, z: int) -> set[tuple[int, int]]:
        """The tiles of a zoom level already there (x, y), to skip on a resume."""
        with self.lock:
            rows = self.db.execute(
                "SELECT tile_column, tile_row FROM tiles WHERE zoom_level = ?", (z,)
            )
            return {(x, 2**z - 1 - row) for x, row in rows}

    def close(self) -> None:
        self.db.commit()
        self.db.close()


# --- The connection ------------------------------------------------------------

# A failed request is tried again RETRIES times (waiting 1, 2, 4... s). If it still
# fails, the connection is probably down: wait for it, checking every WAIT_STEP
# seconds, for up to WAIT_LIMIT, then go on where it stopped, or stop cleanly.
RETRIES = 4
WAIT_STEP = 15.0
WAIT_LIMIT = 15 * 60.0

# What a dropped or refused connection raises (URLError and TimeoutError are
# OSErrors; a server hanging up mid-answer raises RemoteDisconnected, which is one too).
NETWORK_ERRORS = (OSError, http.client.HTTPException)

# Server answers worth trying again: too many requests, the server's own trouble.
TRY_AGAIN = (408, 429, 500, 502, 503, 504)


class ConnectionLost(Exception):
    """The connection didn't come back in time: stop, keeping what's downloaded."""


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


def say(message: str) -> None:
    """A message on its own line (the progress counter rewrites its line)."""
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
    except NETWORK_ERRORS:
        return False


def fetch(url: str) -> bytes | None:
    """A tile, or None if the server has none there (404). Tried again when the
    server or the connection fails; when the connection is down, waits for it
    (Connection.wait), and raises ConnectionLost if it doesn't come back."""
    while True:
        started = time.monotonic()
        for attempt in range(RETRIES):
            try:
                request = urllib.request.Request(
                    url, headers={"User-Agent": USER_AGENT}
                )
                with urllib.request.urlopen(request, timeout=60) as response:
                    return response.read()
            except urllib.error.HTTPError as e:
                if e.code in (400, 404):
                    return None
                if e.code not in TRY_AGAIN:
                    raise
            except NETWORK_ERRORS:
                pass
            if attempt < RETRIES - 1:
                time.sleep(2**attempt)
        connection.wait(url, failed_at=started)


def download_tiles(
    tiles: Iterable[tuple[int, int, int]],
    url: str | Callable[[int, int, int], str],
    out: MBTiles,
    threads: int,
    per_second: float | None = None,
    progress: Callable[[int, int], None] | None = None,
    total: int | None = None,
    skip: Callable[[int, int, int], bool] | None = None,
    drop_repeated: bool = False,
) -> int:
    """Fetch tiles into an MBTiles file; returns how many there were. `url` is a
    template ({z} {x} {y}) or a function of z, x, y (WMS); `skip` says which are
    already there. Tiles are read lazily, so a huge list never sits in memory.
    drop_repeated: a small tile met twice byte for byte is a server's "no data"
    tile (white or empty outside its area), not imagery: none of them are kept,
    so they don't hide the imagery below."""
    if total is None:
        tiles = list(tiles)
        total = len(tiles)
    done = 0
    found = 0
    lock = threading.Lock()
    interval = 1.0 / per_second if per_second else 0.0
    next_slot = [time.monotonic()]
    # Small tiles seen once (where they are) or repeated (None: never kept).
    small: dict[bytes, tuple[int, int, int] | None] = {}

    def one(tile: tuple[int, int, int]) -> None:
        nonlocal done, found
        if connection.lost:
            raise ConnectionLost()  # the tiles still queued: stop at once
        z, x, y = tile
        if skip and skip(z, x, y):
            with lock:
                done += 1
                found += 1
            return
        if interval:
            with lock:
                wait = next_slot[0] - time.monotonic()
                next_slot[0] = max(next_slot[0], time.monotonic()) + interval
            if wait > 0:
                time.sleep(wait)
        data = fetch(
            url.format(z=z, x=x, y=y) if isinstance(url, str) else url(z, x, y)
        )
        with lock:
            done += 1
            if data and drop_repeated and len(data) < SMALL_TILE:
                key = hashlib.md5(data).digest()
                if key in small:
                    first = small[key]
                    if first:
                        out.delete(*first)
                        found -= 1
                        small[key] = None
                    data = None
                else:
                    small[key] = (z, x, y)
            if data:
                found += 1
                out.put(z, x, y, data)
            if progress and (done % 200 == 0 or done == total):
                progress(done, total)

    # In chunks: Executor.map would queue every tile at once.
    with ThreadPoolExecutor(max_workers=threads) as pool:
        chunk: list[tuple[int, int, int]] = []
        for tile in tiles:
            chunk.append(tile)
            if len(chunk) >= 5000:
                list(pool.map(one, chunk))
                chunk = []
        list(pool.map(one, chunk))
    return found


def cell_exists(cell: str) -> bool:
    """The composite has no cells over open sea."""
    url = worldcover_url(cell)
    while True:
        request = urllib.request.Request(
            url, method="HEAD", headers={"User-Agent": USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=30):
                return True
        except urllib.error.HTTPError as e:
            if e.code not in TRY_AGAIN:
                return False
        except NETWORK_ERRORS:
            pass
        connection.wait(url, failed_at=time.monotonic())
