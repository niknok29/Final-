import uuid
from datetime import timedelta

from sqlmodel import select

from app import alerts
from app.models import Alert, Crew, Shelter, Sos, now

LAT, LNG = 40.41, 49.86


def add_sos(db, citizen=None, lat=LAT, lng=LNG, age_min=0.0):
    x = Sos(id="sos_" + uuid.uuid4().hex[:8], citizen_id=citizen or str(uuid.uuid4()), type="fire", lat=lat, lng=lng,
            zone_id="nasimi", created_at=now() - timedelta(minutes=age_min))
    db.add(x)
    db.commit()
    return x


def pending(db, kind=None):
    q = select(Alert).where(Alert.status == "pending")
    return [a for a in db.exec(q).all() if kind in (None, a.kind)]


def test_four_distinct_citizens_trigger(db):
    results = [alerts.check_sos(db, add_sos(db, lat=LAT + i * 0.0005)) for i in range(4)]
    assert results[:3] == [None, None, None]
    a = results[3]
    assert a.kind == "SOS_CLUSTER" and a.status == "pending"
    assert a.details["sosCount"] == 4 and a.details["windowMinutes"] == 5 and a.details["radiusMeters"] == 500
    assert a.proposal["crewId"] and a.proposal["newShelterId"] in ("s9", "s12")


def test_three_citizens_do_not_trigger(db):
    assert all(alerts.check_sos(db, add_sos(db)) is None for _ in range(3))
    assert pending(db) == []


def test_same_citizen_four_times_does_not_trigger(db):
    cid = str(uuid.uuid4())
    assert all(alerts.check_sos(db, add_sos(db, citizen=cid)) is None for _ in range(4))
    assert pending(db) == []


def test_sos_outside_radius_does_not_count(db):
    for _ in range(3):
        add_sos(db)
    far = add_sos(db, lat=LAT + 0.01)  # ~1.1 km away
    assert alerts.check_sos(db, far) is None


def test_window_expiry(db):
    for _ in range(3):
        add_sos(db, age_min=6)  # outside the 5 minute window
    assert alerts.check_sos(db, add_sos(db)) is None
    for _ in range(3):
        add_sos(db, age_min=4)  # still inside the window
    assert alerts.check_sos(db, add_sos(db)).kind == "SOS_CLUSTER"


def test_resolved_sos_do_not_count(db):
    for _ in range(3):
        x = add_sos(db)
        x.status = "resolved"
        db.add(x)
    db.commit()
    assert alerts.check_sos(db, add_sos(db)) is None


def set_occupancy(db, sid, occ):
    sh = db.get(Shelter, sid)
    sh.occupancy = occ
    db.add(sh)
    db.commit()
    return sh


def test_shelter_overload(db):
    assert alerts.check_shelter(db, set_occupancy(db, "s1", 1900)) is None  # exactly 95 % is not "> 95"
    a = alerts.check_shelter(db, set_occupancy(db, "s1", 1950))
    assert a.kind == "SHELTER_OVERLOAD"
    assert a.details["shelterId"] == "s1" and a.details["occupancyPercent"] == 97.5 and a.details["sosCount"] is None


def test_deduplication(db):
    for _ in range(4):
        alerts.check_sos(db, add_sos(db))
    assert alerts.check_sos(db, add_sos(db)) is None  # 5th SOS of the same cluster
    sh = set_occupancy(db, "s1", 1950)
    alerts.check_shelter(db, sh)
    assert alerts.check_shelter(db, set_occupancy(db, "s1", 1990)) is None
    assert len(pending(db, "SOS_CLUSTER")) == 1 and len(pending(db, "SHELTER_OVERLOAD")) == 1
    alerts.dismiss(db, pending(db, "SHELTER_OVERLOAD")[0].id)  # once handled, a new overload may alert again
    assert alerts.check_shelter(db, sh) is not None


def test_proposals_use_different_crews_and_shelters(db):
    for lat in (LAT, 40.45):  # two clusters far apart
        for _ in range(4):
            alerts.check_sos(db, add_sos(db, lat=lat))
    a, b = pending(db, "SOS_CLUSTER")
    assert a.proposal["crewId"] != b.proposal["crewId"]
    assert a.proposal["newShelterId"] != b.proposal["newShelterId"]


def test_approve_flow_via_api(client, headers):
    with client.websocket_connect("/ws/dispatcher?token=" + headers["Authorization"].split()[1]) as ws:
        for i in range(4):
            assert client.post("/api/sos", json={"citizenId": str(uuid.uuid4()), "type": "fire",
                                                 "lat": LAT + i * 0.0003, "lng": LNG}).status_code == 201
        created = None
        for _ in range(20):
            m = ws.receive_json()
            if m["type"] == "alert.created":
                created = m["data"]
                break
        assert created and created["kind"] == "SOS_CLUSTER" and created["level"] == "red"

        items = client.get("/api/alerts?status=pending", headers=headers).json()["items"]
        assert [a["id"] for a in items] == [created["id"]]
        crew_id, shelter_id = created["proposal"]["crewId"], created["proposal"]["newShelterId"]

        r = client.post(f"/api/alerts/{created['id']}/approve", headers=headers)
        assert r.status_code == 200
        body = r.json()
        assert body["alert"]["status"] == "approved"
        assert body["crew"]["id"] == crew_id and body["crew"]["status"] == "dispatched"
        assert body["newShelter"]["id"] == shelter_id and body["newShelter"]["status"] == "open"

        seen = set()
        for _ in range(10):
            seen.add(ws.receive_json()["type"])
            if {"crew.updated", "shelter.updated", "alert.updated"} <= seen:
                break
        assert {"crew.updated", "shelter.updated", "alert.updated"} <= seen

    shelters = {s["id"]: s for s in client.get("/api/shelters").json()["items"]}
    assert shelters[shelter_id]["status"] == "open"
    crews = {c["id"]: c for c in client.get("/api/crews", headers=headers).json()["items"]}
    assert crews[crew_id]["status"] == "dispatched" and crews[crew_id]["assignedAlertId"] == created["id"]
    assert client.post(f"/api/alerts/{created['id']}/approve", headers=headers).status_code == 409


def test_dismiss_flow(client, headers):
    client.post("/api/sim/sos-burst", headers=headers, json={"lat": LAT, "lng": LNG, "count": 4})
    a = client.get("/api/alerts?status=pending", headers=headers).json()["items"][0]
    r = client.post(f"/api/alerts/{a['id']}/dismiss", headers=headers)
    assert r.json()["alert"]["status"] == "dismissed"
    assert client.get("/api/alerts?status=pending", headers=headers).json()["items"] == []


def test_approve_without_available_crew(db, client, headers):
    for c in db.exec(select(Crew)).all():
        c.status = "busy"
        db.add(c)
    db.commit()
    alerts.check_shelter(db, set_occupancy(db, "s1", 1990))
    a = pending(db)[0]
    assert a.proposal["crewId"] is None
    r = client.post(f"/api/alerts/{a.id}/approve", headers=headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_CREW_AVAILABLE"


def test_sim_endpoints(client, headers):
    assert client.post("/api/sim/reset").status_code == 401
    assert client.post("/api/sim/roads/r1/close", headers=headers).json() == {"ok": True}
    assert next(r for r in client.get("/api/roads").json()["items"] if r["id"] == "r1")["status"] == "closed"
    assert client.post("/api/sim/roads/r1/open", headers=headers).json() == {"ok": True}
    assert client.post("/api/sim/roads/nope/close", headers=headers).status_code == 404

    assert client.post("/api/sim/shelters/s1/occupancy", headers=headers, json={"percent": 96}).json() == {"ok": True}
    kinds = [a["kind"] for a in client.get("/api/alerts?status=pending", headers=headers).json()["items"]]
    assert kinds == ["SHELTER_OVERLOAD"]

    client.post("/api/sim/sos-burst", headers=headers, json={"lat": LAT, "lng": LNG, "count": 4, "type": "fire"})
    d = client.get("/api/dashboard", headers=headers).json()
    assert d["stats"]["activeSos"] == 4 and d["stats"]["pendingAlerts"] == 2

    assert client.post("/api/sim/reset", headers=headers).json() == {"ok": True}
    d = client.get("/api/dashboard", headers=headers).json()
    assert d["stats"]["activeSos"] == 0 and d["alerts"] == []
    assert next(s for s in d["shelters"] if s["id"] == "s1")["occupancyPercent"] == 75.0
