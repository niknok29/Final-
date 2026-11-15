"""Routing providers (mock / OSRM) behind a circuit breaker, with LOCAL backup data when the provider is down:
route cache -> static district x shelter matrix -> straight-line Haversine."""
import logging
import os
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import httpx

from . import cache as response_cache
from .util import haversine

log = logging.getLogger("crisis.routing")

SPEED = 30 / 3.6  # m/s, ~30 km/h city speed
TIMEOUT = 2.0  # seconds: hard cap for one provider call (a request never waits longer for the provider)
SLOW_DELAY = 6.0  # simulated latency in the "slow" state (> 5 s); >= TIMEOUT means our own timeout fires first
DETOUR = 1.3  # detour factor applied to straight-line distances in the static matrix
CACHE_SIZE = 500
CELL_LAT, CELL_LNG = 0.0018, 0.00236  # ~200 m grid around Baku


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
        except Exception as e:  # HTTP 503, timeout, network error, unexpected payload
            raise ProviderError(f"{type(e).__name__}: {e}") from e


provider = OsrmProvider() if os.getenv("ROUTING_PROVIDER", "mock").lower() == "osrm" else MockProvider()
breaker = CircuitBreaker()
STATES = ("up", "down", "slow", "http503")
state = "down" if os.getenv("MOCK_ROUTING_DOWN") == "1" else "up"  # forced via POST /api/sim/provider
listener = None  # called with {"state","breaker"} whenever that snapshot changes (realtime hooks in here)


def status() -> dict:
    return {"state": state, "breaker": "open" if breaker.is_open else "closed"}


_last = status()


def _changed(force: bool = False):
    global _last
    snap = status()
    if force or snap != _last:
        response_cache.invalidate()  # cached provider routes must not outlive a state / breaker change
        _last = snap
        if listener:
            listener(snap)


def routing_up() -> bool:
    return state == "up" and not breaker.is_open


def set_state(new: str):
    """Force the provider into an outage / latency mode (or back to normal, which also closes the breaker)."""
    global state
    state = new
    if new == "up":
        breaker.success()
    _changed(force=True)


def _simulate():
    if state == "down":
        raise ProviderError("simulated outage")
    if state == "http503":
        raise ProviderError("HTTPStatusError: 503 Service Unavailable (simulated)")
    if state == "slow":
        time.sleep(min(SLOW_DELAY, TIMEOUT))
        if SLOW_DELAY >= TIMEOUT:
            raise ProviderError("simulated timeout")


# ---- local backup data ----
_lock = threading.Lock()
cache: OrderedDict = OrderedDict()  # (shelterId, origin grid cell) -> last successful main route
MATRIX: dict = {}  # (districtId, shelterId) -> route estimate
_DISTRICTS: list = []  # [(id, lat, lng)]


def clear_cache():
    with _lock:
        cache.clear()


def _cell(a):
    return (round(a[0] / CELL_LAT), round(a[1] / CELL_LNG))


def build_matrix(s):
    """Precompute a route for every district centroid x shelter (mock polyline, DETOUR on distance/duration)."""
    from sqlmodel import select

    from .models import District, Shelter

    districts, shelters = s.exec(select(District)).all(), s.exec(select(Shelter)).all()
    matrix = {}
    for d in districts:
        for sh in shelters:
            r = _pack(MockProvider._via((d.lat, d.lng), (sh.lat, sh.lng), 0.12))
            dist = (r["distanceMeters"]) * DETOUR
            matrix[(d.id, sh.id)] = {**r, "distanceMeters": round(dist), "durationSec": round(dist / SPEED)}
    with _lock:
        MATRIX.clear()
        MATRIX.update(matrix)
        _DISTRICTS[:] = [(d.id, d.lat, d.lng) for d in districts]


def nearest_district_id(a):
    return min(_DISTRICTS, key=lambda d: haversine(a[0], a[1], d[1], d[2]))[0] if _DISTRICTS else None


def _from(a, r):
    return {**r, "path": [list(a)] + r["path"][1:]}  # start the stored polyline at the real origin


def _remember(a, shelter_id, route):
    with _lock:
        key = (shelter_id, _cell(a))
        cache[key] = route
        cache.move_to_end(key)
        while len(cache) > CACHE_SIZE:
            cache.popitem(last=False)


def _backup(a, b, shelter_id):
    """Returns (route, fallbackMode): cache -> static_matrix -> straight_line."""
    if shelter_id:
        with _lock:
            key = (shelter_id, _cell(a))
            hit = cache.get(key)
            if hit:
                cache.move_to_end(key)
                return _from(a, hit), "cache"
            did = nearest_district_id(a)
            m = MATRIX.get((did, shelter_id))
        if m:
            return _from(a, m), "static_matrix"
    return _pack([list(a), list(b)]), "straight_line"


def plan(a, b, ctx: dict | None = None, shelter_id: str | None = None):
    """Returns (main_route, alternatives, source, fallback_mode). Never raises: when the provider is
    unavailable (outage, HTTP 503, timeout, any error, open breaker) local backup data is used.
    `ctx` is shared by all calls of one request: after one failure the rest skip the provider, so a request
    waits for a failing provider at most once (<= TIMEOUT)."""
    ctx = ctx if ctx is not None else {}
    if not ctx.get("failed") and not breaker.is_open:
        try:
            _simulate()
            routes = provider.route(a, b)
            breaker.success()
            if shelter_id:
                _remember(a, shelter_id, routes[0])
            _changed()
            return routes[0], [{"label": f"Alternativ {i}", **r} for i, r in enumerate(routes[1:], 1)], "provider", None
        except Exception as e:
            log.warning("routing provider failed (%s: %s) - using local backup data", type(e).__name__, e)
            ctx["failed"] = True
            breaker.failure()
            _changed()
    route, mode = _backup(a, b, shelter_id)
    return route, [], "fallback", mode
