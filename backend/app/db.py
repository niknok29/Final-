import os

from sqlalchemy import event, inspect, text
from sqlmodel import Session, SQLModel, create_engine
from sqlalchemy.pool import StaticPool

URL = os.getenv("DATABASE_URL", "sqlite:///crisis.db")
_MEMORY = ":memory:" in URL
engine = create_engine(
    URL,
    connect_args={"check_same_thread": False} if _MEMORY else {"check_same_thread": False, "timeout": 30},
    # file DB: enough pooled connections for the 40-thread worker pool (default 5+10 made requests queue on the pool)
    **({"poolclass": StaticPool} if _MEMORY else {"pool_size": 30, "max_overflow": 30}),
)

if not _MEMORY:
    @event.listens_for(engine, "connect")
    def _sqlite_pragmas(dbapi_conn, _):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA journal_mode=WAL")  # readers never block the writer and vice versa
        cur.execute("PRAGMA synchronous=NORMAL")  # no fsync per commit (WAL stays consistent)
        cur.execute("PRAGMA busy_timeout=30000")  # wait for the write lock instead of "database is locked"
        cur.close()


def init_db():
    from . import models, routing  # noqa: F401  (register tables)
    from .seed import seed

    insp = inspect(engine)  # dev DB created before Drop 1 lacks the new columns: rebuild it (demo data only)
    if insp.has_table("sos") and "priority_rank" not in {c["name"] for c in insp.get_columns("sos")}:
        SQLModel.metadata.drop_all(engine)
    if insp.has_table("sos"):  # additive migration: keep existing rows, add the Drop 3 columns
        cols = {c["name"] for c in insp.get_columns("sos")}
        with engine.begin() as conn:
            if "trust" not in cols:
                conn.execute(text("ALTER TABLE sos ADD COLUMN trust VARCHAR NOT NULL DEFAULT 'normal'"))
            if "ip_hash" not in cols:
                conn.execute(text("ALTER TABLE sos ADD COLUMN ip_hash VARCHAR NOT NULL DEFAULT ''"))
    SQLModel.metadata.create_all(engine)
    for table in SQLModel.metadata.tables.values():  # create_all skips indexes of tables that already exist
        for idx in table.indexes:
            idx.create(engine, checkfirst=True)
    with Session(engine) as s:
        seed(s, only_if_empty=True)
        routing.build_matrix(s)  # also when the DB already had data (seed() returned early)


def get_session():
    with Session(engine) as s:
        yield s
