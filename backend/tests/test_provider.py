import time

import httpx

from app import routing

Q = {"fromLat": 40.41, "fromLng": 49.86, "shelterId": "s1"}


def token(headers):
    return headers["Authorization"].split()[1]


def test_outage_fallback_breaker_and_recovery(client, headers):
    assert client.get("/api/route", params=Q).json()["source"] == "provider"
    assert client.get("/api/health").json() == {"status": "ok", "routingProvider": "up", "breaker": "closed",
                                                "degraded": False}
    assert client.post("/api/sim/provider", json={"state": "down"}).status_code == 401  # needs a token

    with client.websocket_connect("/ws/dispatcher?token=" + token(headers)) as ws:
        r = client.post("/api/sim/provider", headers=headers, json={"state": "down"})
        assert r.json() == {"ok": True, "state": "down"}
        assert ws.receive_json()["data"] == {"state": "down", "breaker": "closed"}
        assert client.get("/api/health").json()["routingProvider"] == "down"

        for _ in range(3):  # outage -> straight-line fallback; 3 failures open the breaker
            r = client.get("/api/route", params=Q).json()
            assert r["source"] == "fallback" and r["alternatives"] == [] and r["route"]["distanceMeters"] > 0
        m = ws.receive_json()
        assert m["type"] == "provider.updated" and m["data"] == {"state": "down", "breaker": "open"}
        assert client.get("/api/health").json()["breaker"] == "open"

        client.post("/api/sim/provider", headers=headers, json={"state": "up"})  # recovery closes the breaker
        assert ws.receive_json()["data"] == {"state": "up", "breaker": "closed"}
    assert client.get("/api/health").json() == {"status": "ok", "routingProvider": "up", "breaker": "closed",
                                                "degraded": False}
    assert client.get("/api/route", params=Q).json()["source"] == "provider"


def test_slow_provider_times_out_without_long_block(client, headers, monkeypatch):
    monkeypatch.setattr(routing, "TIMEOUT", 0.05)
    monkeypatch.setattr(routing, "SLOW_DELAY", 0.3)  # slower than the timeout
    client.post("/api/sim/provider", headers=headers, json={"state": "slow"})
    t = time.monotonic()
    r = client.get("/api/route", params={"fromLat": 40.41, "fromLng": 49.86}).json()  # several candidate routes
    assert r["source"] == "fallback"
    assert time.monotonic() - t < 0.25  # one timeout per request, not one per candidate shelter
    assert client.get("/api/health").json()["routingProvider"] == "down"
    assert client.post("/api/sim/provider", headers=headers, json={"state": "bogus"}).status_code == 422


def osrm_payload():
    leg = lambda d, pts: {"distance": d, "duration": d / 10, "geometry": {"coordinates": pts}}  # noqa: E731
    return {"code": "Ok", "routes": [leg(1234.4, [[49.86, 40.41], [49.85, 40.40]]),
                                      leg(1500.0, [[49.86, 40.41], [49.84, 40.42], [49.85, 40.40]])]}


def test_osrm_provider_parsing_and_failures(monkeypatch):
    seen = []

    def handler(request):
        seen.append(request.url.path)
        mode = handler.mode
        if mode == "ok":
            return httpx.Response(200, json=osrm_payload())
        if mode == "error":
            return httpx.Response(500)
        time.sleep(0.3)  # "hang"
        return httpx.Response(200, json=osrm_payload())

    p = routing.OsrmProvider(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(routing, "provider", p)
    routing.set_state("up")

    handler.mode = "ok"
    main, alts, src, mode = routing.plan((40.41, 49.86), (40.40, 49.85))
    assert src == "provider" and mode is None and seen[0] == "/route/v1/driving/49.86,40.41;49.85,40.4"  # lng,lat order
    assert main == {"distanceMeters": 1234, "durationSec": 123, "path": [[40.41, 49.86], [40.4, 49.85]]}  # lat,lng out
    assert len(alts) == 1 and alts[0]["label"] == "Alternativ 1"

    handler.mode = "error"  # HTTP 500 -> fallback
    assert routing.plan((40.41, 49.86), (40.40, 49.85))[2] == "fallback"

    monkeypatch.setattr(routing, "TIMEOUT", 0.05)
    handler.mode = "hang"  # slow upstream -> bounded wait, then fallback
    t = time.monotonic()
    assert routing.plan((40.41, 49.86), (40.40, 49.85))[2] == "fallback"
    assert time.monotonic() - t < 0.25
    routing.set_state("up")
