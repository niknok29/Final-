"""2 s in-memory TTL cache for the public read-only lists (shelters, roads, districts).

Invalidated on ANY change to those tables: a SQLAlchemy session hook notices flushed Shelter/Road/District rows
and clears the cache once the transaction commits, so every write path (sim, approve, seed, ...) is covered
without each caller having to remember to do it."""
import os
import threading
import time

from sqlalchemy import event
from sqlmodel import Session

from .models import District, Road, Shelter

TTL = float(os.getenv("CACHE_TTL", "2"))
WATCHED = (Shelter, Road, District)

_lock = threading.Lock()
_store: dict[tuple, tuple[float, object]] = {}
stats = {"hits": 0, "misses": 0}


def peek(key: tuple):
    """Cached value or None; cheap enough to call on the event loop (no DB, no thread hop)."""
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            stats["hits"] += 1
            return hit[1]
    return None


def get_or_set(key: tuple, producer, store_if=lambda _v: True):
    now = time.monotonic()
    with _lock:
        hit = _store.get(key)
        if hit and hit[0] > now:
            stats["hits"] += 1
            return hit[1]
    value = producer()  # computed outside the lock: slow DB work must not serialize other requests
    if not store_if(value):
        return value
    with _lock:
        _store[key] = (time.monotonic() + TTL, value)
        stats["misses"] += 1
        if len(_store) > 256:  # keys are (name, lang): tiny in practice; drop expired entries just in case
            for k in [k for k, (exp, _) in _store.items() if exp <= now]:
                _store.pop(k, None)
    return value


def invalidate():
    with _lock:
        _store.clear()


@event.listens_for(Session, "after_flush")
def _mark(session, _ctx):
    if any(isinstance(o, WATCHED) for coll in (session.new, session.dirty, session.deleted) for o in coll):
        session.info["cache_dirty"] = True


@event.listens_for(Session, "after_commit")
def _on_commit(session):
    if session.info.pop("cache_dirty", False):
        invalidate()


@event.listens_for(Session, "after_rollback")
def _on_rollback(session):
    session.info.pop("cache_dirty", None)
