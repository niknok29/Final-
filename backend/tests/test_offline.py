import logging
import time
import uuid

from sqlmodel import Session

from app import realtime, routing, services
from app.db import engine
from app.models import Shelter

O = {"fromLat": 40.41, "fromLng": 49.86, "shelterId": "s1"}
NOTICE = {"az": "Oflayn / Ehtiyat marşrut rejimində işləyir", "en": "Offline / backup route mode is active",
          "ru": "Работает офлайн / в режиме резервных маршрутов"}


def set_state(client, headers, state):
    r = client.post("/api/sim/provider", headers=headers, json={"state": state})
    assert r.json() == {"ok": True, "state": state}


def test_http503_serves_backup_route_with_notice(client, headers):
    assert client.get("/api/route", params=O).json()["offline"] is False
    set_state(client, headers, "http503")
    for lang, text in NOTICE.items():
        r = client.get("/api/route", params={**O, "lang": lang})
        assert r.status_code == 200
        j = r.json()
        assert j["source"] == "fallback" and j["offline"] is True and j["fallbackMode"] in ("cache", "static_matrix")
        assert j["notice"] == {"code": "OFFLINE_BACKUP_ROUTE_MODE", "message": text}
        assert j["route"]["distanceMeters"] > 0 and j["route"]["durationSec"] > 0
    ok = client.get("/api/route", params={"fromLat": 40.41, "fromLng": 49.86, "shelterId": "s2"})
    assert ok.status_code == 200 and ok.json()["offline"] is True  # never a 5xx because of the provider


def test_online_route_has_no_offline_fields_set(client):
    j = client.get("/api/route", params=O).json()
    assert (j["source"], j["offline"], j["fallbackMode"], j["notice"]) == ("provider", False, None, None)


def test_cache_hit_after_one_successful_call(client, headers):
    first = client.get("/api/route", params=O).json()  # successful provider call fills the cache
    assert first["source"] == "provider"
    set_state(client, headers, "http503")
    j = client.get("/api/route", params=O).json()
    assert j["fallbackMode"] == "cache"
    assert j["route"]["distanceMeters"] == first["route"]["distanceMeters"]
    assert j["alternatives"] == [] and j["shelter"]["id"] == "s1"
    # a different origin cell is not cached -> static matrix
    far = client.get("/api/route", params={**O, "fromLat": 40.44, "fromLng": 49.95}).json()
    assert far["fallbackMode"] == "static_matrix"


def test_static_matrix_used_when_cache_is_empty(client, headers):
    routing.clear_cache()
    set_state(client, headers, "http503")
    j = client.get("/api/route", params=O).json()
    assert j["fallbackMode"] == "static_matrix"
    entry = routing.MATRIX[(routing.nearest_district_id((O["fromLat"], O["fromLng"])), "s1")]
    assert j["route"]["distanceMeters"] == entry["distanceMeters"] and j["route"]["durationSec"] == entry["durationSec"]
    assert j["route"]["path"][0] == [O["fromLat"], O["fromLng"]]  # polyline starts at the real origin
    assert len(routing.MATRIX) == 12 * 12  # every district centroid x every shelter


def test_matrix_distance_uses_detour_factor(client):
    d = next(iter(routing.MATRIX))
    straight = routing._pack(routing.MockProvider._via(*[(la, ln) for la, ln in _coords(d)], 0.12))["distanceMeters"]
    assert abs(routing.MATRIX[d]["distanceMeters"] - round(straight * routing.DETOUR)) <= 1


def _coords(key):
    from app.models import District

    with Session(engine) as s:
        dist, sh = s.get(District, key[0]), s.get(Shelter, key[1])
        return [(dist.lat, dist.lng), (sh.lat, sh.lng)]


def test_straight_line_when_no_backup_data(client, headers):
    routing.clear_cache()
    routing.MATRIX.clear()
    set_state(client, headers, "http503")
    j = client.get("/api/route", params=O).json()
    assert j["fallbackMode"] == "straight_line" and j["offline"] is True
    assert j["route"]["path"] == [[40.41, 49.86], [40.395, 49.852]]


def test_slow_provider_falls_back_within_timeout(client, headers):
    set_state(client, headers, "slow")  # simulated >5 s latency, real 2 s timeout
    t = time.monotonic()
    r = client.get("/api/route", params=O)
    took = time.monotonic() - t
    assert r.status_code == 200 and r.json()["offline"] is True
    assert 1.8 <= took <= 2.6, took


def test_breaker_opens_automatically_and_recovers(client, headers):
    set_state(client, headers, "http503")
    for _ in range(3):
        assert client.get("/api/route", params=O).json()["offline"] is True
    assert client.get("/api/health").json()["breaker"] == "open"
    t = time.monotonic()
    assert client.get("/api/route", params=O).json()["offline"] is True  # open breaker: instant, no provider call
    assert time.monotonic() - t < 0.5
    set_state(client, headers, "up")
    h = client.get("/api/health").json()
    assert (h["routingProvider"], h["breaker"], h["degraded"]) == ("up", "closed", False)
    assert client.get("/api/route", params=O).json()["source"] == "provider"


def test_health_degraded_flag(client, headers):
    assert client.get("/api/health").json()["degraded"] is False
    for state in ("down", "http503", "slow"):
        set_state(client, headers, state)
        h = client.get("/api/health").json()
        assert h["degraded"] is True and h["routingProvider"] == "down", state
    set_state(client, headers, "up")
    assert client.get("/api/health").json()["degraded"] is False
    for _ in range(3):  # breaker open also counts as degraded, even if the state were "up"
        routing.breaker.failure()
    assert client.get("/api/health").json()["degraded"] is True
    routing.breaker.success()


def test_any_provider_exception_is_absorbed(client, monkeypatch):
    class Broken:
        def route(self, a, b):
            raise KeyError("boom")  # not a ProviderError

    monkeypatch.setattr(routing, "provider", Broken())
    r = client.get("/api/route", params=O)
    assert r.status_code == 200 and r.json()["offline"] is True


def test_global_handler_returns_standard_error_json(client, monkeypatch, caplog):
    def boom(*a, **k):
        raise RuntimeError("secret internal detail")

    monkeypatch.setattr(services, "build_route", boom)
    with caplog.at_level(logging.ERROR):
        r = client.get("/api/route", params=O, headers={"Origin": "http://localhost:5174"})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "INTERNAL_ERROR", "message": "Internal server error"}}
    assert "secret" not in r.text and "Traceback" not in r.text  # no internals in the body
    assert r.headers["access-control-allow-origin"] == "http://localhost:5174"  # browser can read it
    assert "secret internal detail" in caplog.text  # but it is logged


def test_ws_reroute_payload_carries_offline_fields(client, headers):
    cid = str(uuid.uuid4())
    with client.websocket_connect(f"/ws/citizen?citizenId={cid}&lang=en") as ws:
        client.get("/api/route", params={**O, "citizenId": cid})
        set_state(client, headers, "http503")
        with Session(engine) as s:
            sh = s.get(Shelter, "s1")
            sh.occupancy = 1850  # 92.5 % -> reroute
            s.add(sh)
            s.commit()
            realtime.shelter_changed(sh)
        msgs = {m["type"]: m["data"] for m in (ws.receive_json(), ws.receive_json())}
    rr = msgs["reroute"]
    assert rr["offline"] is True and rr["fallbackMode"] in ("cache", "static_matrix", "straight_line")
    assert rr["notice"] == {"code": "OFFLINE_BACKUP_ROUTE_MODE", "message": NOTICE["en"]}


def test_websocket_broadcast_errors_are_swallowed(client, caplog):
    done = []
    with caplog.at_level(logging.ERROR):
        realtime.hub.submit(lambda: 1 / 0, "x", {})  # selector blows up inside the event loop
        for _ in range(50):
            if "broadcast x failed" in caplog.text:
                break
            time.sleep(0.05)
        done.append(client.get("/api/health").status_code)
    assert "websocket broadcast x failed" in caplog.text and done == [200]  # and the server keeps working
