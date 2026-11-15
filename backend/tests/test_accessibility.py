import uuid

from sqlmodel import Session, select

from app import alerts, realtime, services
from app.db import engine
from app.models import Alert, Crew, Road, Shelter

NOT_ACCESSIBLE = {"s5", "s6", "s7", "s10"}
ORIGIN = {"fromLat": 40.41, "fromLng": 49.86}


def post_sos(client, profile=None, cid=None, lat=40.41, lng=49.86):
    body = {"citizenId": cid or str(uuid.uuid4()), "type": "medical", "lat": lat, "lng": lng}
    if profile:
        body["profile"] = profile
    r = client.post("/api/sos", json=body)
    assert r.status_code == 201
    return r.json()["id"]


def pending(client, headers, lang="az"):
    return client.get(f"/api/alerts?status=pending&lang={lang}", headers=headers).json()["items"]


def test_seed_accessibility_flags(client, headers):
    shelters = client.get("/api/shelters").json()["items"]
    assert {s["id"] for s in shelters if not s["accessible"]} == NOT_ACCESSIBLE
    assert all(s["accessible"] for s in shelters if s["id"] in ("s9", "s12"))
    assert sum(not r["accessible"] for r in client.get("/api/roads").json()["items"]) == 3
    crews = client.get("/api/crews", headers=headers).json()["items"]
    assert sum(c["accessibleTransport"] for c in crews) == 3


def test_priority_assignment_and_sorting(client, headers):
    with client.websocket_connect("/ws/dispatcher?token=" + headers["Authorization"].split()[1]) as ws:
        a = post_sos(client)  # profile omitted -> standard
        b = post_sos(client, "special_needs")
        first = ws.receive_json()
        assert first["type"] == "sos.created"
        assert (first["data"]["profile"], first["data"]["priority"], first["data"]["priorityRank"]) == ("standard", "normal", 2)
    items = client.get("/api/sos?status=active", headers=headers).json()["items"]
    assert [x["id"] for x in items] == [b, a]  # critical first although it is newer
    assert (items[0]["profile"], items[0]["priority"], items[0]["priorityRank"]) == ("special_needs", "critical", 1)
    assert [x["id"] for x in client.get("/api/dashboard", headers=headers).json()["sos"]] == [b, a]


def test_profile_registry_is_used_when_profile_omitted(client, headers):
    cid = str(uuid.uuid4())
    client.get("/api/route", params={**ORIGIN, "citizenId": cid, "profile": "special_needs"})
    post_sos(client, cid=cid)  # no profile -> remembered special_needs
    assert client.get("/api/sos", headers=headers).json()["items"][0]["priority"] == "critical"
    post_sos(client, "standard", cid=cid)  # explicit value wins and is remembered
    assert realtime.hub.profiles[cid] == "standard"


def test_standard_route_fields_and_nearest_may_be_inaccessible(client):
    r = client.get("/api/route", params={"fromLat": 40.425, "fromLng": 49.87}).json()
    assert r["shelter"]["id"] == "s5" and r["shelter"]["accessible"] is False  # nearest, not accessible
    assert (r["accessible"], r["transport"], r["accessibilityNotes"]) == (False, "walk", [])


def test_special_route_excludes_non_accessible_shelters(client):
    q = {"fromLat": 40.425, "fromLng": 49.87, "profile": "special_needs"}
    r = client.get("/api/route", params=q).json()
    assert r["shelter"]["id"] not in NOT_ACCESSIBLE and r["shelter"]["accessible"] is True
    assert r["accessible"] is True and r["transport"] == "wheelchair_medical"
    assert r["accessibilityNotes"] == ["RAMP", "STEP_FREE", "MEDICAL_TRANSPORT_AVAILABLE"]
    r = client.get("/api/route", params={**q, "shelterId": "s5"}).json()  # explicitly requested inaccessible shelter
    assert r["rerouted"] and r["reason"] == "SHELTER_NOT_ACCESSIBLE" and r["requestedShelterId"] == "s5"
    assert r["shelter"]["id"] not in NOT_ACCESSIBLE


def test_special_route_treats_inaccessible_roads_as_blocked(client):
    with Session(engine) as s:  # an inaccessible road lying across the origin -> s1 route
        s.add(Road(id="tx1", name="Steps", name_en="Steps", name_ru="Лестница", accessible=False,
                   path=[[40.4030, 49.8540], [40.4040, 49.8545]]))
        s.commit()
    q = {**ORIGIN, "shelterId": "s1"}
    std = client.get("/api/route", params=q).json()
    assert std["shelter"]["id"] == "s1" and not std["rerouted"]
    sp = client.get("/api/route", params={**q, "profile": "special_needs"}).json()
    assert sp["rerouted"] and sp["reason"] == "ROAD_NOT_ACCESSIBLE" and sp["shelter"]["id"] != "s1"
    with Session(engine) as s:
        bad = [r.path for r in s.exec(select(Road)).all() if not r.accessible]
    assert not services.blocked(sp["route"]["path"], bad, (ORIGIN["fromLat"], ORIGIN["fromLng"]))


def test_no_accessible_route_returns_409(client):
    with Session(engine) as s:
        for sh in s.exec(select(Shelter)).all():
            if sh.accessible:  # every accessible shelter is full (reserves stay closed)
                sh.occupancy = sh.capacity
                s.add(sh)
        s.commit()
    for extra in ({}, {"shelterId": "s1"}, {"shelterId": "s5"}):
        r = client.get("/api/route", params={**ORIGIN, "profile": "special_needs", **extra})
        assert r.status_code == 409 and r.json()["error"]["code"] == "NO_ACCESSIBLE_ROUTE"
    assert client.get("/api/route", params=ORIGIN).status_code == 200  # standard citizens are unaffected


def test_ws_reroute_keeps_accessible_constraint(client):
    cid = str(uuid.uuid4())
    with client.websocket_connect(f"/ws/citizen?citizenId={cid}") as ws:
        r = client.get("/api/route", params={**ORIGIN, "shelterId": "s1", "citizenId": cid, "profile": "special_needs"})
        assert r.json()["shelter"]["id"] == "s1"
        with Session(engine) as s:
            sh = s.get(Shelter, "s1")
            sh.occupancy = 1850  # 92.5 % -> nearly full
            s.add(sh)
            s.commit()
            realtime.shelter_changed(sh)
        msgs = {m["type"]: m["data"] for m in (ws.receive_json(), ws.receive_json())}
    rr = msgs["reroute"]
    assert rr["reason"] == "SHELTER_NEARLY_FULL" and rr["shelter"]["accessible"] is True
    assert rr["shelter"]["id"] not in NOT_ACCESSIBLE and rr["transport"] == "wheelchair_medical"


def test_priority_sos_alert_and_approve(client, headers):
    with client.websocket_connect("/ws/dispatcher?token=" + headers["Authorization"].split()[1]) as ws:
        post_sos(client)  # standard SOS never raises a priority alert
        assert pending(client, headers) == []
        sos_id = post_sos(client, "special_needs")
        created = None
        for _ in range(10):
            m = ws.receive_json()
            if m["type"] == "alert.created":
                created = m["data"]
                break
    assert created and created["kind"] == "PRIORITY_SOS" and created["level"] == "red"
    assert created["code"] == "PRIORITY_SOS_DISPATCH_ACCESSIBLE_TRANSPORT"
    assert created["message"] == "Prioritet SOS: Əlçatan nəqliyyatlı briqada göndər"
    assert created["details"]["sosId"] == sos_id
    assert created["proposal"]["crewId"] in ("c2", "c4") and created["proposal"]["newShelterId"] is None
    assert pending(client, headers, "en")[0]["message"] == "Priority SOS: Send a crew with accessible transport"

    with Session(engine) as s:  # de-dup per SOS
        x = [a for a in s.exec(select(Alert)).all()]
        assert len(x) == 1
        from app.models import Sos
        assert alerts.check_priority(s, s.get(Sos, sos_id)) is None

    r = client.post(f"/api/alerts/{created['id']}/approve", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["alert"]["status"] == "approved" and body["newShelter"] is None
    assert body["crew"]["status"] == "dispatched" and body["crew"]["accessibleTransport"] is True
    shelters = {s["id"]: s for s in client.get("/api/shelters").json()["items"]}
    assert shelters["s9"]["status"] == "closed" and shelters["s12"]["status"] == "closed"


def test_two_priority_alerts_get_different_accessible_crews_and_dismiss(client, headers):
    post_sos(client, "special_needs")
    post_sos(client, "special_needs", lat=40.38, lng=49.83)
    a, b = pending(client, headers)
    assert {a["proposal"]["crewId"], b["proposal"]["crewId"]} == {"c2", "c4"}
    r = client.post(f"/api/alerts/{a['id']}/dismiss", headers=headers)
    assert r.json()["alert"]["status"] == "dismissed"


def test_priority_approve_without_accessible_crew(client, headers):
    with Session(engine) as s:
        for c in s.exec(select(Crew).where(Crew.accessible_transport == True)).all():  # noqa: E712
            c.status = "busy"
            s.add(c)
        s.commit()
    post_sos(client, "special_needs")
    a = pending(client, headers)[0]
    assert a["proposal"]["crewId"] is None
    r = client.post(f"/api/alerts/{a['id']}/approve", headers=headers)
    assert r.status_code == 409 and r.json()["error"]["code"] == "NO_CREW_AVAILABLE"
