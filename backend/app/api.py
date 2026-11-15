import secrets
from typing import Literal, Optional
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlmodel import Session, select

from . import routing, services
from .db import get_session
from .models import District, Road, Shelter, Sos, now
from .util import get_lang, iso, loc, sos_limiter
from .views import road_out, shelter_out, sos_out

router = APIRouter(prefix="/api")


class SosIn(BaseModel):
    citizenId: UUID
    type: Literal["fire", "collapse", "flood", "medical"]
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    note: str = Field("", max_length=200)


class SafeIn(BaseModel):
    citizenId: UUID
    lat: Optional[float] = Field(None, ge=-90, le=90)
    lng: Optional[float] = Field(None, ge=-180, le=180)


@router.get("/health")
def health():
    return {"status": "ok", "routingProvider": "up" if routing.routing_up() else "down"}


@router.get("/districts")
def districts(lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": [{"id": d.id, "name": loc(d, lang), "lat": d.lat, "lng": d.lng} for d in s.exec(select(District)).all()]}


@router.get("/shelters")
def shelters(lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": [shelter_out(x, lang) for x in s.exec(select(Shelter)).all()]}


@router.get("/shelters/nearest")
def nearest(lat: float, lng: float, limit: int = 3, lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": services.nearest_shelters(s, lat, lng, max(1, min(limit, 50)), lang)}


@router.get("/roads")
def roads(lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": [road_out(r, lang) for r in s.exec(select(Road)).all()]}


@router.get("/route")
def route(fromLat: float, fromLng: float, shelterId: Optional[str] = None,
          lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return services.build_route(s, fromLat, fromLng, shelterId, lang)


@router.post("/sos", status_code=201, dependencies=[Depends(sos_limiter)])
def create_sos(body: SosIn, s: Session = Depends(get_session)):
    x = Sos(
        id="sos_" + secrets.token_hex(4), citizen_id=str(body.citizenId), type=body.type, lat=body.lat,
        lng=body.lng, note=body.note, zone_id=services.nearest_district(s, body.lat, body.lng).id,
    )
    s.add(x)
    s.commit()
    return {"id": x.id, "status": x.status, "createdAt": iso(x.created_at)}


@router.post("/safe")
def safe(body: SafeIn, s: Session = Depends(get_session)):
    cid = str(body.citizenId)
    for x in s.exec(select(Sos).where(Sos.citizen_id == cid, Sos.status == "active")).all():
        x.status = "resolved"
        s.add(x)
    s.commit()
    return {"citizenId": cid, "status": "safe", "updatedAt": iso(now())}
