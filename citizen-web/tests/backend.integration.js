import test from "node:test";
import assert from "node:assert/strict";
import {
  api,
  getCitizenId,
  getNearestShelters,
  getRoute,
  sendSOS,
  markSafe,
} from "../src/api/client.js";

// Run only against an isolated test backend. Simulation is test-only;
// no dispatcher controls or credentials are included in the application bundle.
test("real FastAPI citizen integration", async (t) => {
  const base = "http://localhost:8000";
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "dispatcher", password: "dispatcher123" }),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const simulate = async (path, body) => {
    const res = await fetch(`${base}/api/sim/${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    assert.equal(res.status, 200, await res.text());
  };
  await simulate("reset");
  t.after(async () => {
    await simulate("reset");
  });
  await t.test(
    "districts, shelters, roads and nearest three load",
    async () => {
      assert.equal((await api.getDistricts("az")).items.length, 12);
      assert.equal((await api.getShelters("en")).items.length, 12);
      assert.ok((await api.getRoads("ru")).items.length > 0);
      const nearest = (await getNearestShelters(40.41, 49.86, 3, "en")).items;
      assert.equal(nearest.length, 3);
      assert.ok(nearest[0].distanceMeters <= nearest[1].distanceMeters);
    },
  );
  await t.test(
    "standard, accessible, explicit standard reset and localized names",
    async () => {
      const standard = await getRoute(40.41, 49.86, "s1", "en", "standard");
      assert.equal(standard.source, "provider");
      assert.equal(standard.transport, "walk");
      const accessible = await getRoute(
        40.425,
        49.87,
        "s5",
        "ru",
        "special_needs",
      );
      assert.equal(accessible.accessible, true);
      assert.equal(accessible.transport, "wheelchair_medical");
      assert.equal(accessible.reason, "SHELTER_NOT_ACCESSIBLE");
      assert.ok(accessible.accessibilityNotes.includes("STEP_FREE"));
      assert.equal(
        (await getRoute(40.41, 49.86, "s1", "en", "standard")).transport,
        "walk",
      );
      const az = await api.getShelters("az"),
        en = await api.getShelters("en"),
        ru = await api.getShelters("ru");
      assert.notEqual(az.items[0].name, en.items[0].name);
      assert.notEqual(en.items[0].name, ru.items[0].name);
    },
  );
  await t.test("normal SOS, priority SOS and safe resolution", async () => {
    const normal = await sendSOS(
      "fire",
      40.41,
      49.86,
      "test standard",
      "standard",
    );
    const priority = await sendSOS(
      "medical",
      40.41,
      49.86,
      "test accessible",
      "special_needs",
    );
    assert.equal(normal.status, "active");
    assert.equal(priority.status, "active");
    const sos = await (await fetch(`${base}/api/sos`, { headers })).json();
    const critical = sos.items.find((x) => x.id === priority.id);
    assert.equal(critical.priority, "critical");
    assert.equal(critical.priorityRank, 1);
    assert.equal(sos.items.find((x) => x.id === normal.id).priority, "normal");
    assert.equal((await markSafe(40.41, 49.86)).status, "safe");
    const active = await (
      await fetch(`${base}/api/sos?status=active`, { headers })
    ).json();
    assert.ok(active.items.every((x) => x.citizenId !== getCitizenId()));
  });
  await t.test(
    "WebSocket shelter/road updates and accessible automatic reroute",
    async () => {
      const ws = new WebSocket(
        `ws://localhost:8000/ws/citizen?citizenId=${getCitizenId()}&lang=en`,
      );
      t.after(() => ws.close());
      const events = [];
      ws.addEventListener("message", (e) => events.push(JSON.parse(e.data)));
      await new Promise((resolve, reject) => {
        ws.onopen = resolve;
        ws.onerror = reject;
      });
      const route = await getRoute(40.41, 49.86, "s1", "en", "special_needs");
      await simulate(`shelters/${route.shelter.id}/occupancy`, { percent: 96 });
      await simulate("roads/r1/close");
      const deadline = Date.now() + 5000;
      while (
        Date.now() < deadline &&
        !["shelter.updated", "road.updated", "reroute"].every((type) =>
          events.some((x) => x.type === type),
        )
      )
        await new Promise((resolve) => setTimeout(resolve, 50));
      for (const type of ["shelter.updated", "road.updated", "reroute"])
        assert.ok(
          events.some((x) => x.type === type),
          `Missing ${type}`,
        );
      const reroute = events.find((x) => x.type === "reroute").data;
      assert.equal(reroute.message, "ROUTE_CHANGED");
      assert.equal(reroute.accessible, true);
      assert.notEqual(reroute.shelter.id, route.shelter.id);
      ws.close();
    },
  );
  await t.test("routing provider outage and recovery", async () => {
    await simulate("provider", { state: "down" });
    const fallback = await getRoute(40.41, 49.86, "s2", "en", "standard");
    assert.equal(fallback.source, "fallback");
    assert.deepEqual(fallback.alternatives, []);
    assert.equal(fallback.offline, true);
    assert.ok(
      ["cache", "static_matrix", "straight_line"].includes(
        fallback.fallbackMode,
      ),
    );
    assert.equal(fallback.notice.code, "OFFLINE_BACKUP_ROUTE_MODE");
    assert.ok(fallback.route.path.length >= 2);
    await simulate("provider", { state: "up" });
    assert.equal(
      (await getRoute(40.41, 49.86, "s2", "en", "standard")).source,
      "provider",
    );
  });
  await t.test(
    "section K HTTP 503 backup, AZ/EN/RU notices and recovery",
    async () => {
      await simulate("provider", { state: "http503" });
      const notices = new Set();
      for (const lang of ["az", "en", "ru"]) {
        const backup = await getRoute(
          40.41,
          49.86,
          "s2",
          lang,
          "special_needs",
        );
        assert.equal(backup.offline, true);
        assert.equal(backup.source, "fallback");
        assert.equal(backup.accessible, true);
        assert.equal(backup.transport, "wheelchair_medical");
        assert.equal(backup.notice.code, "OFFLINE_BACKUP_ROUTE_MODE");
        assert.deepEqual(backup.alternatives, []);
        notices.add(backup.notice.message);
      }
      assert.equal(notices.size, 3);
      await simulate("provider", { state: "up" });
      const recovered = await getRoute(40.41, 49.86, "s2", "en", "standard");
      assert.equal(recovered.offline, false);
      assert.equal(recovered.notice, null);
      assert.equal(recovered.fallbackMode, null);
    },
  );
  await t.test(
    "invalid citizen WebSocket closes with observable code 1008",
    async () => {
      const ws = new WebSocket(
        "ws://localhost:8000/ws/citizen?citizenId=invalid&lang=en",
      );
      const code = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ws.close();
          reject(new Error("Missing policy close"));
        }, 5000);
        ws.onerror = () => {};
        ws.onclose = (event) => {
          clearTimeout(timer);
          resolve(event.code);
        };
      });
      assert.equal(code, 1008);
    },
  );
  await t.test(
    "no accessible destination returns the documented 409",
    async () => {
      const shelters = (await api.getShelters("en")).items;
      for (const shelter of shelters.filter(
        (s) => s.accessible && s.status !== "closed",
      )) {
        await simulate(`shelters/${shelter.id}/occupancy`, { percent: 100 });
      }
      await assert.rejects(
        getRoute(40.41, 49.86, "s1", "en", "special_needs"),
        {
          code: "NO_ACCESSIBLE_ROUTE",
          status: 409,
        },
      );
    },
  );
});
