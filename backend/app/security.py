"""Pure-ASGI hardening middleware (the first code every HTTP request meets after CORS / gzip):
global per-IP rate limit, request body size limit, SOS flood admission (before FastAPI, pydantic and the DB),
security headers and the last-resort 500 handler. No BaseHTTPMiddleware: no per-request task group / stream copy."""
import json
import logging
import os
from uuid import UUID

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import auth, flood
from .util import global_limiter, sos_limiter

log = logging.getLogger("crisis")

MAX_BODY = int(os.getenv("MAX_BODY_BYTES", str(32 * 1024)))
BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
SOS_TYPES = {"fire", "collapse", "flood", "medical"}
PROFILES = {"standard", "special_needs"}

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
]
_SEC_NAMES = {h for h, _ in SECURITY_HEADERS}


def _error(status: int, code: str, message: str, extra: list[tuple[bytes, bytes]] | None = None):
    return _json(status, {"error": {"code": code, "message": message}}, extra)


def _json(status: int, payload: dict, extra: list[tuple[bytes, bytes]] | None = None):
    body = json.dumps(payload).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(extra or [])]
    return status, headers, body


def _num(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and v == v and abs(v) != float("inf")


def parse_sos(raw: bytes) -> dict | None:
    """Cheap pre-validation of a POST /api/sos body. Returns the fields the admission layer needs, or None when
    the body is not clearly valid (then the request goes to the app untouched and pydantic answers 422)."""
    try:
        d = json.loads(raw)
        cid = d["citizenId"]
        if not isinstance(cid, str) or d.get("type") not in SOS_TYPES:
            return None
        lat, lng = d["lat"], d["lng"]
        if not (_num(lat) and _num(lng) and -90 <= lat <= 90 and -180 <= lng <= 180):
            return None
        note, profile = d.get("note", ""), d.get("profile")
        if not isinstance(note, str) or len(note) > 200 or profile not in (None, *PROFILES):
            return None
        return {"cid": str(UUID(cid)), "type": d["type"], "lat": float(lat), "lng": float(lng), "profile": profile}
    except (ValueError, KeyError, TypeError, AttributeError):
        return None


class SecurityMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":  # websockets: auth is handled in the endpoint (close code 1008)
            return await self.app(scope, receive, send)

        path, method = scope["path"], scope["method"]
        no_store = path.startswith("/api/auth/")
        started = False

        async def send_with_headers(message: Message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                if message["status"] >= 400:  # the app refused an admitted SOS (e.g. 422): free its dedupe entries
                    flood.discard(scope.get("state", {}).get("sos_admit"))
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() not in _SEC_NAMES and not (no_store and k.lower() == b"cache-control")]
                headers += SECURITY_HEADERS
                if no_store:
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        async def respond(status, headers, body):
            await send_with_headers({"type": "http.response.start", "status": status, "headers": headers})
            await send_with_headers({"type": "http.response.body", "body": body})

        async def reject(status, code, message, extra=None):
            await respond(*_error(status, code, message, extra))

        def retry(wait: int):
            return [(b"retry-after", str(wait).encode())]

        client = scope.get("client")
        ip = client[0] if client else "?"
        if method != "OPTIONS":  # CORS preflights are not counted
            wait = global_limiter.check(ip)
            if wait:
                return await reject(429, "RATE_LIMITED", "Too many requests", retry(wait))

        is_sos = method == "POST" and path == "/api/sos"
        if is_sos:  # cheapest possible rejection first: no body read, no JSON, no DB
            wait = sos_limiter.check(ip)
            if wait:
                flood.stats["throttled"] += 1
                return await reject(429, "RATE_LIMITED", "Too many requests", retry(wait))

        declared = dict(scope["headers"]).get(b"content-length")
        buffered: list[Message] | None = None
        if declared is not None:
            try:
                size = int(declared)
            except ValueError:
                return await reject(400, "BAD_REQUEST", "Invalid Content-Length")
            if size > MAX_BODY:
                return await reject(413, "PAYLOAD_TOO_LARGE", f"Request body exceeds {MAX_BODY} bytes")
        if is_sos or (declared is None and method in BODY_METHODS):
            # buffer up to the limit (chunked uploads have no declared length), then replay it to the app
            buffered, total = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                buffered.append(message)
                total += len(message.get("body", b""))
                if total > MAX_BODY:
                    return await reject(413, "PAYLOAD_TOO_LARGE", f"Request body exceeds {MAX_BODY} bytes")
                if not message.get("more_body", False):
                    break

        if is_sos and buffered is not None:
            fields = parse_sos(b"".join(m.get("body", b"") for m in buffered))
            if fields:
                bearer = dict(scope["headers"]).get(b"authorization", b"")
                claims = auth.decode(bearer[7:].decode("latin-1")) if bearer[:7].lower() == b"bearer " else None
                profile = fields["profile"] or _known_profile(fields["cid"])
                res = flood.admit(ip, fields["cid"], fields["type"], fields["lat"], fields["lng"], profile,
                                  authenticated=bool(claims and claims["role"] in auth.PERMISSIONS), ip_check=False)
                if res.kind == "throttled":
                    return await reject(429, res.code, res.message, retry(res.retry_after))
                if res.kind == "duplicate":
                    sid, created = res.existing
                    return await respond(*_json(200, {"id": sid, "status": "active", "createdAt": created,
                                                      "duplicate": True}))
                scope.setdefault("state", {})["sos_admit"] = res.admit

        if buffered is not None:
            replay, original = iter(buffered), receive

            async def receive_replay() -> Message:
                return next(replay, None) or await original()

            receive = receive_replay

        try:
            await self.app(scope, receive, send_with_headers)
        except Exception:  # last resort (inside CORS, so the 500 still carries CORS headers); no stack trace to the client
            log.exception("unhandled error on %s %s", method, path)
            flood.discard(scope.get("state", {}).get("sos_admit"))
            if started:
                raise
            await reject(500, "INTERNAL_ERROR", "Internal server error")


def _known_profile(cid: str) -> str:
    from . import realtime  # lazy: realtime imports auth, which this module also imports

    return realtime.hub.profiles.get(cid, "standard")
