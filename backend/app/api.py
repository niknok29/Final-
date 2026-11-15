from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator
from sqlmodel import Session, select

from . import alerts, audit, cache, flood, intake, realtime, routing, services
from .db import engine, get_session
from .models import District, Road, Shelter, Sos, now
from .util import get_lang, iso, loc, sanitize_note
from .views import road_out, shelter_out, sos_out

router = APIRouter(prefix="/api")


class SosIn(BaseModel):
    citizenId: UUID
    type: Literal["fire", "collapse", "flood", "medical"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    note: str = Field("", max_length=200)
    profile: Optional[Literal["standard", "special_needs"]] = None  # omitted -> citizen's last known profile, else standard

    @field_validator("note")
    @classmethod
    def _clean_note(cls, v: str) -> str:
        return sanitize_note(v)  # no HTML tags / control chars ever reach the DB or the dispatcher UI


class SafeIn(BaseModel):
    citizenId: UUID
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)


def _in_session(fn):
    """Run fn(session) in ONE worker-thread hop with its own session (a Depends(get_session) costs extra hops)."""
    def run():
        with Session(engine) as s:
            return fn(s)

    return run_in_threadpool(run)


@router.get("/health")
async def health():  # pure in-memory state: answered on the event loop
    up = routing.routing_up()
    st = routing.status()
    return {"status": "ok", "routingProvider": "up" if up else "down",
            "breaker": st["breaker"], "degraded": not up, "state": st["state"]}


async def _cached_list(key: tuple, build):
    """2 s TTL list: a cache hit is served on the event loop without touching the DB or a thread."""
    hit = cache.peek(key)
    if hit is not None:
        return hit
    return await _in_session(lambda s: cache.get_or_set(key, lambda: build(s)))


@router.get("/districts")
async def districts(lang: str = Depends(get_lang)):
    return await _cached_list(("districts", lang), lambda s: {
        "items": [{"id": d.id, "name": loc(d, lang), "lat": d.lat, "lng": d.lng} for d in s.exec(select(District)).all()]})


@router.get("/shelters")
async def shelters(lang: str = Depends(get_lang)):
    return await _cached_list(("shelters", lang),
                              lambda s: {"items": [shelter_out(x, lang) for x in s.exec(select(Shelter)).all()]})


@router.get("/shelters/nearest")
def nearest(lat: float, lng: float, limit: int = 3, lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": services.nearest_shelters(s, lat, lng, max(1, min(limit, 50)), lang)}


@router.get("/roads")
async def roads(lang: str = Depends(get_lang)):
    return await _cached_list(("roads", lang), lambda s: {"items": [road_out(r, lang) for r in s.exec(select(Road)).all()]})


@router.get("/route")
async def route(fromLat: float, fromLng: float, shelterId: Optional[str] = None, citizenId: Optional[UUID] = None,
                profile: Optional[Literal["standard", "special_needs"]] = None, lang: str = Depends(get_lang)):
    cid = str(citizenId) if citizenId else None
    profile = profile or (realtime.hub.profiles.get(cid) if cid else None) or "standard"
    if cid:
        realtime.hub.profiles[cid] = profile
    step = 50 / 111320  # ~50 m origin cell: nearby identical requests share one 2 s cached provider route
    key = ("route", int(fromLat // step), int(fromLng // step), shelterId, profile, lang)
    r = cache.peek(key)
    if r is None:
        r = await _in_session(lambda s: cache.get_or_set(
            key, lambda: services.build_route(s, fromLat, fromLng, shelterId, lang, profile),
            store_if=lambda v: not v.get("offline")))  # outage answers are never cached (the breaker needs the calls)
    if cid:  # remember the citizen's target so `reroute` can be pushed over WS later
        realtime.hub.targets[cid] = (fromLat, fromLng, r["shelter"]["id"], profile)
    return r


def _accept_sos(body: SosIn, admit, ip: str) -> tuple:
    with Session(engine) as s:
        extra = ({"trust": admit.trust, "ip_hash": admit.ip_hash, "sos_id": admit.sos_id, "created_at": admit.created}
                 if admit else {"ip_hash": flood.hash_ip(ip)})
        x = alerts.submit_sos(s, str(body.citizenId), body.type, body.lat, body.lng, body.note, body.profile, **extra)
        return x.id, x.status, iso(x.created_at), x.profile, x.trust


@router.post("/sos", status_code=201)  # per-IP / per-citizen / global limits, dedupe and quarantine: see flood.py
async def create_sos(body: SosIn, request: Request):
    """Minimal accept path: one thread hop, one INSERT, events after the commit. The admission decision (trust, id,
    timestamp) was already made by the ASGI middleware before this code ran."""
    ip = audit.client_ip(request)
    admit = getattr(request.state, "sos_admit", None)
    zone = services.cached_zone_id(body.lat, body.lng) if admit and admit.trust == "suspicious" else None
    if zone:  # quarantined: buffered and inserted in batches (see intake.py), answered right away on the event loop
        intake.add({"id": admit.sos_id, "citizen_id": str(body.citizenId), "type": body.type, "lat": body.lat,
                    "lng": body.lng, "note": body.note, "zone_id": zone, "status": "active", "profile": admit.profile,
                    "priority": "normal", "priority_rank": 2, "trust": "suspicious", "ip_hash": admit.ip_hash,
                    "created_at": admit.created})
        sos_id, status, created, profile, trust = admit.sos_id, "active", iso(admit.created), admit.profile, "suspicious"
    else:
        sos_id, status, created, profile, trust = await run_in_threadpool(_accept_sos, body, admit, ip)
    audit.record("sos.create", user=str(body.citizenId), role="citizen", ip=ip,
                 sosId=sos_id, type=body.type, profile=profile, trust=trust)
    return {"id": sos_id, "status": status, "createdAt": created}


@router.post("/safe")
def safe(body: SafeIn, s: Session = Depends(get_session)):
    intake.flush()  # a quarantined SOS of this citizen may still be buffered
    cid = str(body.citizenId)
    items = s.exec(select(Sos).where(Sos.citizen_id == cid, Sos.status == "active")).all()
    for x in items:
        x.status = "resolved"
        s.add(x)
    s.commit()
    flood.forget_citizen(cid)  # a new SOS after "I am safe" is a new SOS, not a duplicate of the resolved one
    for x in items:
        realtime.sos_updated(s, x)
    return {"citizenId": cid, "status": "safe", "updatedAt": iso(now())}
