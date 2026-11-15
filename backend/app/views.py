"""Serializers: DB rows -> contract JSON."""
from .models import Road, Shelter, Sos
from .util import iso, loc


def shelter_out(s: Shelter, lang: str = "az") -> dict:
    return {
        "id": s.id, "name": loc(s, lang), "kind": s.kind, "lat": s.lat, "lng": s.lng,
        "capacity": s.capacity, "occupancy": s.occupancy,
        "occupancyPercent": s.percent, "status": s.status,
    }


def road_out(r: Road, lang: str = "az") -> dict:
    return {"id": r.id, "name": loc(r, lang), "status": r.status, "path": r.path}


def sos_out(x: Sos) -> dict:
    return {
        "id": x.id, "citizenId": x.citizen_id, "type": x.type, "lat": x.lat, "lng": x.lng,
        "note": x.note, "zoneId": x.zone_id, "status": x.status, "createdAt": iso(x.created_at),
    }
