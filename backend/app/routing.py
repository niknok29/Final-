"""Routing providers (mock / OSRM) behind a circuit breaker, with a Haversine straight-line fallback."""
import os
import time
from concurrent.futures import ThreadPoolExecutor

import httpx

from .util import haversine

SPEED = 30 / 3.6  # m/s, ~30 km/h city speed
TIMEOUT = 2.0  # seconds: hard cap for one provider call (a request never waits longer for the provider)
SLOW_DELAY = 3.0  # simulated latency in the "slow" state; >= TIMEOUT means the call times out


class ProviderError(Exception):
    pass


class CircuitBreaker:
    def __init__(self, threshold: int = 3, cooldown: float = 30.0):
        self.threshold, self.cooldown = threshold, cooldown
        self.failures, self.opened_at = 0, None

    @property
    def is_open(self) -> bool:
        if self.opened_at is None:
            return False
        return time.monotonic() - self.opened_at < self.cooldown  # after cooldown: half-open (one trial call)

    def success(self):
        self.failures, self.opened_at = 0, None

    def failure(self):
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()


def _pack(path):
    d = sum(haversine(*p, *q) for p, q in zip(path, path[1:]))
    return {"distanceMeters": round(d), "durationSec": round(d / SPEED), "path": path}


class MockProvider:
    """Pretends to be an external routing API: a main route plus one alternative."""

    @staticmethod
    def _via(a, b, bend):
        mid = ((a[0] + b[0]) / 2 - (b[1] - a[1]) * bend, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend)
        return [list(a), [round(mid[0], 6), round(mid[1], 6)], list(b)]

    def route(self, a, b):
        return [_pack(self._via(a, b, bend)) for bend in (0.12, -0.25)]


class OsrmProvider:
    """Public OSRM demo server (driving profile). The call runs in a worker thread so the request thread
    never waits longer than TIMEOUT, whatever the network does."""

    BASE = "https://router.project-osrm.org"
    _pool = ThreadPoolExecutor(max_workers=4)

    def __init__(self, transport=None):
        self.client = httpx.Client(transport=transport)

    def _fetch(self, url):
        r = self.client.get(url, params={"overview": "simplified", "geometries": "geojson", "alternatives": "true"},
                            timeout=TIMEOUT)
        r.raise_for_status()
        return r.json()

    def route(self, a, b):
        url = f"{self.BASE}/route/v1/driving/{round(a[1], 6)},{round(a[0], 6)};{round(b[1], 6)},{round(b[0], 6)}"
        try:
            data = self._pool.submit(self._fetch, url).result(timeout=TIMEOUT)
            if data.get("code") != "Ok":
                raise ProviderError("OSRM code " + str(data.get("code")))
            return [
                {"distanceMeters": round(r["distance"]), "durationSec": round(r["duration"]),
                 "path": [[round(lat, 6), round(lng, 6)] for lng, lat in r["geometry"]["coordinates"]]}
                for r in data["routes"][:2]
            ]
        except ProviderError:
            raise
        except Exception as e:  # timeout, network error, bad status, unexpected payload
            raise ProviderError(f"{type(e).__name__}: {e}") from e


provider = OsrmProvider() if os.getenv("ROUTING_PROVIDER", "mock").lower() == "osrm" else MockProvider()
breaker = CircuitBreaker()
state = "down" if os.getenv("MOCK_ROUTING_DOWN") == "1" else "up"  # forced via POST /api/sim/provider: up | down | slow
listener = None  # called with {"state","breaker"} whenever that snapshot changes (realtime hooks in here)


def status() -> dict:
    return {"state": state, "breaker": "open" if breaker.is_open else "closed"}


_last = status()


def _changed(force: bool = False):
    global _last
    snap = status()
    if force or snap != _last:
        _last = snap
        if listener:
            listener(snap)


def routing_up() -> bool:
    return state == "up" and not breaker.is_open


def set_state(new: str):
    """Force the provider into outage / latency mode (or back to normal, which also closes the breaker)."""
    global state
    state = new
    if new == "up":
        breaker.success()
    _changed(force=True)


def _simulate():
    if state == "down":
        raise ProviderError("simulated outage")
    if state == "slow":
        time.sleep(min(SLOW_DELAY, TIMEOUT))
        if SLOW_DELAY >= TIMEOUT:
            raise ProviderError("simulated timeout")


def plan(a, b, ctx: dict | None = None):
    """Returns (main_route, alternatives, source). Falls back to a straight line when the provider is
    unavailable. `ctx` is shared by all calls of one request: after one failure the rest skip the provider,
    so a request waits for a failing provider at most once (<= TIMEOUT)."""
    ctx = ctx if ctx is not None else {}
    if not ctx.get("failed") and not breaker.is_open:
        try:
            _simulate()
            routes = provider.route(a, b)
            breaker.success()
            _changed()
            return routes[0], [{"label": f"Alternativ {i}", **r} for i, r in enumerate(routes[1:], 1)], "provider"
        except Exception:
            ctx["failed"] = True
            breaker.failure()
            _changed()
    return _pack([list(a), list(b)]), [], "fallback"
