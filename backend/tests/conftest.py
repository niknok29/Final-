import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"
os.environ["RATE_LIMIT_SOS"] = "1000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlmodel import Session  # noqa: E402

from app import auth, realtime, util  # noqa: E402
from app.db import engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import seed  # noqa: E402


@pytest.fixture
def client():
    with TestClient(app) as c:
        with Session(engine) as s:
            seed(s)  # wipe + reseed so every test starts from the same state
        realtime.hub.profiles.clear()
        realtime.hub.targets.clear()
        util.sos_limiter.reset()
        auth.login_limiter.reset()
        yield c


@pytest.fixture
def db(client):
    with Session(engine) as s:
        yield s


@pytest.fixture
def headers(client):
    tok = client.post("/api/auth/login", json={"username": "dispatcher", "password": "dispatcher123"}).json()["token"]
    return {"Authorization": f"Bearer {tok}"}
