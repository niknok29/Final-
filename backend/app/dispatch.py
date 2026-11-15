from typing import Literal, Optional

from fastapi import APIRouter, Depends
from sqlmodel import Session, select

from . import alerts, services
from .auth import require
from .db import get_session
from .models import Alert, Crew, District, Shelter, Sos
from .util import get_lang
from .views import alert_out, crew_out, shelter_out, sos_out

router = APIRouter(prefix="/api", dependencies=[Depends(require("dispatch"))])


@router.get("/dashboard")
def dashboard(lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    sos = s.exec(select(Sos).where(Sos.status == "active").order_by(Sos.priority_rank, Sos.created_at.desc())).all()
    shelters = s.exec(select(Shelter)).all()
    crews = s.exec(select(Crew)).all()
    alerts = s.exec(select(Alert).order_by(Alert.created_at.desc()).limit(50)).all()
    counts: dict[str, int] = {}
    for x in sos:
        counts[x.zone_id] = counts.get(x.zone_id, 0) + 1
    return {
        "stats": {
            "activeSos": len(sos),
            "pendingAlerts": sum(a.status == "pending" for a in alerts),
            "shelters": len(shelters),
            "fullShelters": sum(x.status == "full" for x in shelters),
            "availableCrews": sum(c.status == "available" for c in crews),
            "totalCrews": len(crews),
        },
        "zones": [services.zone_dict(d, counts.get(d.id, 0), lang) for d in s.exec(select(District)).all()],
        "sos": [sos_out(x) for x in sos],
        "shelters": [shelter_out(x, lang) for x in shelters],
        "crews": [crew_out(c) for c in crews],
        "alerts": [alert_out(a, lang) for a in alerts],
    }


@router.get("/sos")
def list_sos(status: Optional[Literal["active", "resolved"]] = None, s: Session = Depends(get_session)):
    q = select(Sos).order_by(Sos.priority_rank, Sos.created_at.desc())
    return {"items": [sos_out(x) for x in s.exec(q.where(Sos.status == status) if status else q).all()]}


@router.get("/crews")
def list_crews(s: Session = Depends(get_session)):
    return {"items": [crew_out(c) for c in s.exec(select(Crew)).all()]}


@router.post("/alerts/{alert_id}/approve")
def approve_alert(alert_id: str, lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return alerts.approve(s, alert_id, lang)


@router.post("/alerts/{alert_id}/dismiss")
def dismiss_alert(alert_id: str, lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return alerts.dismiss(s, alert_id, lang)


@router.get("/alerts")
def list_alerts(status: Optional[Literal["pending", "approved", "dismissed"]] = None,
                lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    q = select(Alert).order_by(Alert.created_at.desc())
    return {"items": [alert_out(a, lang) for a in s.exec(q.where(Alert.status == status) if status else q).all()]}
