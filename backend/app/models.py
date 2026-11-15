from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, Column, Index
from sqlmodel import Field, SQLModel


def now() -> datetime:
    """Timezone-aware UTC timestamp (SQLModel requires tz-aware datetimes)."""
    return datetime.now(timezone.utc).replace(microsecond=0)


class District(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    name_en: str
    name_ru: str
    lat: float
    lng: float


class Shelter(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    name_en: str
    name_ru: str
    kind: str  # shelter | park | stadium
    lat: float
    lng: float
    capacity: int
    occupancy: int
    closed: bool = False
    accessible: bool = True  # ramps / step-free access for special-needs citizens

    @property
    def percent(self) -> float:
        return round(self.occupancy * 100 / self.capacity, 1) if self.capacity else 0.0

    @property
    def status(self) -> str:
        p = self.percent
        if self.closed:
            return "closed"
        return "full" if p >= 100 else "near_full" if p >= 90 else "filling" if p >= 75 else "open"


class Road(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    name_en: str
    name_ru: str
    status: str = "open"  # open | closed
    accessible: bool = True  # passable for wheelchairs / medical transport
    path: list = Field(sa_column=Column(JSON))


class Crew(SQLModel, table=True):
    id: str = Field(primary_key=True)
    name: str
    status: str = "available"  # available | dispatched | busy
    lat: float
    lng: float
    assigned_alert_id: Optional[str] = None
    accessible_transport: bool = False


class Sos(SQLModel, table=True):
    __table_args__ = (Index("ix_sos_status_created_at", "status", "created_at"),)  # dashboard / list queries

    id: str = Field(primary_key=True)
    citizen_id: str = Field(index=True)
    type: str
    lat: float
    lng: float
    note: str = ""
    zone_id: str
    status: str = Field("active", index=True)  # active | resolved
    profile: str = "standard"  # standard | special_needs
    priority: str = "normal"  # critical | normal
    priority_rank: int = 2  # 1 = critical, 2 = normal
    trust: str = Field("normal", index=True)  # normal | suspicious (quarantined during an SOS flood)
    ip_hash: str = ""  # salted hash of the sender IP (the raw IP is never stored)
    created_at: datetime = Field(default_factory=now, index=True)


class Alert(SQLModel, table=True):
    id: str = Field(primary_key=True)
    kind: str  # SOS_CLUSTER | SHELTER_OVERLOAD | PRIORITY_SOS
    status: str = Field("pending", index=True)  # pending | approved | dismissed
    zone_id: str
    lat: float
    lng: float
    code: str
    details: dict = Field(sa_column=Column(JSON))
    proposal: dict = Field(sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=now)
