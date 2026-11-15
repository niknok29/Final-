"""Append-only audit trail: one JSON object per line (JSON lines). Never writes tokens or passwords."""
import json
import logging
import os
import threading
from pathlib import Path

from .models import now
from .util import iso

DEFAULT_PATH = Path(__file__).resolve().parent.parent / "audit.log"

_log = logging.getLogger("crisis.audit")
_log.setLevel(logging.INFO)
_log.propagate = False  # keep the audit trail out of the console log
_lock = threading.Lock()
_path: Path | None = None


def configure(path: str | os.PathLike | None = None):
    """(Re)point the audit file. Called at import with AUDIT_LOG (or backend/audit.log)."""
    global _path
    with _lock:
        for h in list(_log.handlers):
            _log.removeHandler(h)
            h.close()
        _path = Path(path or os.getenv("AUDIT_LOG") or DEFAULT_PATH)
        h = logging.FileHandler(_path, encoding="utf-8", delay=True)
        h.setFormatter(logging.Formatter("%(message)s"))
        _log.addHandler(h)


def path() -> Path:
    return _path  # type: ignore[return-value]


def _clean(v):
    return v[:200] if isinstance(v, str) else v


def record(event: str, *, user: str | None = None, role: str | None = None, ip: str | None = None, **extra):
    """event: login.success | login.failure | login.locked | sos.create | alert.approve | alert.dismiss | sim.*"""
    row = {"time": iso(now()), "event": event, "user": _clean(user), "role": role, "ip": ip}
    row.update({k: _clean(v) for k, v in extra.items() if v is not None})
    try:
        _log.info(json.dumps(row, ensure_ascii=False))  # json escapes control chars -> no log injection
    except Exception:  # auditing must never break a request
        logging.getLogger("crisis").exception("audit write failed")


def client_ip(request) -> str:
    return request.client.host if request.client else "?"


configure()
