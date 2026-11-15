import hmac
import logging
import os
import threading
import time
from collections import defaultdict, deque

import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from . import audit
from .util import ApiError, RateLimiter

log = logging.getLogger("crisis")
DEFAULT_SECRET = "dev-secret-change-me"
SECRET = os.getenv("JWT_SECRET", DEFAULT_SECRET)
TTL = 3600


def secret_warnings() -> list[str]:
    """Problems with the configured JWT secret (empty list = fine). Logged loudly at startup and import."""
    if SECRET == DEFAULT_SECRET:
        return ["JWT_SECRET is not set: using the built-in DEFAULT secret. Anyone can forge dispatcher/admin tokens. "
                "Set a random JWT_SECRET (>= 32 chars) before any non-demo use."]
    if len(SECRET) < 32:
        return ["JWT_SECRET is shorter than 32 characters: use a longer random secret."]
    return []


def warn_secret():
    for w in secret_warnings():
        log.warning("\n%s\n!!! SECURITY WARNING !!! %s\n%s", "!" * 78, w, "!" * 78)


warn_secret()

# Demo accounts: username -> (password, role)
USERS = {"dispatcher": ("dispatcher123", "dispatcher"), "admin": ("admin123", "admin")}

# Single place for role checks: role -> permissions. Add new roles here only.
PERMISSIONS = {
    "dispatcher": {"dispatch", "simulate"},
    "admin": {"dispatch", "simulate", "admin"},
}


def can(role: str, perm: str) -> bool:
    return perm in PERMISSIONS.get(role, ())


def create_token(username: str, role: str) -> str:
    return jwt.encode({"sub": username, "role": role, "exp": int(time.time()) + TTL}, SECRET, algorithm="HS256")


def decode(token: str) -> dict | None:
    try:
        return jwt.decode(token, SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None


_bearer = HTTPBearer(auto_error=False)


def current_user(creds: HTTPAuthorizationCredentials | None = Depends(_bearer)) -> dict:
    claims = decode(creds.credentials) if creds else None
    if not claims:
        raise ApiError(401, "UNAUTHORIZED", "Missing or invalid token")
    return claims


def require(perm: str):
    def dep(user: dict = Depends(current_user)) -> dict:
        if not can(user.get("role", ""), perm):
            raise ApiError(403, "FORBIDDEN", "Insufficient permissions")
        return user

    return dep


router = APIRouter(prefix="/api/auth")
login_limiter = RateLimiter(int(os.getenv("RATE_LIMIT_LOGIN", "10")), 60)

LOCK_AFTER = int(os.getenv("LOGIN_MAX_FAILURES", "5"))
LOCK_SECONDS = int(os.getenv("LOGIN_LOCK_SECONDS", "60"))


class LoginGuard:
    """Brute-force lockout per (IP, username): LOCK_AFTER failures within LOCK_SECONDS lock that pair out
    for LOCK_SECONDS (429 + Retry-After). A success clears the counter. Nothing but timestamps is stored."""

    def __init__(self):
        self.fails: dict[tuple, deque] = defaultdict(deque)
        self.locked_until: dict[tuple, float] = {}
        self._lock = threading.Lock()

    def retry_after(self, key) -> int:
        with self._lock:
            until, t = self.locked_until.get(key), time.monotonic()
            if until is None:
                return 0
            if until <= t:
                self.locked_until.pop(key, None)
                self.fails.pop(key, None)
                return 0
            return max(1, int(until - t) + 1)

    def failure(self, key):
        with self._lock:
            t, q = time.monotonic(), self.fails[key]
            while q and t - q[0] > LOCK_SECONDS:
                q.popleft()
            q.append(t)
            if len(q) >= LOCK_AFTER:
                self.locked_until[key] = t + LOCK_SECONDS
            if len(self.fails) > 10000:  # bound memory: forget pairs whose window has passed
                for k in [k for k, d in self.fails.items() if not d or t - d[-1] > LOCK_SECONDS]:
                    self.fails.pop(k, None)
                    self.locked_until.pop(k, None)

    def success(self, key):
        with self._lock:
            self.fails.pop(key, None)
            self.locked_until.pop(key, None)

    def reset(self):
        with self._lock:
            self.fails.clear()
            self.locked_until.clear()


login_guard = LoginGuard()


class LoginIn(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=256)


@router.post("/login", dependencies=[Depends(login_limiter)])
def login(body: LoginIn, request: Request):
    ip, key = audit.client_ip(request), (audit.client_ip(request), body.username.lower())
    wait = login_guard.retry_after(key)
    if wait:
        audit.record("login.locked", user=body.username, ip=ip)
        raise ApiError(429, "LOGIN_LOCKED", "Too many failed logins, try again later", {"Retry-After": str(wait)})
    pw, role = USERS.get(body.username, (None, None))
    if pw is None or not hmac.compare_digest(pw.encode(), body.password.encode()):
        login_guard.failure(key)
        audit.record("login.failure", user=body.username, ip=ip)
        raise ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password")
    login_guard.success(key)
    audit.record("login.success", user=body.username, role=role, ip=ip)
    return {"token": create_token(body.username, role), "role": role, "username": body.username, "expiresIn": TTL}
