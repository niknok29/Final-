"""Mock traffic/routing provider with a circuit breaker and a Haversine straight-line fallback."""
import os
import time

from .util import haversine

SPEED = 30 / 3.6  # m/s, ~30 km/h city speed


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
        if time.monotonic() - self.opened_at >= self.cooldown:  # half-open: allow one trial call
            return False
        return True

    def success(self):
        self.failures, self.opened_at = 0, None

    def failure(self):
        self.failures += 1
        if self.failures >= self.threshold:
            self.opened_at = time.monotonic()


class MockProvider:
    """Pretends to be an external routing API. Set `down = True` to simulate an outage."""

    def __init__(self):
        self.down = os.getenv("MOCK_ROUTING_DOWN") == "1"

    @staticmethod
    def _via(a, b, bend):
        mid = ((a[0] + b[0]) / 2 - (b[1] - a[1]) * bend, (a[1] + b[1]) / 2 + (b[0] - a[0]) * bend)
        return [list(a), [round(mid[0], 6), round(mid[1], 6)], list(b)]

    def route(self, a, b):
        if self.down:
            raise ProviderError("provider unavailable")
        return [_pack(self._via(a, b, bend)) for bend in (0.12, -0.25)]


def _pack(path):
    d = sum(haversine(*p, *q) for p, q in zip(path, path[1:]))
    return {"distanceMeters": round(d), "durationSec": round(d / SPEED), "path": path}


provider = MockProvider()
breaker = CircuitBreaker()


def routing_up() -> bool:
    return not breaker.is_open and not provider.down


def plan(a, b):
    """Returns (main_route, alternatives, source). Falls back to a straight line when the provider is unavailable."""
    if not breaker.is_open:
        try:
            main, alt = provider.route(a, b)
            breaker.success()
            return main, [{"label": "Alternativ 1", **alt}], "provider"
        except ProviderError:
            breaker.failure()
    return _pack([list(a), list(b)]), [], "fallback"
