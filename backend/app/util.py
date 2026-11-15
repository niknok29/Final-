import math
import os
import re
import threading
import time
import unicodedata
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
        self._lock = threading.Lock()

    def check(self, key: str) -> int:
        """Record a hit; returns 0 if allowed, else the seconds until the client may retry."""
        t = time.monotonic()
        with self._lock:
            q = self.hits[key]
            while q and t - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return max(1, int(self.window - (t - q[0])) + 1)
            q.append(t)
            if len(self.hits) > 10000:  # bound memory under a many-IP flood: drop idle clients
                for k in [k for k, d in self.hits.items() if not d or t - d[-1] > self.window]:
                    self.hits.pop(k, None)
        return 0

    def __call__(self, request: Request):
        wait = self.check(request.client.host if request.client else "?")
        if wait:
            raise ApiError(429, "RATE_LIMITED", "Too many requests", {"Retry-After": str(wait)})

    def reset(self):
        with self._lock:
            self.hits.clear()


_TAG = re.compile(r"<[^>]*(?:>|$)")  # a tag, or an unterminated one running to the end of the text
_WS = re.compile(r"[\r\n\t\x0b\x0c]+")


def sanitize_note(text: str) -> str:
    """Free text from citizens: drop HTML tags, control / invisible format chars (incl. bidi overrides),
    leftover angle brackets, and collapse whitespace."""
    text = _WS.sub(" ", text)
    prev = None
    while prev != text:  # nested tricks like "<<b>script>"
        prev, text = text, _TAG.sub("", text)
    text = "".join(ch for ch in text if unicodedata.category(ch) not in ("Cc", "Cf", "Cs")).replace("<", "").replace(">", "")
    return re.sub(r" {2,}", " ", text).strip()


sos_limiter = RateLimiter(int(os.getenv("RATE_LIMIT_SOS", "10")), 60)
global_limiter = RateLimiter(int(os.getenv("RATE_LIMIT_GLOBAL", "300")), 60)
