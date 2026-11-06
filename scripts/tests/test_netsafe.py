"""scripts/netsafe.py: every Python download's retries and waiting for the connection."""

import http.client
import urllib.error

import pytest

import netsafe


@pytest.fixture(autouse=True)
def quick(monkeypatch):
    """No real waiting; a fresh connection state for each test."""
    monkeypatch.setattr(netsafe.time, "sleep", lambda _: None)
    monkeypatch.setattr(netsafe, "WAIT_LIMIT", 0.05)
    monkeypatch.setattr(netsafe, "connection", netsafe.Connection())
    monkeypatch.setattr(netsafe, "internet_up", lambda: False)  # no real probes


class Flaky:
    """A call failing `fails` times with `error`, then answering "ok"."""

    def __init__(self, fails, error):
        self.fails, self.error, self.calls = fails, error, 0

    def __call__(self):
        self.calls += 1
        if self.calls <= self.fails:
            raise self.error
        return "ok"


class TransportError(Exception):
    """Stands in for httpx's (recognised by its name)."""


class ReadTimeout(TransportError):
    pass


def test_what_is_worth_retrying():
    assert netsafe.worth_retrying(http.client.RemoteDisconnected("hung up"))
    assert netsafe.worth_retrying(urllib.error.URLError("no network"))
    assert netsafe.worth_retrying(TimeoutError())
    assert netsafe.worth_retrying(ReadTimeout())  # httpx's network errors
    assert netsafe.worth_retrying(urllib.error.HTTPError("u", 503, "busy", {}, None))
    assert not netsafe.worth_retrying(urllib.error.HTTPError("u", 403, "no", {}, None))
    assert not netsafe.worth_retrying(ValueError())


def test_a_short_drop_is_retried(monkeypatch):
    monkeypatch.setattr(netsafe, "reachable", lambda url: True)
    call = Flaky(2, http.client.RemoteDisconnected())
    assert netsafe.safely(call, "https://example.org/x") == "ok"
    assert call.calls == 3


def test_a_busy_server_gets_a_few_rounds_then_the_error(monkeypatch):
    monkeypatch.setattr(netsafe, "reachable", lambda url: True)
    call = Flaky(10**6, http.client.RemoteDisconnected())
    with pytest.raises(http.client.RemoteDisconnected):
        netsafe.safely(call, "https://example.org/x")
    assert call.calls == netsafe.RETRIES * (netsafe.ROUNDS_UP + 1)


def test_a_lost_connection_is_waited_for(monkeypatch):
    answers = iter([False, False, True])  # down, still down, back
    monkeypatch.setattr(netsafe, "reachable", lambda url: next(answers))
    monkeypatch.setattr(netsafe, "WAIT_LIMIT", 10**6)
    call = Flaky(netsafe.RETRIES, urllib.error.URLError("no network"))
    assert netsafe.safely(call, "https://example.org/x") == "ok"


def test_a_connection_that_stays_down_ends_in_connection_lost(monkeypatch):
    monkeypatch.setattr(netsafe, "reachable", lambda url: False)
    call = Flaky(10**6, urllib.error.URLError("no network"))
    with pytest.raises(netsafe.ConnectionLost):
        netsafe.safely(call, "https://example.org/x")
    # Every other download stops at once.
    with pytest.raises(netsafe.ConnectionLost):
        netsafe.safely(lambda: "never called", "https://example.org/y")


def test_a_server_that_stops_answering_while_the_internet_works(monkeypatch):
    # The server never answers, the probes do: not a lost connection, stop now
    # (not after WAIT_LIMIT), and every other download with it.
    monkeypatch.setattr(netsafe, "reachable", lambda url: False)
    monkeypatch.setattr(netsafe, "internet_up", lambda: True)
    monkeypatch.setattr(netsafe, "WAIT_LIMIT", 10**6)
    monkeypatch.setattr(netsafe, "SERVER_GRACE", 0)
    call = Flaky(10**6, TimeoutError())
    with pytest.raises(netsafe.ServerStopped) as stopped:
        netsafe.safely(call, "https://tiles.example.org/x")
    assert stopped.value.host == "tiles.example.org"
    with pytest.raises(netsafe.ServerStopped):
        netsafe.safely(lambda: "never called", "https://example.org/y")


def test_the_internet_going_down_too_is_a_lost_connection(monkeypatch):
    monkeypatch.setattr(netsafe, "reachable", lambda url: False)
    monkeypatch.setattr(netsafe, "SERVER_GRACE", 0)
    with pytest.raises(netsafe.ConnectionLost) as lost:
        netsafe.safely(Flaky(10**6, TimeoutError()), "https://tiles.example.org/x")
    assert not isinstance(lost.value, netsafe.ServerStopped)


def test_run_until_connected_exits_76_when_a_server_stopped(capsys):
    def main():
        raise netsafe.ServerStopped("tiles.example.org")

    with pytest.raises(SystemExit) as stop:
        netsafe.run_until_connected(main)
    assert stop.value.code == netsafe.SERVER_STOPPED == 76
    assert "tiles.example.org has stopped answering" in capsys.readouterr().err


def test_other_errors_are_raised_at_once():
    call = Flaky(1, urllib.error.HTTPError("u", 403, "forbidden", {}, None))
    with pytest.raises(urllib.error.HTTPError):
        netsafe.safely(call, "https://example.org/x")
    assert call.calls == 1


def test_run_until_connected_exits_75(capsys):
    def main():
        raise netsafe.ConnectionLost()

    with pytest.raises(SystemExit) as stop:
        netsafe.run_until_connected(main)
    assert stop.value.code == netsafe.CONNECTION_LOST == 75
    assert "run again" in capsys.readouterr().err
