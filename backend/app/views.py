"""Serializers: DB rows -> contract JSON."""
from .models import Alert, Crew, Road, Shelter, Sos
from .util import iso, loc

ALERT_CODE = "RED_ALERT_SEND_CREW_OPEN_SHELTER"
PRIORITY_CODE = "PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT"
ALERT_MESSAGES = {
    ALERT_CODE: {
        "az": "Qırmızı Həyəcan: Əlavə Xilasetmə Briqadası Göndər və Yeni Toplanış Nöqtəsi Aç",
        "en": "Red Alert: Send Additional Rescue Crew and Open New Assembly Point",
        "ru": "Красная тревога: направить дополнительную бригаду спасателей и открыть новый пункт сбора",
    },
    PRIORITY_CODE: {
        "az": "Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər",
        "en": "Priority SOS: Send a crew with accessible transport",
        "ru": "Приоритетный SOS: направить бригаду с доступным транспортом",
    },
}


OFFLINE_NOTICE = {
    "az": "Oflayn / Ehtiyat marşrut rejimində işləyir",
    "en": "Offline / backup route mode is active",
    "ru": "Работает офлайн / в режиме резервных маршрутов",
}


def crew_out(c: Crew) -> dict:
    return {"id": c.id, "name": c.name, "status": c.status, "lat": c.lat, "lng": c.lng,
            "assignedAlertId": c.assigned_alert_id, "accessibleTransport": c.accessible_transport}


def alert_out(a: Alert, lang: str = "az") -> dict:
    return {
        "id": a.id, "level": "red", "kind": a.kind, "status": a.status, "zoneId": a.zone_id,
        "lat": a.lat, "lng": a.lng, "createdAt": iso(a.created_at), "code": a.code,
        "message": ALERT_MESSAGES[a.code][lang], "details": a.details, "proposal": a.proposal,
    }


def shelter_out(s: Shelter, lang: str = "az") -> dict:
    return {
        "id": s.id, "name": loc(s, lang), "kind": s.kind, "lat": s.lat, "lng": s.lng,
        "capacity": s.capacity, "occupancy": s.occupancy,
        "occupancyPercent": s.percent, "status": s.status, "accessible": s.accessible,
    }


def road_out(r: Road, lang: str = "az") -> dict:
    return {"id": r.id, "name": loc(r, lang), "status": r.status, "accessible": r.accessible, "path": r.path}


def sos_out(x: Sos) -> dict:
    return {
        "id": x.id, "citizenId": x.citizen_id, "type": x.type, "lat": x.lat, "lng": x.lng,
        "note": x.note, "zoneId": x.zone_id, "status": x.status, "createdAt": iso(x.created_at),
        "profile": x.profile, "priority": x.priority, "priorityRank": x.priority_rank, "trust": x.trust,
    }
