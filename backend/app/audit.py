"""Append-only audit trail: one JSON object per line (JSON lines). Never writes tokens or passwords.

record() only enqueues a line (non-blocking, never raises); a daemon writer thread appends batches to the file, so
no request ever waits for disk I/O. If the queue is full (disk stalled) lines are dropped and counted, never blocked on.
flush() waits until everything queued so far is on disk (used at exit and by tests)."""
import atexit
import json
import logging
import os
import queue
import threading
from pathlib import Path

from .models import now
from .util import iso

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "audit.log"
log = logging.getLogger("crisis")

_q: queue.Queue = queue.Queue(maxsize=50_000)
_start_lock = threading.Lock()
_thread: threading.Thread | None = None
_path: Path = DEFAULT_PATH
dropped = 0


def configure(path: str | os.PathLike | None = None):
    """(Re)point the audit file. Called at import with AUDIT_LOG (or backend/audit.log)."""
    global _path
    flush()
    _path = Path(path or os.getenv("AUDIT_LOG") or DEFAULT_PATH)


def path() -> Path:
    return _path


def _writer():
    while True:
        batch = [_q.get()]
        try:
            while len(batch) < 1000:
                batch.append(_q.get_nowait())
        except queue.Empty:
            pass
        try:
            with open(_path, "a", encoding="utf-8") as f:
                f.write("\n".join(batch) + "\n")
        except Exception:
            log.exception("audit write failed (%d lines lost)", len(batch))
        finally:
            for _ in batch:
                _q.task_done()


def _ensure_writer():
    global _thread
    if _thread is None or not _thread.is_alive():
        with _start_lock:
            if _thread is None or not _thread.is_alive():
                _thread = threading.Thread(target=_writer, name="audit-writer", daemon=True)
                _thread.start()


def flush(timeout: float = 5.0):
    """Block until every queued line has been written (bounded wait)."""
    if _thread is None:
        return
    done = threading.Event()
    threading.Thread(target=lambda: (_q.join(), done.set()), daemon=True).start()
    done.wait(timeout)


def _clean(v):
    return v[:200] if isinstance(v, str) else v


def record(event: str, *, user: str | None = None, role: str | None = None, ip: str | None = None, **extra):
    """event: login.success | login.failure | login.locked | sos.create | alert.approve | alert.dismiss |
    sos.suspicious.clear | access.denied | sim.call"""
    global dropped
    row = {"time": iso(now()), "event": event, "user": _clean(user), "role": role, "ip": ip}
    row.update({k: _clean(v) for k, v in extra.items() if v is not None})
    try:
        line = json.dumps(row, ensure_ascii=False)  # json escapes control chars -> no log injection
        _ensure_writer()
        _q.put_nowait(line)
    except queue.Full:
        dropped += 1
    except Exception:  # auditing must never break a request
        log.exception("audit enqueue failed")


def client_ip(request) -> str:
    return request.client.host if request.client else "?"


atexit.register(flush)
configure()
