import hmac
import os
import time

import jwt
from fastapi import APIRouter, Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from .util import ApiError, RateLimiter

SECRET = os.getenv("JWT_SECRET", "dev-secret-change-me")
TTL = 3600

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


class LoginIn(BaseModel):
    username: str
    password: str


@router.post("/login", dependencies=[Depends(login_limiter)])
def login(body: LoginIn):
    pw, role = USERS.get(body.username, (None, None))
    if pw is None or not hmac.compare_digest(pw.encode(), body.password.encode()):
        raise ApiError(401, "INVALID_CREDENTIALS", "Invalid username or password")
    return {"token": create_token(body.username, role), "role": role, "username": body.username, "expiresIn": TTL}
