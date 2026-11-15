"""Crisis algorithm: SOS_CLUSTER / SHELTER_OVERLOAD detection, proposals, approve/dismiss."""
import math
import secrets
from datetime import timedelta, timezone

from sqlmodel import Session, select

from . import realtime, services
from .models import Alert, Crew, Shelter, Sos, now
from .util import ApiError, haversine, iso
from .views import ALERT_CODE, PRIORITY_CODE, alert_out, crew_out, shelter_out

WINDOW_MIN = 5        # minutes
RADIUS_M = 500        # meters around the newest SOS
MERGE_RADIUS_M = 1000  # a new SOS_CLUSTER within this distance of a pending one is merged into it
MIN_CITIZENS = 4      # distinct citizens needed for a cluster
OVERLOAD_PCT = 95     # shelter occupancy strictly above this raises an alert


def _aware(dt):
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _nearest(items, lat, lng):
    return min(items, key=lambda i: haversine(lat, lng, i.lat, i.lng), default=None)


def propose(s: Session, lat: float, lng: float, skip_alert_id: str | None = None, priority: bool = False) -> dict:
    """Nearest available crew + nearest closed reserve shelter, preferring ones not already proposed elsewhere.
    `priority`: crew must have accessible transport and no shelter is proposed."""
    taken = [a.proposal or {} for a in s.exec(select(Alert).where(Alert.status == "pending")).all() if a.id != skip_alert_id]
    used_c, used_s = {p.get("crewId") for p in taken}, {p.get("newShelterId") for p in taken}
    crews = s.exec(select(Crew).where(Crew.status == "available")).all()
    if priority:
        crews = [c for c in crews if c.accessible_transport]
    reserves = [] if priority else s.exec(select(Shelter).where(Shelter.closed == True)).all()  # noqa: E712
    crew = _nearest([c for c in crews if c.id not in used_c] or crews, lat, lng)
    shelter = _nearest([x for x in reserves if x.id not in used_s] or reserves, lat, lng)
    return {
        "crewId": crew.id if crew else None, "crewName": crew.name if crew else None,
        "newShelterId": shelter.id if shelter else None, "newShelterName": shelter.name if shelter else None,
    }


def _create(s: Session, kind: str, lat: float, lng: float, details: dict) -> Alert:
    priority = kind == "PRIORITY_SOS"
    a = Alert(
        id="a" + secrets.token_hex(4), kind=kind, zone_id=services.nearest_district(s, lat, lng).id,
        lat=lat, lng=lng, code=PRIORITY_CODE if priority else ALERT_CODE, details=details,
        proposal=propose(s, lat, lng, priority=priority),
    )
    s.add(a)
    s.commit()
    s.refresh(a)
    realtime.alert_created(a)
    return a


def _details(**kw) -> dict:
    return {"sosCount": None, "windowMinutes": WINDOW_MIN, "radiusMeters": RADIUS_M,
            "shelterId": None, "occupancyPercent": None, **kw}  # PRIORITY_SOS adds "sosId"


def check_sos(s: Session, x: Sos) -> Alert | None:
    """>= 4 distinct citizens with active SOS within 500 m of `x` during the last 5 minutes."""
    cutoff = now() - timedelta(minutes=WINDOW_MIN)
    dlat = RADIUS_M / 111320  # bounding box first: the DB narrows to a handful of rows instead of loading every SOS
    dlng = dlat / max(0.2, math.cos(math.radians(x.lat)))
    candidates = s.exec(select(Sos).where(
        Sos.status == "active", Sos.trust == "normal", Sos.created_at >= cutoff,  # quarantined SOS never count
        Sos.lat >= x.lat - dlat, Sos.lat <= x.lat + dlat, Sos.lng >= x.lng - dlng, Sos.lng <= x.lng + dlng)).all()
    near = [y for y in candidates if haversine(x.lat, x.lng, y.lat, y.lng) <= RADIUS_M]
    citizens = {y.citizen_id for y in near}
    if len(citizens) < MIN_CITIZENS:
        return None
    pending = s.exec(select(Alert).where(Alert.status == "pending", Alert.kind == "SOS_CLUSTER")).all()
    merge_into = next((a for a in pending if haversine(x.lat, x.lng, a.lat, a.lng) <= MERGE_RADIUS_M), None)
    if merge_into:  # a pending cluster alert within 1 km already exists: grow it instead of raising another one
        merge_into.details = {**merge_into.details, "sosCount": max(merge_into.details.get("sosCount") or 0, len(citizens)),
                              "updatedAt": iso(now())}
        s.add(merge_into)
        s.commit()
        s.refresh(merge_into)
        realtime.alert_updated(merge_into)
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


def check_priority(s: Session, x: Sos) -> Alert | None:
    """Every special_needs SOS raises its own PRIORITY_SOS alert (one per SOS)."""
    if x.profile != "special_needs":
        return None
    pending = s.exec(select(Alert).where(Alert.status == "pending", Alert.kind == "PRIORITY_SOS")).all()
    if any(a.details.get("sosId") == x.id for a in pending):
        return None
    return _create(s, "PRIORITY_SOS", x.lat, x.lng,
                   _details(sosCount=1, windowMinutes=None, radiusMeters=None, sosId=x.id))


def submit_sos(s: Session, citizen_id: str, type_: str, lat: float, lng: float, note: str = "",
               profile: str | None = None, *, trust: str = "normal", ip_hash: str = "", sos_id: str | None = None,
               created_at=None) -> Sos:
    """Single insert, then events AFTER the commit. A "suspicious" (quarantined) SOS is stored and nothing else:
    no WS event, no alert engine, no zone update."""
    profile = profile or realtime.hub.profiles.get(citizen_id, "standard")
    if trust == "normal":  # a quarantined flood must not grow the in-memory profile map
        realtime.hub.profiles[citizen_id] = profile
    priority, rank = services.PRIORITY[profile]
    x = Sos(id=sos_id or "sos_" + secrets.token_hex(4), citizen_id=citizen_id, type=type_, lat=lat, lng=lng, note=note,
            zone_id=services.nearest_zone_id(s, lat, lng), profile=profile, priority=priority, priority_rank=rank,
            trust=trust, ip_hash=ip_hash, **({"created_at": created_at} if created_at else {}))
    s.expire_on_commit = False  # the committed row is used as-is below: no refresh SELECT per attribute access
    s.add(x)
    s.commit()
    if trust != "normal":
        return x
    realtime.sos_created(s, x)
    check_priority(s, x)
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
    priority = a.kind == "PRIORITY_SOS"  # priority alerts only dispatch an accessible-transport crew, no shelter
    p = a.proposal or {}
    crew = s.get(Crew, p["crewId"]) if p.get("crewId") else None
    shelter = None if priority or not p.get("newShelterId") else s.get(Shelter, p["newShelterId"])
    stale_crew = not crew or crew.status != "available"
    stale_shelter = not priority and (not shelter or not shelter.closed)
    if stale_crew or stale_shelter:  # proposal went stale
        fresh = propose(s, a.lat, a.lng, skip_alert_id=a.id, priority=priority)
        if stale_crew:
            crew = s.get(Crew, fresh["crewId"]) if fresh["crewId"] else None
        if stale_shelter:
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
