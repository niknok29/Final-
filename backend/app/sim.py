"""Simulation endpoints for the live demo panel."""
import math
import random
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import alerts, audit, flood, intake, realtime, routing, services
from .auth import current_user, require
from .db import get_session
from .models import Alert, Crew, Road, Shelter, Sos
from .seed import seed
from .util import ApiError
from .views import road_out, shelter_out

def _audit_sim(request: Request, user: dict = Depends(current_user)):
    """Runs after the permission check (dependency order): one audit line per authorised sim call."""
    audit.record("sim.call", user=user.get("sub"), role=user.get("role"), ip=audit.client_ip(request),
                 method=request.method, path=request.url.path)


router = APIRouter(prefix="/api/sim", dependencies=[Depends(require("simulate")), Depends(_audit_sim)])
OK = {"ok": True}


class OccIn(BaseModel):
    percent: float = Field(ge=0, le=100)


class BurstIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    count: int = Field(4, ge=1, le=50)
    type: Literal["fire", "collapse", "flood", "medical"] = "fire"


def _set_road(s: Session, road_id: str, status: str):
    r = s.get(Road, road_id)
    if not r:
        raise ApiError(404, "ROAD_NOT_FOUND", "Road not found")
    r.status = status
    s.add(r)
    s.commit()
    realtime.road_changed(r)
    return OK


@router.post("/roads/{road_id}/close")
def close_road(road_id: str, s: Session = Depends(get_session)):
    return _set_road(s, road_id, "closed")


@router.post("/roads/{road_id}/open")
def open_road(road_id: str, s: Session = Depends(get_session)):
    return _set_road(s, road_id, "open")


@router.post("/shelters/{shelter_id}/occupancy")
def set_occupancy(shelter_id: str, body: OccIn, s: Session = Depends(get_session)):
    sh = s.get(Shelter, shelter_id)
    if not sh:
        raise ApiError(404, "SHELTER_NOT_FOUND", "Shelter not found")
    sh.occupancy = round(sh.capacity * body.percent / 100)
    s.add(sh)
    s.commit()
    realtime.shelter_changed(sh)
    alerts.check_shelter(s, sh)
    return OK


class ProviderIn(BaseModel):
    state: Literal["up", "down", "slow", "http503"]


@router.post("/provider")
def set_provider(body: ProviderIn):
    """Force the routing provider into outage ("down"), HTTP 503 ("http503"), >5 s latency ("slow") or normal ("up")."""
    routing.set_state(body.state)
    return {"ok": True, "state": body.state}


@router.post("/sos-burst")
def sos_burst(body: BurstIn, s: Session = Depends(get_session)):
    """N SOS from different fake citizens, all within 200 m of the point (so pairwise < 500 m)."""
    for _ in range(body.count):
        r, ang = 200 * math.sqrt(random.random()), random.uniform(0, 2 * math.pi)
        lat = body.lat + r * math.cos(ang) / 111320
        lng = body.lng + r * math.sin(ang) / (111320 * math.cos(math.radians(body.lat)))
        alerts.submit_sos(s, str(uuid.uuid4()), body.type, lat, lng, "sim")
    return OK


class FloodIn(BaseModel):
    count: int = Field(600, ge=1, le=5000)


@router.post("/flood")
def sim_flood(body: FloodIn, s: Session = Depends(get_session)):
    """Push `count` fake SOS from random citizens through the REAL intake pipeline (per-IP / per-citizen limits,
    global budget, dedupe, quarantine): ~10 % repeat an earlier citizen + type, ~25 % share 5 hot-spot
    coordinates, ~3 % are special_needs. Each fake sender gets one of 120 random IPs."""
    box = (40.33, 40.45, 49.75, 49.95)
    ips = [f"10.{random.randint(0, 255)}.{random.randint(0, 255)}.{random.randint(1, 254)}" for _ in range(120)]
    hot = [(random.uniform(box[0], box[1]), random.uniform(box[2], box[3])) for _ in range(5)]
    types = ("fire", "collapse", "flood", "medical")
    seen: list[tuple] = []
    out = {"ok": True, "accepted": 0, "duplicates": 0, "throttled": 0, "suspicious": 0}
    for _ in range(body.count):
        if seen and random.random() < 0.10:
            ip, cid, type_, lat, lng = random.choice(seen)
        else:
            lat, lng = random.choice(hot) if random.random() < 0.25 else (random.uniform(box[0], box[1]),
                                                                           random.uniform(box[2], box[3]))
            ip, cid, type_ = random.choice(ips), str(uuid.uuid4()), random.choice(types)
            seen.append((ip, cid, type_, lat, lng))
        profile = "special_needs" if random.random() < 0.03 else "standard"
        res = flood.admit(ip, cid, type_, lat, lng, profile)
        if res.kind == "duplicate":
            out["duplicates"] += 1
        elif res.kind == "throttled":
            out["throttled"] += 1
        else:
            a = res.admit
            if a.trust == "suspicious":  # same write-behind path as the HTTP intake
                intake.add({"id": a.sos_id, "citizen_id": cid, "type": type_, "lat": lat, "lng": lng, "note": "flood-sim",
                            "zone_id": services.nearest_zone_id(s, lat, lng), "status": "active", "profile": a.profile,
                            "priority": "normal", "priority_rank": 2, "trust": "suspicious", "ip_hash": a.ip_hash,
                            "created_at": a.created})
            else:
                alerts.submit_sos(s, cid, type_, lat, lng, "flood-sim", profile, trust=a.trust, ip_hash=a.ip_hash,
                                  sos_id=a.sos_id, created_at=a.created)
            out["accepted"] += 1
            out["suspicious"] += a.trust == "suspicious"
    return out


@router.post("/reset")
def reset(s: Session = Depends(get_session)):
    # Tell dispatchers what disappears (the contract has no "reset" event), then wipe and re-seed.
    for x in s.exec(select(Sos).where(Sos.status == "active")).all():
        x.status = "resolved"
        s.add(x)
        s.commit()
        realtime.sos_updated(s, x)
    for a in s.exec(select(Alert).where(Alert.status == "pending")).all():
        a.status = "dismissed"
        s.add(a)
        s.commit()
        realtime.alert_updated(a)
    intake.clear()
    seed(s)
    flood.reset()
    routing.set_state("up")
    for x in s.exec(select(Shelter)).all():
        realtime.to_all("shelter.updated", realtime.by_lang(lambda l: shelter_out(x, l)))
    for r in s.exec(select(Road)).all():
        realtime.to_all("road.updated", realtime.by_lang(lambda l: road_out(r, l)))
    for c in s.exec(select(Crew)).all():
        realtime.crew_updated(c)
    realtime.reroute_check()
    return OK
