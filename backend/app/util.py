import math
import os
import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import Query, Request


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers or {}


def haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in meters."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 6371000 * 2 * math.asin(math.sqrt(a))


def iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


LANGS = ("az", "en", "ru")


def norm_lang(lang: str) -> str:
    return lang if lang in LANGS else "az"


def get_lang(lang: str = Query("az")) -> str:
    return norm_lang(lang)


def loc(obj, lang: str) -> str:
    return getattr(obj, f"name_{lang}", None) or obj.name if lang != "az" else obj.name


class RateLimiter:
    """In-memory sliding window per client IP."""

    def __init__(self, limit: int, window: int):
        self.limit, self.window, self.hits = limit, window, defaultdict(deque)

    def __call__(self, request: Request):
        key = request.client.host if request.client else "?"
        q, t = self.hits[key], time.monotonic()
        while q and t - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            wait = max(1, int(self.window - (t - q[0])) + 1)
            raise ApiError(429, "RATE_LIMITED", "Too many requests", {"Retry-After": str(wait)})
        q.append(t)

    def reset(self):
        self.hits.clear()


sos_limiter = RateLimiter(int(os.getenv("RATE_LIMIT_SOS", "10")), 60)
