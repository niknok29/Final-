"""Serializers: DB rows -> contract JSON."""
from .models import Alert, Crew, Road, Shelter, Sos
from .util import iso, loc

ALERT_CODE = "RED_ALERT_SEND_CREW_OPEN_SHELTER"
ALERT_MESSAGES = {
    "az": "Qırmızı Həyəcan: Əlavə Xilasetmə Briqadası Göndər və Yeni Toplanış Nöqtəsi Aç",
    "en": "Red Alert: Send Additional Rescue Crew and Open New Assembly Point",
    "ru": "Красная тревога: направить дополнительную бригаду спасателей и открыть новый пункт сбора",
}


def crew_out(c: Crew) -> dict:
    return {"id": c.id, "name": c.name, "status": c.status, "lat": c.lat, "lng": c.lng, "assignedAlertId": c.assigned_alert_id}


def alert_out(a: Alert, lang: str = "az") -> dict:
    return {
        "id": a.id, "level": "red", "kind": a.kind, "status": a.status, "zoneId": a.zone_id,
        "lat": a.lat, "lng": a.lng, "createdAt": iso(a.created_at), "code": a.code,
        "message": ALERT_MESSAGES[lang], "details": a.details, "proposal": a.proposal,
    }


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
