import json

from sqlalchemy import inspect
from sqlmodel import Session

from app import audit, auth, cache, security, util
from app.db import engine
from app.models import Shelter

CID = "11111111-1111-4111-8111-111111111111"
SOS = {"citizenId": CID, "type": "fire", "lat": 40.4, "lng": 49.8, "note": "help"}


def _login(client, user="dispatcher", pw="wrong"):
    return client.post("/api/auth/login", json={"username": user, "password": pw})


# ---- headers ----------------------------------------------------------------------------------------------------
def test_security_headers_everywhere(client):
    for r in (client.get("/api/health"), client.get("/api/nope"), _login(client)):
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"


def test_auth_routes_are_no_store_others_are_not(client):
    assert _login(client, pw="dispatcher123").headers["cache-control"] == "no-store"
    assert _login(client).headers["cache-control"] == "no-store"  # also on errors
    assert client.get("/api/health").headers.get("cache-control") != "no-store"


def test_gzip_for_large_responses(client):
    r = client.get("/api/shelters", headers={"Accept-Encoding": "gzip"})
    assert r.headers.get("content-encoding") == "gzip" and r.json()["items"]


# ---- body size limit --------------------------------------------------------------------------------------------
def test_body_over_32kb_is_413(client):
    r = client.post("/api/sos", content=b"x" * (32 * 1024 + 1), headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_body_at_limit_is_not_rejected_by_the_limit(client):
    r = client.post("/api/sos", content=b"{}" + b" " * (32 * 1024 - 2), headers={"Content-Type": "application/json"})
    assert r.status_code == 422  # reached the app (validation error), not 413


def test_chunked_body_over_limit_is_413(client):
    def chunks():
        for _ in range(40):
            yield b"x" * 1024

    r = client.post("/api/sos", content=chunks(), headers={"Content-Type": "application/json"})
    assert r.status_code == 413


# ---- login lockout ----------------------------------------------------------------------------------------------
def test_lockout_after_5_failures_then_429_with_retry_after(client):
    for _ in range(5):
        assert _login(client).status_code == 401
    r = _login(client)
    assert r.status_code == 429 and r.json()["error"]["code"] == "LOGIN_LOCKED"
    assert 1 <= int(r.headers["retry-after"]) <= 61
    assert _login(client, pw="dispatcher123").status_code == 429  # even the right password is refused while locked


def test_lockout_is_per_username_and_expires(client):
    for _ in range(5):
        _login(client)
    assert _login(client, user="admin", pw="admin123").status_code == 200  # other username unaffected
    key = next(iter(auth.login_guard.locked_until))
    auth.login_guard.locked_until[key] -= 100  # time travel: the lock has expired
    assert _login(client, pw="dispatcher123").status_code == 200


def test_success_resets_failure_counter(client):
    for _ in range(4):
        _login(client)
    assert _login(client, pw="dispatcher123").status_code == 200
    for _ in range(4):
        assert _login(client).status_code == 401  # counter restarted: still not locked


# ---- global rate limit ------------------------------------------------------------------------------------------
def test_global_rate_limit_429(client, monkeypatch):
    monkeypatch.setattr(util.global_limiter, "limit", 5)
    util.global_limiter.reset()
    codes = [client.get("/api/health").status_code for _ in range(7)]
    assert codes[:5] == [200] * 5 and codes[5:] == [429, 429]
    r = client.get("/api/health")
    assert int(r.headers["retry-after"]) >= 1 and r.json()["error"]["code"] == "RATE_LIMITED"


def test_sos_limit_still_applies(client, monkeypatch):
    monkeypatch.setattr(util.sos_limiter, "limit", 2)
    util.sos_limiter.reset()
    assert [client.post("/api/sos", json=SOS).status_code for _ in range(3)] == [201, 201, 429]


def test_login_limit_still_applies(client, monkeypatch):
    monkeypatch.setattr(auth.login_limiter, "limit", 3)
    auth.login_limiter.reset()
    codes = [_login(client, pw="dispatcher123").status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


# ---- cache ------------------------------------------------------------------------------------------------------
def test_cache_hits_then_invalidates_on_sim_change(client, headers):
    a = client.get("/api/shelters").json()["items"]
    hits = cache.stats["hits"]
    assert client.get("/api/shelters").json()["items"] == a
    assert cache.stats["hits"] == hits + 1  # second call served from the cache
    sid = a[0]["id"]
    assert client.post(f"/api/sim/shelters/{sid}/occupancy", json={"percent": 99}, headers=headers).status_code == 200
    b = {x["id"]: x for x in client.get("/api/shelters").json()["items"]}
    assert b[sid] != next(x for x in a if x["id"] == sid)  # fresh data, not the stale cached list


def test_cache_invalidated_by_road_change(client, headers):
    roads = client.get("/api/roads").json()["items"]
    rid, was = roads[0]["id"], roads[0]["status"]
    action = "open" if was == "closed" else "close"
    assert client.post(f"/api/sim/roads/{rid}/{action}", headers=headers).status_code == 200
    now = next(x for x in client.get("/api/roads").json()["items"] if x["id"] == rid)["status"]
    assert now != was


def test_cache_invalidated_by_any_db_writer(client):
    first = client.get("/api/shelters").json()["items"][0]
    with Session(engine) as s:  # not through the API at all
        sh = s.get(Shelter, first["id"])
        sh.occupancy = sh.capacity
        s.add(sh)
        s.commit()
    assert client.get("/api/shelters").json()["items"][0]["status"] == "full"


def test_cache_not_invalidated_by_unrelated_writes(client):
    client.get("/api/shelters")
    hits = cache.stats["hits"]
    client.post("/api/sos", json=SOS)  # touches Sos/Alert only
    client.get("/api/shelters")
    assert cache.stats["hits"] == hits + 1


def test_cache_ttl_expiry(client):
    client.get("/api/districts")
    misses = cache.stats["misses"]
    for k, (exp, v) in list(cache._store.items()):
        cache._store[k] = (exp - 10, v)
    client.get("/api/districts")
    assert cache.stats["misses"] == misses + 1


def test_cache_is_per_language(client):
    az = client.get("/api/shelters?lang=az").json()["items"][0]["name"]
    en = client.get("/api/shelters?lang=en").json()["items"][0]["name"]
    assert az != en


# ---- sanitization -----------------------------------------------------------------------------------------------
def test_sos_note_is_sanitized(client, headers):
    note = "<script>alert(1)</script>Help\x00\x07 <b>me</b>‮ now"
    assert client.post("/api/sos", json={**SOS, "note": note}).status_code == 201
    items = client.get("/api/sos", headers=headers).json()["items"]
    stored = next(x for x in items if x["citizenId"] == CID)["note"]
    assert stored == "alert(1)Help me now"


def test_sanitize_unit():
    assert util.sanitize_note("<img src=x onerror=a") == ""
    assert util.sanitize_note("<<b>script>x") == "scriptx"
    assert util.sanitize_note("a\n\tb") == "a b"


# ---- health state -----------------------------------------------------------------------------------------------
def test_health_has_state(client, headers):
    assert client.get("/api/health").json()["state"] == "up"
    client.post("/api/sim/provider", json={"state": "http503"}, headers=headers)
    h = client.get("/api/health").json()
    assert h["state"] == "http503" and h["degraded"] is True and h["routingProvider"] == "down"


# ---- audit ------------------------------------------------------------------------------------------------------
def _audit_rows():
    return [json.loads(line) for line in audit.path().read_text(encoding="utf-8").splitlines() if line.strip()]


def test_audit_trail_and_no_secrets(client):
    audit.path().write_text("")
    _login(client)
    tok = _login(client, pw="dispatcher123").json()["token"]
    h = {"Authorization": f"Bearer {tok}"}
    client.post("/api/sos", json=SOS)
    client.post("/api/sim/provider", json={"state": "up"}, headers=h)
    client.post("/api/sim/sos-burst", json={"lat": 40.4, "lng": 49.8, "count": 4}, headers=h)
    pending = client.get("/api/alerts?status=pending", headers=h).json()["items"]
    assert client.post(f"/api/alerts/{pending[0]['id']}/approve", headers=h).status_code == 200
    if len(pending) > 1:
        client.post(f"/api/alerts/{pending[1]['id']}/dismiss", headers=h)
    rows = _audit_rows()
    events = [r["event"] for r in rows]
    for e in ("login.failure", "login.success", "sos.create", "sim.call", "alert.approve"):
        assert e in events, e
    for r in rows:
        assert r["time"] and "ip" in r and "user" in r and "role" in r
    ok = next(r for r in rows if r["event"] == "login.success")
    assert ok["user"] == "dispatcher" and ok["role"] == "dispatcher"
    blob = audit.path().read_text(encoding="utf-8")
    assert tok not in blob and "dispatcher123" not in blob and "Bearer" not in blob


def test_audit_records_lockout(client):
    audit.path().write_text("")
    for _ in range(6):
        _login(client)
    assert "login.locked" in [r["event"] for r in _audit_rows()]


# ---- misc -------------------------------------------------------------------------------------------------------
def test_indexes_exist(client):
    insp = inspect(engine)
    sos_cols = {tuple(i["column_names"]) for i in insp.get_indexes("sos")}
    assert {("status",), ("created_at",), ("citizen_id",), ("status", "created_at")} <= sos_cols
    assert ("status",) in {tuple(i["column_names"]) for i in insp.get_indexes("alert")}


def test_default_secret_is_flagged(monkeypatch):
    monkeypatch.setattr(auth, "SECRET", auth.DEFAULT_SECRET)
    assert auth.secret_warnings()
    monkeypatch.setattr(auth, "SECRET", "x" * 40)
    assert not auth.secret_warnings()


def test_body_limit_constant_is_32kb():
    assert security.MAX_BODY == 32 * 1024
