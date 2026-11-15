"""WebSocket hubs + thread-safe emit helpers (callable from sync handlers)."""
import asyncio
import logging
import threading
import time
from uuid import UUID

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlmodel import Session

from . import flood, routing, services
from .auth import can, decode
from .db import engine
from .models import District, now
from .util import LANGS, ApiError, iso, norm_lang
from .views import alert_out, crew_out, road_out, shelter_out, sos_out

router = APIRouter()
log = logging.getLogger("crisis.ws")


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
            try:
                for ws, lang in select():
                    try:
                        await ws.send_json({"type": type_, "data": data[lang], "ts": iso(now())})
                    except Exception:  # a broken client must never affect the others or the caller
                        log.warning("dropping websocket after failed send of %s", type_, exc_info=True)
                        self.drop(ws)
            except Exception:
                log.exception("websocket broadcast %s failed", type_)

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
    if x.trust != "normal" or not hub.dispatchers:  # quarantined SOS are invisible; nobody listening = no work
        return
    to_dispatchers("sos.created", by_lang(lambda l: sos_out(x)))
    zone_updated(s, x.zone_id)


def sos_updated(s: Session, x):
    if x.trust != "normal" or not hub.dispatchers:
        return
    to_dispatchers("sos.updated", by_lang(lambda l: sos_out(x)))
    zone_updated(s, x.zone_id)


ZONE_EVERY = 1.0  # seconds: under flood zone.updated is coalesced to at most one per zone per interval
_zone_lock = threading.Lock()
_zone_last: dict[str, float] = {}
_zone_pending: set[str] = set()
_zone_timer: threading.Timer | None = None


def _send_zone(s: Session, zone_id: str):
    d = s.get(District, zone_id)
    if d:
        to_dispatchers("zone.updated", by_lang(lambda l: services.zone_out(s, d, l)))


def _flush_zones():
    global _zone_timer
    with _zone_lock:
        zones = list(_zone_pending)
        _zone_pending.clear()
        _zone_timer = None
        t = time.monotonic()
        for z in zones:
            _zone_last[z] = t
    if zones and hub.dispatchers:
        with Session(engine) as s:
            for z in zones:
                try:
                    _send_zone(s, z)
                except Exception:
                    log.exception("coalesced zone update failed for %s", z)


def zone_updated(s: Session, zone_id: str):
    global _zone_timer
    if not hub.dispatchers:
        return
    if not flood.active():
        return _send_zone(s, zone_id)
    with _zone_lock:
        t = time.monotonic()
        if t - _zone_last.get(zone_id, 0.0) >= ZONE_EVERY:
            _zone_last[zone_id] = t
            send = True
        else:
            send = False
            _zone_pending.add(zone_id)  # the trailing flush sends the latest state of this zone
            if _zone_timer is None:
                _zone_timer = threading.Timer(ZONE_EVERY, _flush_zones)
                _zone_timer.daemon = True
                _zone_timer.start()
    if send:
        _send_zone(s, zone_id)


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
                if not r["rerouted"]:
                    continue
                payload = by_lang(lambda l: {**services.build_route(s, lat, lng, sid, l, profile),
                                             "message": "ROUTE_CHANGED"})
            except ApiError:
                continue
            except Exception:  # one citizen's failure must not break the caller (a sim / admin request)
                log.exception("reroute check failed for citizen %s", cid)
                continue
            hub.targets[cid] = (lat, lng, r["shelter"]["id"], profile)
            to_citizens("reroute", payload, cid)


# ---- WebSocket endpoints ----
async def _hold(ws: WebSocket):
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:  # never let a handler error bubble up as an unhandled ASGI exception
        log.exception("websocket handler error")
    finally:
        hub.drop(ws)


async def _reject(ws: WebSocket):
    """Accept, then close with 1008 (policy violation). Closing before accept would be an HTTP 403 on the
    handshake, which browsers report as code 1006 - clients could not tell "bad token" from "network down"."""
    await ws.accept()
    await ws.close(code=1008)


@router.websocket("/ws/citizen")
async def ws_citizen(ws: WebSocket, citizenId: str = "", lang: str = "az"):
    try:
        cid = str(UUID(citizenId))
    except ValueError:
        return await _reject(ws)
    await ws.accept()
    hub.citizens[ws] = (cid, norm_lang(lang))
    await _hold(ws)


@router.websocket("/ws/dispatcher")
async def ws_dispatcher(ws: WebSocket, token: str = "", lang: str = "az"):
    claims = decode(token)
    if not claims or not can(claims["role"], "view"):
        return await _reject(ws)
    await ws.accept()
    hub.dispatchers[ws] = norm_lang(lang)
    await _hold(ws)
