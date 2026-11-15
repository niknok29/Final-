"""Crisis algorithm: SOS_CLUSTER / SHELTER_OVERLOAD detection, proposals, approve/dismiss."""
import secrets
from datetime import timedelta, timezone

from sqlmodel import Session, select

from . import realtime, services
from .models import Alert, Crew, Shelter, Sos, now
from .util import ApiError, haversine
from .views import ALERT_CODE, alert_out, crew_out, shelter_out

WINDOW_MIN = 5        # minutes
RADIUS_M = 500        # meters around the newest SOS
MIN_CITIZENS = 4      # distinct citizens needed for a cluster
OVERLOAD_PCT = 95     # shelter occupancy strictly above this raises an alert


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _nearest(items, lat, lng):
    return min(items, key=lambda i: haversine(lat, lng, i.lat, i.lng), default=None)


def propose(s: Session, lat: float, lng: float, skip_alert_id: str | None = None) -> dict:
    """Nearest available crew + nearest closed reserve shelter, preferring ones not already proposed elsewhere."""
    taken = [a.proposal or {} for a in s.exec(select(Alert).where(Alert.status == "pending")).all() if a.id != skip_alert_id]
    used_c, used_s = {p.get("crewId") for p in taken}, {p.get("newShelterId") for p in taken}
    crews = s.exec(select(Crew).where(Crew.status == "available")).all()
    reserves = s.exec(select(Shelter).where(Shelter.closed == True)).all()  # noqa: E712
    crew = _nearest([c for c in crews if c.id not in used_c] or crews, lat, lng)
    shelter = _nearest([x for x in reserves if x.id not in used_s] or reserves, lat, lng)
    return {
        "crewId": crew.id if crew else None, "crewName": crew.name if crew else None,
        "newShelterId": shelter.id if shelter else None, "newShelterName": shelter.name if shelter else None,
    }


def _create(s: Session, kind: str, lat: float, lng: float, details: dict) -> Alert:
    a = Alert(
        id="a" + secrets.token_hex(4), kind=kind, zone_id=services.nearest_district(s, lat, lng).id,
        lat=lat, lng=lng, code=ALERT_CODE, details=details, proposal=propose(s, lat, lng),
    )
    s.add(a)
    s.commit()
    s.refresh(a)
    realtime.alert_created(a)
    return a


def _details(**kw) -> dict:
    return {"sosCount": None, "windowMinutes": WINDOW_MIN, "radiusMeters": RADIUS_M,
            "shelterId": None, "occupancyPercent": None, **kw}


def check_sos(s: Session, x: Sos) -> Alert | None:
    """>= 4 distinct citizens with active SOS within 500 m of `x` during the last 5 minutes."""
    cutoff = now() - timedelta(minutes=WINDOW_MIN)
    near = [
        y for y in s.exec(select(Sos).where(Sos.status == "active")).all()
        if _aware(y.created_at) >= cutoff and haversine(x.lat, x.lng, y.lat, y.lng) <= RADIUS_M
    ]
    citizens = {y.citizen_id for y in near}
    if len(citizens) < MIN_CITIZENS:
        return None
    pending = s.exec(select(Alert).where(Alert.status == "pending", Alert.kind == "SOS_CLUSTER")).all()
    if any(haversine(x.lat, x.lng, a.lat, a.lng) <= RADIUS_M for a in pending):  # same cluster already raised
        return None
    lat, lng = sum(y.lat for y in near) / len(near), sum(y.lng for y in near) / len(near)
    return _create(s, "SOS_CLUSTER", lat, lng, _details(sosCount=len(citizens)))


def check_shelter(s: Session, sh: Shelter) -> Alert | None:
    """Occupancy strictly above 95 %."""
    if sh.percent <= OVERLOAD_PCT:
        return None
    pending = s.exec(select(Alert).where(Alert.status == "pending", Alert.kind == "SHELTER_OVERLOAD")).all()
    if any(a.details.get("shelterId") == sh.id for a in pending):
        return None
    return _create(s, "SHELTER_OVERLOAD", sh.lat, sh.lng, _details(shelterId=sh.id, occupancyPercent=sh.percent))


def submit_sos(s: Session, citizen_id: str, type_: str, lat: float, lng: float, note: str = "") -> Sos:
    x = Sos(id="sos_" + secrets.token_hex(4), citizen_id=citizen_id, type=type_, lat=lat, lng=lng,
            note=note, zone_id=services.nearest_district(s, lat, lng).id)
    s.add(x)
    s.commit()
    realtime.sos_created(s, x)
    check_sos(s, x)
    return x


def _pending(s: Session, alert_id: str) -> Alert:
    a = s.get(Alert, alert_id)
    if not a:
        raise ApiError(404, "ALERT_NOT_FOUND", "Alert not found")
    if a.status != "pending":
        raise ApiError(409, "ALERT_NOT_PENDING", "Alert is already " + a.status)
    return a


def approve(s: Session, alert_id: str, lang: str = "az") -> dict:
    a = _pending(s, alert_id)
    p = a.proposal or {}
    crew = s.get(Crew, p["crewId"]) if p.get("crewId") else None
    shelter = s.get(Shelter, p["newShelterId"]) if p.get("newShelterId") else None
    if not crew or crew.status != "available" or not shelter or not shelter.closed:  # proposal went stale
        fresh = propose(s, a.lat, a.lng, skip_alert_id=a.id)
        if not crew or crew.status != "available":
            crew = s.get(Crew, fresh["crewId"]) if fresh["crewId"] else None
        if not shelter or not shelter.closed:
            shelter = s.get(Shelter, fresh["newShelterId"]) if fresh["newShelterId"] else None
    if not crew:
        raise ApiError(409, "NO_CREW_AVAILABLE", "No available crew to dispatch")
    crew.status, crew.assigned_alert_id = "dispatched", a.id
    if shelter:
        shelter.closed = False
    a.status = "approved"
    a.proposal = {"crewId": crew.id, "crewName": crew.name,
                  "newShelterId": shelter.id if shelter else None, "newShelterName": shelter.name if shelter else None}
    s.add_all([x for x in (crew, shelter, a) if x])
    s.commit()
    realtime.crew_updated(crew)
    if shelter:
        realtime.shelter_changed(shelter)
    realtime.alert_updated(a)
    return {"alert": alert_out(a, lang), "crew": crew_out(crew), "newShelter": shelter_out(shelter, lang) if shelter else None}


def dismiss(s: Session, alert_id: str, lang: str = "az") -> dict:
    a = _pending(s, alert_id)
    a.status = "dismissed"
    s.add(a)
    s.commit()
    realtime.alert_updated(a)
    return {"alert": alert_out(a, lang)}
