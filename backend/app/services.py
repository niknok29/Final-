from sqlmodel import Session, select

from . import routing
from .models import District, Road, Shelter, Sos
from .util import ApiError, haversine, loc
from .views import shelter_out

BLOCK_M = 200  # a closed road within this distance of the route blocks it


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


def blocked(path, closed_paths) -> bool:
    a = _dense(path)
    return any(haversine(*p, *q) < BLOCK_M for c in closed_paths for q in _dense(c) for p in a)


def nearest_shelters(s: Session, lat: float, lng: float, limit: int, lang: str):
    allx = s.exec(select(Shelter)).all()
    pool = [x for x in allx if x.status not in ("full", "closed")] or allx
    pool.sort(key=lambda x: haversine(lat, lng, x.lat, x.lng))
    return [{**shelter_out(x, lang), "distanceMeters": round(haversine(lat, lng, x.lat, x.lng))} for x in pool[:limit]]


def build_route(s: Session, lat: float, lng: float, shelter_id: str | None, lang: str = "az") -> dict:
    shelters = s.exec(select(Shelter)).all()
    closed = [r.path for r in s.exec(select(Road).where(Road.status == "closed")).all()]
    req = next((x for x in shelters if x.id == shelter_id), None)
    if shelter_id and not req:
        raise ApiError(404, "SHELTER_NOT_FOUND", "Shelter not found")
    by_dist = sorted(shelters, key=lambda x: haversine(lat, lng, x.lat, x.lng))
    viable = [x for x in by_dist if x.status in ("open", "filling")]

    def go(x):
        r, alts, src = routing.plan((lat, lng), (x.lat, x.lng))
        return x, r, alts, src, blocked(r["path"], closed)

    reason = None
    if req is None:  # no preference: nearest viable shelter
        target = go((viable or by_dist)[0])
    else:
        target = go(req)
        if req.status in ("full", "closed"):
            reason = "SHELTER_FULL"
        elif req.percent >= 90:
            reason = "SHELTER_NEARLY_FULL"
        elif target[4]:
            reason = "ROAD_CLOSED"
    rerouted = False
    if reason:
        for cand in (x for x in viable if x.id != req.id):
            alt = go(cand)
            if not alt[4]:
                target, rerouted = alt, True
                break
    x, r, alts, src, _ = target
    return {
        "shelter": shelter_out(x, lang), "route": r, "alternatives": alts,
        "rerouted": rerouted, "reason": reason if rerouted else None,
        "requestedShelterId": req.id if req else x.id, "source": src,
    }
