import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import auth, dispatch, realtime
from .api import router
from .db import init_db
from .util import ApiError


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    realtime.hub.loop = asyncio.get_running_loop()
    yield


app = FastAPI(title="Crisis Evac Engine", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_methods=["*"], allow_headers=["*"], expose_headers=["Retry-After"],
)
for r in (router, auth.router, dispatch.router, realtime.router):
    app.include_router(r)


def _err(status: int, code: str, message: str, headers: dict | None = None):
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


@app.exception_handler(ApiError)
async def _api_error(_: Request, e: ApiError):
    return _err(e.status, e.code, e.message, e.headers)


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, e: StarletteHTTPException):
    codes = {401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}
    return _err(e.status_code, codes.get(e.status_code, "ERROR"), str(e.detail), getattr(e, "headers", None))


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, e: RequestValidationError):
    first = e.errors()[0]
    return _err(422, "VALIDATION_ERROR", f"{'.'.join(map(str, first['loc'][1:]))}: {first['msg']}")
