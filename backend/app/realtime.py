"""WebSocket hubs + thread-safe emit helpers (callable from sync handlers)."""
import asyncio
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from . import routing, services
from .auth import can, decode
from .db import engine
from .models import District, now
from .util import LANGS, ApiError, iso, norm_lang
from .views import alert_out, crew_out, road_out, shelter_out, sos_out

router = APIRouter()


class Hub:
    def __init__(self):
        self.loop: asyncio.AbstractEventLoop | None = None
        self.citizens: dict[WebSocket, tuple[str, str]] = {}  # ws -> (citizenId, lang)
        self.dispatchers: dict[WebSocket, str] = {}  # ws -> lang
        self.targets: dict[str, tuple[float, float, str, str]] = {}  # citizenId -> (lat, lng, shelterId, profile)
        self.profiles: dict[str, str] = {}  # citizenId -> last known profile (set on route / sos calls)

    def drop(self, ws: WebSocket):
        c = self.citizens.pop(ws, None)
        self.dispatchers.pop(ws, None)
        if c and not any(cid == c[0] for cid, _ in self.citizens.values()):
            self.targets.pop(c[0], None)

    def submit(self, select, type_: str, data: dict):
        """`select` runs on the event loop and returns [(ws, lang)]; `data` maps lang -> payload."""
        if not self.loop or self.loop.is_closed():  # not started yet, or already shut down
            return

        async def run():
            for ws, lang in select():
                try:
                    await ws.send_json({"type": type_, "data": data[lang], "ts": iso(now())})
                except Exception:
                    self.drop(ws)

        asyncio.run_coroutine_threadsafe(run(), self.loop)


hub = Hub()


def by_lang(make) -> dict:
    return {l: make(l) for l in LANGS}


def to_dispatchers(type_: str, data: dict):
    hub.submit(lambda: list(hub.dispatchers.items()), type_, data)


def to_citizens(type_: str, data: dict, citizen_id: str | None = None):
    hub.submit(lambda: [(w, l) for w, (c, l) in hub.citizens.items() if citizen_id in (None, c)], type_, data)


def to_all(type_: str, data: dict):
    to_dispatchers(type_, data)
    to_citizens(type_, data)


# ---- domain events (call after the DB commit, with the session still open) ----
def sos_created(s: Session, x):
    to_dispatchers("sos.created", by_lang(lambda l: sos_out(x)))
    zone_updated(s, x.zone_id)


def sos_updated(s: Session, x):
    to_dispatchers("sos.updated", by_lang(lambda l: sos_out(x)))
    zone_updated(s, x.zone_id)


def zone_updated(s: Session, zone_id: str):
    d = s.get(District, zone_id)
    to_dispatchers("zone.updated", by_lang(lambda l: services.zone_out(s, d, l)))


def crew_updated(c):
    to_dispatchers("crew.updated", by_lang(lambda l: crew_out(c)))


def alert_created(a):
    to_dispatchers("alert.created", by_lang(lambda l: alert_out(a, l)))


def alert_updated(a):
    to_dispatchers("alert.updated", by_lang(lambda l: alert_out(a, l)))


routing.listener = lambda snap: to_dispatchers("provider.updated", by_lang(lambda l: snap))


def shelter_changed(x):
    to_all("shelter.updated", by_lang(lambda l: shelter_out(x, l)))
    reroute_check()


def road_changed(r):
    to_all("road.updated", by_lang(lambda l: road_out(r, l)))
    reroute_check()


def reroute_check():
    """Re-evaluate each tracked citizen's route; push `reroute` when it had to change."""
    with Session(engine) as s:
        for cid, (lat, lng, sid, profile) in list(hub.targets.items()):
            try:  # special_needs keeps the accessible constraint; no accessible route -> nothing to push
                r = services.build_route(s, lat, lng, sid, "az", profile)
            except ApiError:
                continue
            if not r["rerouted"]:
                continue
            hub.targets[cid] = (lat, lng, r["shelter"]["id"], profile)
            to_citizens(
                "reroute",
                by_lang(lambda l: {**services.build_route(s, lat, lng, sid, l, profile), "message": "ROUTE_CHANGED"}),
                cid,
            )


# ---- WebSocket endpoints ----
async def _hold(ws: WebSocket):
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        hub.drop(ws)


@router.websocket("/ws/citizen")
async def ws_citizen(ws: WebSocket, citizenId: str = "", lang: str = "az"):
    try:
        cid = str(UUID(citizenId))
    except ValueError:
        return await ws.close(code=1008)
    await ws.accept()
    hub.citizens[ws] = (cid, norm_lang(lang))
    await _hold(ws)


@router.websocket("/ws/dispatcher")
async def ws_dispatcher(ws: WebSocket, token: str = "", lang: str = "az"):
    claims = decode(token)
    if not claims:
        return await ws.close(code=1008)
    if not can(claims.get("role", ""), "dispatch"):
        return await ws.close(code=1008)
    await ws.accept()
    hub.dispatchers[ws] = norm_lang(lang)
    await _hold(ws)
