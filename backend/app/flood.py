"""SOS flood defence (Drop 3): cheap in-memory admission control that runs BEFORE the database.

For every well-formed POST /api/sos (called from the ASGI middleware, and from the sim flood endpoint):
  1. per-IP limit                  -> 429 RATE_LIMITED               (util.sos_limiter, 10/min, existing)
  2. duplicate filter              -> 200 {"duplicate": true}        (no row, no events, no budget spent)
        same citizenId + type within 60 s, or same IP + ~50 m grid cell + type within 30 s
  3. per-citizen limit             -> 429 CITIZEN_RATE_LIMITED       (3/min)
  4. global admission budget       -> 429 SOS_FLOOD_THROTTLED        (SOS_GLOBAL_PER_MIN, default 300; the
                                      special_needs profile has a reserved budget and is never throttled here)
  5. quarantine: more than SOS_FLOOD_THRESHOLD (60) accepted SOS in the rolling 60 s = flood mode; new SOS from
     senders not known to be trusted are stored with trust "suspicious" (hidden from the alert engine, the
     dashboard and per-item WS events). The sender still receives the normal 201.
Trusted = special_needs profile (per citizen), a valid dispatcher/admin token (also trusts that IP), or the sim burst.
Everything is bounded in memory (TTL maps / deques) and thread-safe."""
import hashlib
import math
import os
import secrets
import threading
import time
from collections import OrderedDict, deque
from dataclasses import dataclass

from .models import now
from .util import RateLimiter, iso, sos_limiter

WINDOW = 60  # seconds: flood counter / suspicious counter / citizen limit window
EMIT_EVERY = 2.0  # seconds: sos.flood is coalesced to at most one event per this interval

# Config (read at import; module attributes so tests can override)
CITIZEN_LIMIT = int(os.getenv("SOS_CITIZEN_PER_MIN", "3"))
GLOBAL_BUDGET = int(os.getenv("SOS_GLOBAL_PER_MIN", "300"))
FLOOD_THRESHOLD = int(os.getenv("SOS_FLOOD_THRESHOLD", "60"))
DUP_CITIZEN_S = 60
DUP_CELL_S = 30
CELL_M = 50
_SALT = os.getenv("IP_HASH_SALT") or secrets.token_hex(16)  # per process unless pinned: hashes are not reversible


def hash_ip(ip: str) -> str:
    return hashlib.blake2s((_SALT + ip).encode(), digest_size=8).hexdigest()


def cell_of(lat: float, lng: float) -> tuple[int, int]:
    step = CELL_M / 111320
    return int(lat // step), int(lng // (step / max(0.2, math.cos(math.radians(lat)))))


class TtlMap:
    """Insertion-ordered map with a fixed TTL: expired entries are swept from the front, size is capped."""

    def __init__(self, ttl: float, maxsize: int = 200_000):
        self.ttl, self.maxsize, self.d = ttl, maxsize, OrderedDict()

    def get(self, key):
        v = self.d.get(key)
        if v is None:
            return None
        if v[0] <= time.monotonic():
            self.d.pop(key, None)
            return None
        return v[1]

    def set(self, key, value):
        t = time.monotonic()
        self.d.pop(key, None)  # re-insert at the back: order == expiry order because the TTL is fixed
        self.d[key] = (t + self.ttl, value)
        while self.d:
            k = next(iter(self.d))
            if self.d[k][0] > t and len(self.d) <= self.maxsize:
                break
            self.d.pop(k)

    def delete(self, key):
        self.d.pop(key, None)

    def drop_values(self, pred):
        for k in [k for k, (_, v) in self.d.items() if pred(v)]:
            self.d.pop(k, None)


@dataclass
class Admit:
    sos_id: str
    created: object  # datetime (UTC, whole seconds)
    trust: str
    ip_hash: str
    profile: str
    citizen: str
    type: str


@dataclass
class Result:
    kind: str  # "ok" | "duplicate" | "throttled"
    admit: Admit | None = None
    code: str = ""
    message: str = ""
    retry_after: int = 0
    existing: tuple | None = None  # (id, createdAt iso) for duplicates


_lock = threading.RLock()
citizen_limiter = RateLimiter(CITIZEN_LIMIT, WINDOW)
_by_citizen = TtlMap(DUP_CITIZEN_S)
_by_cell = TtlMap(DUP_CELL_S)
_trusted_ips = TtlMap(3600)
_trusted_citizens = TtlMap(3600)
_budget: deque = deque()  # monotonic times of globally admitted (non special_needs) SOS
_accepted: deque = deque()  # monotonic times of every accepted SOS (flood counter)
_suspicious: deque = deque()  # monotonic times of quarantined SOS
IDLE = (False, 0)
_last_payload: tuple = IDLE
_last_emit = 0.0
_timer: threading.Timer | None = None
stats = {"accepted": 0, "duplicates": 0, "throttled": 0, "suspicious": 0}


def _prune(q: deque, t: float):
    while q and t - q[0] > WINDOW:
        q.popleft()


def _active(t: float) -> bool:
    _prune(_accepted, t)
    return len(_accepted) > FLOOD_THRESHOLD


def active() -> bool:
    with _lock:
        return _active(time.monotonic())


def snapshot() -> dict:
    with _lock:
        t = time.monotonic()
        _prune(_suspicious, t)
        return {"active": _active(t), "suspiciousLastMinute": len(_suspicious)}


def reset():
    """Forget everything (sim reset, tests)."""
    global _last_payload, _last_emit, _timer
    with _lock:
        citizen_limiter.limit = CITIZEN_LIMIT
        citizen_limiter.reset()
        for m in (_by_citizen, _by_cell, _trusted_ips, _trusted_citizens):
            m.d.clear()
        for q in (_budget, _accepted, _suspicious):
            q.clear()
        if _timer:
            _timer.cancel()
        _timer, _last_payload, _last_emit = None, IDLE, 0.0
        for k in stats:
            stats[k] = 0


def forget_citizen(citizen_id: str):
    """The citizen pressed "I'm safe": their next SOS must not be answered with the old (resolved) id."""
    with _lock:
        _by_citizen.drop_values(lambda e: e[3] == citizen_id)
        _by_cell.drop_values(lambda e: e[3] == citizen_id)


def forget_ids(ids: set):
    with _lock:
        _by_citizen.drop_values(lambda e: e[0] in ids)
        _by_cell.drop_values(lambda e: e[0] in ids)
        _suspicious.clear()


def discard(a: Admit | None):
    """The request was admitted but the endpoint failed: drop its dedupe entries so a retry is not a "duplicate"."""
    if a:
        with _lock:
            _by_citizen.drop_values(lambda e: e[0] == a.sos_id)
            _by_cell.drop_values(lambda e: e[0] == a.sos_id)


def _throttled(code: str, message: str, wait: int) -> Result:
    stats["throttled"] += 1
    return Result("throttled", code=code, message=message, retry_after=wait)


def admit(ip: str, citizen_id: str, type_: str, lat: float, lng: float, profile: str, *,
          authenticated: bool = False, trusted: bool = False, ip_check: bool = True) -> Result:
    """Decide what happens to one SOS. Never touches the database. `profile` must already be resolved."""
    ip_h = hash_ip(ip)
    special = profile == "special_needs"
    if ip_check:
        wait = sos_limiter.check(ip)
        if wait:
            return _throttled("RATE_LIMITED", "Too many requests", wait)
    with _lock:
        t = time.monotonic()
        cell = cell_of(lat, lng)
        for e in (_by_citizen.get((citizen_id, type_)), _by_cell.get((ip_h, cell, type_))):
            if e and not (special and e[2] != "special_needs"):  # entry = (id, createdAt, profile, citizen)
                stats["duplicates"] += 1
                return Result("duplicate", existing=(e[0], e[1]))
        wait = citizen_limiter.check(citizen_id)
        if wait:
            return _throttled("CITIZEN_RATE_LIMITED", "Too many SOS from this citizen", wait)
        if not special:  # special_needs has a reserved budget: not throttled by the global one
            _prune(_budget, t)
            if len(_budget) >= GLOBAL_BUDGET:
                return _throttled("SOS_FLOOD_THROTTLED", "SOS intake is temporarily throttled",
                                  max(1, int(WINDOW - (t - _budget[0])) + 1))
            _budget.append(t)

        is_trusted = (trusted or authenticated or special
                      or _trusted_ips.get(ip_h) is not None or _trusted_citizens.get(citizen_id) is not None)
        if authenticated:
            _trusted_ips.set(ip_h, 1)
        if special:
            _trusted_citizens.set(citizen_id, 1)
        _accepted.append(t)
        trust = "normal" if (is_trusted or not _active(t)) else "suspicious"
        if trust == "suspicious":
            _suspicious.append(t)
            stats["suspicious"] += 1
        stats["accepted"] += 1

        created = now()
        a = Admit("sos_" + secrets.token_hex(4), created, trust, ip_h, profile, citizen_id, type_)
        entry = (a.sos_id, iso(created), profile, citizen_id)
        _by_citizen.set((citizen_id, type_), entry)
        _by_cell.set((ip_h, cell, type_), entry)
        _notify_locked(t)
        return Result("ok", admit=a)


# ---- coalesced "sos.flood" WebSocket event (at most one per EMIT_EVERY seconds) ----
def _payload(t: float) -> tuple:
    _prune(_suspicious, t)
    return (_active(t), len(_suspicious))


def _emit(payload: tuple):
    from . import realtime  # lazy: realtime imports this module

    data = {"active": payload[0], "suspiciousCount": payload[1], "windowSeconds": WINDOW}
    realtime.to_dispatchers("sos.flood", realtime.by_lang(lambda _l: data))


def _notify_locked(t: float):
    global _last_payload, _last_emit, _timer
    p = _payload(t)
    if (p != _last_payload or p[0]) and t - _last_emit >= EMIT_EVERY:
        _last_emit, _last_payload = t, p
        _emit(p)
    if _timer is None and p != IDLE:  # the trailing tick delivers the latest state and handles the decay
        _timer = threading.Timer(EMIT_EVERY, _tick)
        _timer.daemon = True
        _timer.start()


def _tick():
    """Trailing emit + decay: runs every EMIT_EVERY s while the flood is active or suspicious SOS are in the window."""
    global _last_payload, _last_emit, _timer
    with _lock:
        t = time.monotonic()
        p = _payload(t)
        _timer = None
        if p != _last_payload or p[0]:
            _last_payload, _last_emit = p, t
            _emit(p)
        if p != IDLE:
            _timer = threading.Timer(EMIT_EVERY, _tick)
            _timer.daemon = True
            _timer.start()
