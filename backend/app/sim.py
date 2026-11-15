"""Simulation endpoints for the live demo panel."""
import math
import random
import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import alerts, realtime, routing
from .auth import require
from .db import get_session
from .models import Alert, Crew, Road, Shelter, Sos
from .seed import seed
from .util import ApiError
from .views import road_out, shelter_out

router = APIRouter(prefix="/api/sim", dependencies=[Depends(require("simulate"))])
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


@router.post("/sos-burst")
def sos_burst(body: BurstIn, s: Session = Depends(get_session)):
    """N SOS from different fake citizens, all within 200 m of the point (so pairwise < 500 m)."""
    for _ in range(body.count):
        r, ang = 200 * math.sqrt(random.random()), random.uniform(0, 2 * math.pi)
        lat = body.lat + r * math.cos(ang) / 111320
        lng = body.lng + r * math.sin(ang) / (111320 * math.cos(math.radians(body.lat)))
        alerts.submit_sos(s, str(uuid.uuid4()), body.type, lat, lng, "sim")
    return OK


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
    seed(s)
    routing.breaker.success()
    for x in s.exec(select(Shelter)).all():
        realtime.to_all("shelter.updated", realtime.by_lang(lambda l: shelter_out(x, l)))
    for r in s.exec(select(Road)).all():
        realtime.to_all("road.updated", realtime.by_lang(lambda l: road_out(r, l)))
    for c in s.exec(select(Crew)).all():
        realtime.crew_updated(c)
    realtime.reroute_check()
    return OK
