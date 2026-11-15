"""Write-behind buffer for quarantined ("suspicious") SOS.

A quarantined SOS is never shown to dispatchers, so it does not need its own INSERT + commit + worker-thread hop
on the request path. The request is answered immediately (normal 201); rows are inserted in batches by a short timer
(one transaction per ~100 rows or per 250 ms). Everything that reads suspicious rows (dashboard stats, GET /api/sos,
clear, "I am safe", reset) calls flush() / clear() first, so readers never see a stale view."""
import logging
import threading

from sqlalchemy import insert
from sqlmodel import Session

from .db import engine
from .models import Sos

log = logging.getLogger("crisis")

BATCH = 100  # flush as soon as this many rows are waiting
INTERVAL = 0.25  # seconds: otherwise flush this long after the first waiting row
MAX_PENDING = 50_000  # hard memory cap; beyond it rows are dropped (they are quarantined spam anyway) and counted

_lock = threading.Lock()
_flush_lock = threading.Lock()  # one batch insert at a time, in arrival order
_rows: list[dict] = []
_timer: threading.Timer | None = None
stats = {"dropped": 0, "flushed": 0}


def add(row: dict):
    global _timer
    with _lock:
        if len(_rows) >= MAX_PENDING:
            stats["dropped"] += 1
            return
        _rows.append(row)
        if len(_rows) >= BATCH or _timer is None:
            if _timer:
                _timer.cancel()
            _timer = threading.Timer(0 if len(_rows) >= BATCH else INTERVAL, _timed_flush)
            _timer.daemon = True
            _timer.start()


def _timed_flush():
    try:
        flush()
    except Exception:
        log.exception("suspicious SOS batch insert failed")


def pending() -> int:
    with _lock:
        return len(_rows)


def flush():
    """Insert everything buffered so far (no-op when empty). Safe to call from any thread."""
    global _timer
    with _flush_lock:
        with _lock:
            rows, _rows[:] = list(_rows), []
            if _timer:
                _timer.cancel()
                _timer = None
        if not rows:
            return
        with Session(engine) as s:
            s.execute(insert(Sos), rows)
            s.commit()
        stats["flushed"] += len(rows)


def clear():
    """Drop buffered rows without inserting them (sim reset wipes the database anyway)."""
    global _timer
    with _lock:
        _rows.clear()
        if _timer:
            _timer.cancel()
            _timer = None
