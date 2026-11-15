import os

from sqlalchemy import inspect
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

URL = os.getenv("DATABASE_URL", "sqlite:///crisis.db")
engine = create_engine(
    URL,
    connect_args={"check_same_thread": False},
    **({"poolclass": StaticPool} if ":memory:" in URL else {}),
)


def init_db():
    from . import models  # noqa: F401  (register tables)
    from .seed import seed

    insp = inspect(engine)  # dev DB created before Drop 1 lacks the new columns: rebuild it (demo data only)
    if insp.has_table("sos") and "priority_rank" not in {c["name"] for c in insp.get_columns("sos")}:
        SQLModel.metadata.drop_all(engine)
    SQLModel.metadata.create_all(engine)
    with Session(engine) as s:
        seed(s, only_if_empty=True)


def get_session():
    with Session(engine) as s:
        yield s
