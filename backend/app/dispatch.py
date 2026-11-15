from typing import Literal, Optional

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import delete, func
from sqlmodel import Session, select

from . import alerts, audit, flood, intake, services
from .auth import require
from .db import engine, get_session
from .models import Alert, Crew, District, Shelter, Sos
from .util import get_lang
from .views import alert_out, crew_out, shelter_out, sos_out

router = APIRouter(prefix="/api")  # permissions are per route: view (reads), dispatch (act on alerts / quarantine)
DASHBOARD_SOS_CAP = 200  # the dashboard carries at most this many active SOS (priority first), however many exist
NORMAL_ACTIVE = (Sos.status == "active", Sos.trust == "normal")


PENDING_CAP = 20  # at most this many (newest) pending alerts are returned; stats.totalPending has the real count


def _capped_alerts(s: Session, status: str | None, others_limit: int | None) -> list:
    """Newest PENDING_CAP pending alerts; other statuses (history) are unlimited, or newest `others_limit`."""
    q = select(Alert).order_by(Alert.created_at.desc())
    pending = [] if status not in (None, "pending") else s.exec(q.where(Alert.status == "pending").limit(PENDING_CAP)).all()
    others = [] if status == "pending" else s.exec(
        (q.where(Alert.status == status) if status else q.where(Alert.status != "pending"))
        .limit(others_limit) if others_limit else (q.where(Alert.status == status) if status else q.where(Alert.status != "pending"))).all()
    return sorted(pending + others, key=lambda a: a.created_at, reverse=True)


@router.get("/dashboard", dependencies=[Depends(require("view"))])
async def dashboard(lang: str = Depends(get_lang)):
    def run():
        with Session(engine) as s:
            return _dashboard(s, lang)

    return await run_in_threadpool(run)


def _dashboard(s: Session, lang: str) -> dict:
    intake.flush()  # buffered quarantined rows must be counted (no-op when nothing is waiting)
    sos = s.exec(select(Sos).where(*NORMAL_ACTIVE).order_by(Sos.priority_rank, Sos.created_at.desc())
                 .limit(DASHBOARD_SOS_CAP)).all()
    active_total = s.exec(select(func.count()).select_from(Sos).where(*NORMAL_ACTIVE)).one()
    suspicious_total = s.exec(select(func.count()).select_from(Sos).where(Sos.status == "active",
                                                                          Sos.trust == "suspicious")).one()
    counts = dict(s.exec(select(Sos.zone_id, func.count()).where(*NORMAL_ACTIVE).group_by(Sos.zone_id)).all())
    shelters = s.exec(select(Shelter)).all()
    crews = s.exec(select(Crew)).all()
    total_pending = s.exec(select(func.count()).select_from(Alert).where(Alert.status == "pending")).one()
    alerts = _capped_alerts(s, None, 30)
    return {
        "stats": {
            "activeSos": active_total,
            "pendingAlerts": total_pending,
            "totalPending": total_pending,
            "shelters": len(shelters),
            "fullShelters": sum(x.status == "full" for x in shelters),
            "availableCrews": sum(c.status == "available" for c in crews),
            "totalCrews": len(crews),
            "suspiciousSos": suspicious_total,
            "flood": flood.snapshot(),
        },
        "zones": [services.zone_dict(d, counts.get(d.id, 0), lang) for d in s.exec(select(District)).all()],
        "sos": [sos_out(x) for x in sos],
        "shelters": [shelter_out(x, lang) for x in shelters],
        "crews": [crew_out(c) for c in crews],
        "alerts": [alert_out(a, lang) for a in alerts],
    }


@router.get("/sos", dependencies=[Depends(require("view"))])
def list_sos(status: Optional[Literal["active", "resolved"]] = None, includeSuspicious: bool = False,
             s: Session = Depends(get_session)):
    if includeSuspicious:
        intake.flush()
    q = select(Sos).order_by(Sos.priority_rank, Sos.created_at.desc())
    if status:
        q = q.where(Sos.status == status)
    if not includeSuspicious:
        q = q.where(Sos.trust == "normal")
    return {"items": [sos_out(x) for x in s.exec(q).all()]}


@router.post("/sos/suspicious/clear")
def clear_suspicious(request: Request, user: dict = Depends(require("dispatch")), s: Session = Depends(get_session)):
    """Purge every quarantined SOS (they were never shown to dispatchers)."""
    intake.flush()
    ids = set(s.exec(select(Sos.id).where(Sos.trust == "suspicious")).all())
    if ids:
        s.execute(delete(Sos).where(Sos.trust == "suspicious"))
        s.commit()
    flood.forget_ids(ids)
    audit.record("sos.suspicious.clear", user=user.get("sub"), role=user.get("role"), ip=audit.client_ip(request),
                 removed=len(ids))
    return {"ok": True, "removed": len(ids)}


@router.get("/crews", dependencies=[Depends(require("view"))])
def list_crews(s: Session = Depends(get_session)):
    return {"items": [crew_out(c) for c in s.exec(select(Crew)).all()]}


@router.post("/alerts/{alert_id}/approve")
def approve_alert(alert_id: str, request: Request, user: dict = Depends(require("dispatch")),
                  lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    out = alerts.approve(s, alert_id, lang)
    audit.record("alert.approve", user=user.get("sub"), role=user.get("role"), ip=audit.client_ip(request), alertId=alert_id)
    return out


@router.post("/alerts/{alert_id}/dismiss")
def dismiss_alert(alert_id: str, request: Request, user: dict = Depends(require("dispatch")),
                  lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    out = alerts.dismiss(s, alert_id, lang)
    audit.record("alert.dismiss", user=user.get("sub"), role=user.get("role"), ip=audit.client_ip(request), alertId=alert_id)
    return out


@router.get("/alerts", dependencies=[Depends(require("view"))])
def list_alerts(status: Optional[Literal["pending", "approved", "dismissed"]] = None,
                lang: str = Depends(get_lang), s: Session = Depends(get_session)):
    return {"items": [alert_out(a, lang) for a in _capped_alerts(s, status, None)]}
