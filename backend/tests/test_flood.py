import time
import uuid

import jwt
import pytest

from app import audit, auth, flood, intake


def sos(client, cid=None, type_="fire", lat=40.30, lng=49.80, profile=None, headers=None):
    body = {"citizenId": cid or str(uuid.uuid4()), "type": type_, "lat": lat, "lng": lng}
    if profile:
        body["profile"] = profile
    return client.post("/api/sos", json=body, headers=headers or {})


def spread(i):  # a different ~50 m cell per i, so only the rule under test can match
    return {"lat": 40.30 + i * 0.01}


def token(role="dispatcher", **over):
    t = int(time.time())
    claims = {"sub": "u", "role": role, "iat": t - 5, "exp": t + 600, "iss": auth.ISSUER, "aud": auth.AUDIENCE, **over}
    return {k: v for k, v in claims.items() if v is not None}


def bearer(claims, key=auth.SECRET, alg="HS256"):
    return {"Authorization": "Bearer " + jwt.encode(claims, key, algorithm=alg)}


# ---- limits -----------------------------------------------------------------------------------------------------
def test_per_citizen_limit(client, monkeypatch):
    monkeypatch.setattr(flood.citizen_limiter, "limit", 2)
    cid = str(uuid.uuid4())
    codes = [sos(client, cid, t, **spread(i)) for i, t in enumerate(["fire", "flood", "medical"])]
    assert [r.status_code for r in codes] == [201, 201, 429]
    assert codes[2].json()["error"]["code"] == "CITIZEN_RATE_LIMITED" and int(codes[2].headers["retry-after"]) >= 1


def test_global_budget_and_special_needs_reserve(client, monkeypatch):
    monkeypatch.setattr(flood, "GLOBAL_BUDGET", 2)
    rs = [sos(client, **spread(i)) for i in range(3)]
    assert [r.status_code for r in rs] == [201, 201, 429]
    assert rs[2].json()["error"]["code"] == "SOS_FLOOD_THROTTLED" and int(rs[2].headers["retry-after"]) >= 1
    assert sos(client, profile="special_needs", **spread(5)).status_code == 201  # reserved budget


# ---- duplicates -------------------------------------------------------------------------------------------------
def test_duplicate_same_citizen_and_type(client, headers):
    cid = str(uuid.uuid4())
    first = sos(client, cid, "fire", **spread(0)).json()
    dup = sos(client, cid, "fire", **spread(1))  # elsewhere, same citizen + type within 60 s
    assert dup.status_code == 200 and dup.json() == {**first, "duplicate": True}
    assert sos(client, cid, "flood", **spread(2)).status_code == 201  # other type is a new SOS
    assert len(client.get("/api/sos", headers=headers).json()["items"]) == 2  # no extra row for the duplicate


def test_duplicate_same_ip_cell_and_type(client):
    first = sos(client, lat=40.30, lng=49.80).json()
    dup = sos(client, lat=40.30, lng=49.80)  # other citizen, same IP + 50 m cell + type, < 30 s
    assert dup.status_code == 200 and dup.json()["id"] == first["id"] and dup.json()["duplicate"] is True
    assert sos(client, type_="flood", lat=40.30, lng=49.80).status_code == 201


def test_duplicate_emits_no_event(client, headers):
    with client.websocket_connect("/ws/dispatcher?token=" + headers["Authorization"].split()[1]) as ws:
        cid = str(uuid.uuid4())
        sos(client, cid, **spread(0))
        assert ws.receive_json()["type"] == "sos.created"
        ws.receive_json()  # zone.updated
        assert sos(client, cid, **spread(1)).json()["duplicate"] is True
        client.post("/api/sim/provider", json={"state": "up"}, headers=headers)  # marker event
        assert ws.receive_json()["type"] == "provider.updated"  # nothing was emitted for the duplicate


# ---- quarantine -------------------------------------------------------------------------------------------------
def test_quarantine_hidden_everywhere_and_reported(client, headers, monkeypatch):
    monkeypatch.setattr(flood, "FLOOD_THRESHOLD", 2)
    rs = [sos(client, **spread(i)) for i in range(6)]
    assert all(r.status_code == 201 for r in rs)  # the sender never learns about the quarantine
    d = client.get("/api/dashboard", headers=headers).json()
    assert d["stats"]["activeSos"] == 2 and len(d["sos"]) == 2 and d["stats"]["suspiciousSos"] == 4
    assert d["stats"]["flood"] == {"active": True, "suspiciousLastMinute": 4}
    assert len(client.get("/api/sos", headers=headers).json()["items"]) == 2
    items = client.get("/api/sos?includeSuspicious=true", headers=headers).json()["items"]
    assert len(items) == 6 and sum(x["trust"] == "suspicious" for x in items) == 4
    assert client.post("/api/sos/suspicious/clear", headers=headers).json() == {"ok": True, "removed": 4}
    assert len(client.get("/api/sos?includeSuspicious=true", headers=headers).json()["items"]) == 2


def test_quarantine_not_counted_by_alert_engine_but_trusted_burst_is(client, headers, monkeypatch):
    monkeypatch.setattr(flood, "FLOOD_THRESHOLD", 0)  # flood mode from the first SOS on
    for i in range(4):  # 4 different citizens within 500 m: would raise SOS_CLUSTER if they counted
        assert sos(client, lat=40.30 + i * 0.001).status_code == 201
    assert client.get("/api/alerts?status=pending", headers=headers).json()["items"] == []
    assert client.post("/api/sim/sos-burst", json={"lat": 40.4, "lng": 49.8, "count": 4}, headers=headers).status_code == 200
    kinds = [a["kind"] for a in client.get("/api/alerts?status=pending", headers=headers).json()["items"]]
    assert kinds == ["SOS_CLUSTER"]  # sim burst is trusted: the demo still works during a flood


def test_special_needs_and_authenticated_are_trusted(client, headers, monkeypatch):
    monkeypatch.setattr(flood, "FLOOD_THRESHOLD", 0)
    sos(client, **spread(0))  # anonymous -> suspicious (a dispatcher token would also trust this IP afterwards)
    sos(client, profile="special_needs", **spread(1))
    sos(client, headers=headers, **spread(2))  # dispatcher token
    d = client.get("/api/dashboard", headers=headers).json()
    assert d["stats"]["activeSos"] == 2 and d["stats"]["suspiciousSos"] == 1


def test_ip_is_hashed_not_stored(client, headers):
    sos(client)
    row = client.get("/api/sos", headers=headers).json()["items"][0]
    assert "ip_hash" not in row and "testclient" not in str(row)
    from sqlmodel import Session, select
    from app.db import engine
    from app.models import Sos
    with Session(engine) as s:
        h = s.exec(select(Sos.ip_hash)).first()
    assert h and h != "testclient" and len(h) == 16


def test_sim_flood_runs_real_pipeline(client, headers, monkeypatch):
    monkeypatch.setattr(flood, "FLOOD_THRESHOLD", 20)
    monkeypatch.setattr(flood, "GLOBAL_BUDGET", 60)
    r = client.post("/api/sim/flood", json={"count": 120}, headers=headers).json()
    assert r["ok"] and r["accepted"] + r["duplicates"] + r["throttled"] == 120
    assert r["throttled"] > 0 and r["suspicious"] > 0 and r["duplicates"] > 0
    s = client.get("/api/dashboard", headers=headers).json()["stats"]
    assert s["suspiciousSos"] == r["suspicious"] and s["flood"]["active"] is True


# ---- RBAC / JWT -------------------------------------------------------------------------------------------------
def test_401_403_matrix(client, monkeypatch):
    monkeypatch.setitem(auth.PERMISSIONS, "viewer", {"view"})
    monkeypatch.setitem(auth.PERMISSIONS, "dispatcher", {"view", "dispatch"})  # dispatcher without simulate
    calls = [("post", "/api/alerts/a1/approve"), ("post", "/api/alerts/a1/dismiss"),
             ("post", "/api/sos/suspicious/clear"), ("post", "/api/sim/reset")]
    expired = bearer(token(exp=int(time.time()) - 10))
    for method, url in calls:
        assert getattr(client, method)(url).status_code == 401  # no token
        assert getattr(client, method)(url, headers=expired).status_code == 401
        assert getattr(client, method)(url, headers=bearer(token("viewer"))).status_code == 403  # lacks permission
        assert getattr(client, method)(url, headers=bearer(token("ghost"))).status_code == 403  # unknown role
    assert client.post("/api/sim/reset", headers=bearer(token("dispatcher"))).status_code == 403
    assert client.post("/api/sim/reset", headers=bearer(token("admin"))).status_code == 200
    assert client.post("/api/alerts/a1/approve", headers=bearer(token("dispatcher"))).status_code == 404  # allowed -> real handler
    assert client.get("/api/dashboard", headers=bearer(token("viewer"))).status_code == 200


def test_sim_roles_env_default_keeps_dispatcher_simulate():
    assert auth.can("dispatcher", "simulate") and auth.can("admin", "simulate")


@pytest.mark.parametrize("name,headers", [
    ("alg none", lambda: bearer(token(), key=None, alg="none")),
    ("wrong aud", lambda: bearer(token(aud="someone-else"))),
    ("wrong iss", lambda: bearer(token(iss="evil"))),
    ("missing iat", lambda: bearer(token(iat=None))),
    ("wrong secret", lambda: bearer(token(), key="x" * 40)),
])
def test_bad_tokens_rejected(client, name, headers):
    assert client.get("/api/dashboard", headers=headers()).status_code == 401, name


def test_me_and_denied_is_audited(client, monkeypatch):
    me = client.get("/api/auth/me", headers=bearer(token("admin"))).json()
    assert me == {"username": "u", "role": "admin", "permissions": ["dispatch", "simulate", "view"]}
    assert client.get("/api/auth/me").status_code == 401
    monkeypatch.setitem(auth.PERMISSIONS, "viewer", {"view"})
    audit.flush()
    audit.path().write_text("")
    client.post("/api/alerts/a1/approve", headers=bearer(token("viewer")))
    audit.flush()
    row = [__import__("json").loads(x) for x in audit.path().read_text().splitlines()][-1]
    assert row["event"] == "access.denied" and row["role"] == "viewer" and row["user"] == "u" and row["ip"]


# ---- alert merge + cap ------------------------------------------------------------------------------------------
def test_cluster_within_1km_merges_into_pending_alert(client, headers):
    for base in (40.300, 40.306):  # two clusters ~700 m apart: each has 4 distinct citizens within 500 m
        for i in range(4):
            assert sos(client, lat=base + i * 0.001).status_code == 201
    items = client.get("/api/alerts?status=pending", headers=headers).json()["items"]
    clusters = [a for a in items if a["kind"] == "SOS_CLUSTER"]
    assert len(clusters) == 1 and clusters[0]["details"]["updatedAt"]


def test_pending_alerts_capped_at_20_with_total(client, headers, db):
    from app.models import Alert

    for i in range(25):
        db.add(Alert(id=f"x{i}", kind="SHELTER_OVERLOAD", zone_id="khatai", lat=40.3, lng=49.8, code="RED_ALERT_SEND_CREW_OPEN_SHELTER",
                     details={}, proposal={}))
    db.commit()
    d = client.get("/api/dashboard", headers=headers).json()
    assert d["stats"]["totalPending"] == 25 and sum(a["status"] == "pending" for a in d["alerts"]) == 20
    assert len(client.get("/api/alerts?status=pending", headers=headers).json()["items"]) == 20
