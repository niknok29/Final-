"""Pure-ASGI hardening middleware: global per-IP rate limit, request body size limit, security headers."""
import json
import os

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .util import global_limiter

MAX_BODY = int(os.getenv("MAX_BODY_BYTES", str(32 * 1024)))
BODY_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"),
    (b"x-frame-options", b"DENY"),
    (b"referrer-policy", b"no-referrer"),
]


def _error(status: int, code: str, message: str, extra: list[tuple[bytes, bytes]] | None = None):
    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    headers = [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode()), *(extra or [])]
    return status, headers, body


class SecurityMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":  # websockets: auth is handled in the endpoint (close code 1008)
            return await self.app(scope, receive, send)

        path = scope["path"]
        no_store = path.startswith("/api/auth/")

        async def send_with_headers(message: Message):
            if message["type"] == "http.response.start":
                headers = [(k, v) for k, v in message.get("headers", [])
                           if k.lower() not in {h for h, _ in SECURITY_HEADERS} and not (no_store and k.lower() == b"cache-control")]
                headers += SECURITY_HEADERS
                if no_store:
                    headers.append((b"cache-control", b"no-store"))
                message = {**message, "headers": headers}
            await send(message)

        async def reject(status, code, message, extra=None):
            st, headers, body = _error(status, code, message, extra)
            await send_with_headers({"type": "http.response.start", "status": st, "headers": headers})
            await send_with_headers({"type": "http.response.body", "body": body})

        method = scope["method"]
        if method != "OPTIONS":  # CORS preflights are not counted
            client = scope.get("client")
            wait = global_limiter.check(client[0] if client else "?")
            if wait:
                return await reject(429, "RATE_LIMITED", "Too many requests", [(b"retry-after", str(wait).encode())])

        declared = dict(scope["headers"]).get(b"content-length")
        if declared is not None:
            try:
                size = int(declared)
            except ValueError:
                return await reject(400, "BAD_REQUEST", "Invalid Content-Length")
            if size > MAX_BODY:
                return await reject(413, "PAYLOAD_TOO_LARGE", f"Request body exceeds {MAX_BODY} bytes")
        elif method in BODY_METHODS:
            # chunked upload without a declared length: buffer up to the limit, then replay it to the app
            chunks, total = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunks.append(message)
                total += len(message.get("body", b""))
                if total > MAX_BODY:
                    return await reject(413, "PAYLOAD_TOO_LARGE", f"Request body exceeds {MAX_BODY} bytes")
                if not message.get("more_body", False):
                    break
            replay, original = iter(chunks), receive

            async def receive_replay() -> Message:
                return next(replay, None) or await original()

            receive = receive_replay

        await self.app(scope, receive, send_with_headers)
