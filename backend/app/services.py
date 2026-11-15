from sqlmodel import Session, select

from . import routing
from .models import Crew, District, Road, Shelter, Sos
from .util import ApiError, haversine, loc
from .views import OFFLINE_NOTICE, shelter_out

BLOCK_M = 200  # a blocked road within this distance of the route blocks it
ORIGIN_IGNORE_M = 250  # inaccessible roads right under the citizen's feet do not block (they are already there)
PROFILES = ("standard", "special_needs")
PRIORITY = {"special_needs": ("critical", 1), "standard": ("normal", 2)}


def nearest_district(s: Session, lat: float, lng: float) -> District:
    return min(s.exec(select(District)).all(), key=lambda d: haversine(lat, lng, d.lat, d.lng))


def zone_level(n: int) -> str:
    return "critical" if n >= 3 else "warning" if n >= 1 else "normal"


def zone_dict(d: District, n: int, lang: str = "az") -> dict:
    return {"id": d.id, "name": loc(d, lang), "lat": d.lat, "lng": d.lng, "activeSos": n, "level": zone_level(n)}


def zone_out(s: Session, d: District, lang: str = "az") -> dict:
    n = len(s.exec(select(Sos.id).where(Sos.zone_id == d.id, Sos.status == "active")).all())
    return zone_dict(d, n, lang)


def _dense(path, step=150):
    pts = []
    for p, q in zip(path, path[1:]):
        n = max(1, int(haversine(*p, *q) // step))
        pts += [(p[0] + (q[0] - p[0]) * i / n, p[1] + (q[1] - p[1]) * i / n) for i in range(n)]
    return pts + [tuple(path[-1])]


def blocked(path, blocking_paths, ignore_near=None) -> bool:
    a = _dense(path)
    if ignore_near:
        a = [p for p in a if haversine(*p, *ignore_near) > ORIGIN_IGNORE_M]
    return any(haversine(*p, *q) < BLOCK_M for c in blocking_paths for q in _dense(c) for p in a)


def nearest_shelters(s: Session, lat: float, lng: float, limit: int, lang: str):
    allx = s.exec(select(Shelter)).all()
    pool = [x for x in allx if x.status not in ("full", "closed")] or allx
    pool.sort(key=lambda x: haversine(lat, lng, x.lat, x.lng))
    return [{**shelter_out(x, lang), "distanceMeters": round(haversine(lat, lng, x.lat, x.lng))} for x in pool[:limit]]


def build_route(s: Session, lat: float, lng: float, shelter_id: str | None, lang: str = "az",
                profile: str = "standard") -> dict:
    """Standard citizens: any shelter, closed roads block. special_needs: only accessible shelters and
    roads; raises 409 NO_ACCESSIBLE_ROUTE when nothing is reachable."""
    special = profile == "special_needs"
    shelters = s.exec(select(Shelter)).all()
    roads = s.exec(select(Road)).all()
    closed = [r.path for r in roads if r.status == "closed"]
    inaccessible = [r.path for r in roads if not r.accessible]
    req = next((x for x in shelters if x.id == shelter_id), None)
    if shelter_id and not req:
        raise ApiError(404, "SHELTER_NOT_FOUND", "Shelter not found")
    pool = [x for x in shelters if x.accessible] if special else shelters
    by_dist = sorted(pool, key=lambda x: haversine(lat, lng, x.lat, x.lng))
    viable = [x for x in by_dist if x.status in ("open", "filling")]
    no_route = ApiError(409, "NO_ACCESSIBLE_ROUTE", "No accessible shelter or route is currently reachable")

    ctx: dict = {}  # per-request routing context (stops asking a failing provider again)

    def go(x):
        r, alts, src, mode = routing.plan((lat, lng), (x.lat, x.lng), ctx, x.id)
        by_closed = blocked(r["path"], closed)
        by_access = special and blocked(r["path"], inaccessible, (lat, lng))
        return x, r, alts, src, by_closed, by_access, mode

    reason = None
    rerouted = False
    if req is None:  # no preference: nearest viable shelter
        target = None
        for x in (viable if special else (viable or by_dist)):
            t = go(x)
            if not special or not (t[4] or t[5]):
                target = t
                break
        if target is None:
            raise no_route
    else:
        target = go(req)
        if special and not req.accessible:
            reason = "SHELTER_NOT_ACCESSIBLE"
        elif req.status in ("full", "closed"):
            reason = "SHELTER_FULL"
        elif req.percent >= 90:
            reason = "SHELTER_NEARLY_FULL"
        elif target[4]:
            reason = "ROAD_CLOSED"
        elif target[5]:
            reason = "ROAD_NOT_ACCESSIBLE"
        if reason:
            for cand in (x for x in viable if x.id != req.id):
                alt = go(cand)
                if not (alt[4] or alt[5]):
                    target, rerouted = alt, True
                    break
            # special-needs citizens never keep a shelter/route that is unusable for them
            if not rerouted and special and (not req.accessible or req.status in ("full", "closed") or target[4] or target[5]):
                raise no_route
    x, r, alts, src, _, _, mode = target
    offline = src == "fallback"
    medical = special and s.exec(
        select(Crew.id).where(Crew.status == "available", Crew.accessible_transport == True)  # noqa: E712
    ).first() is not None
    return {
        "shelter": shelter_out(x, lang), "route": r, "alternatives": alts,
        "rerouted": rerouted, "reason": reason if rerouted else None,
        "requestedShelterId": req.id if req else x.id, "source": src,
        "offline": offline, "fallbackMode": mode,
        "notice": {"code": "OFFLINE_BACKUP_ROUTE_MODE", "message": OFFLINE_NOTICE[lang]} if offline else None,
        "accessible": x.accessible and not blocked(r["path"], inaccessible, (lat, lng)),
        "transport": "wheelchair_medical" if special else "walk",
        "accessibilityNotes": (["RAMP", "STEP_FREE"] + (["MEDICAL_TRANSPORT_AVAILABLE"] if medical else [])) if special else [],
    }
