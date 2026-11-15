import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineCache, haversine } from "../src/services/offlineCache.js";
import { setDevMode, simulateDevOutage } from "../src/api/devOutage.js";
import {
  api,
  getRoute,
  getNearestShelters,
  getClientOffline,
  request,
  REQUEST_TIMEOUT_MS,
  withDeadline,
} from "../src/api/client.js";
const shelters = {
  items: [
    {
      id: "s1",
      name: "Accessible",
      lat: 40.41,
      lng: 49.86,
      status: "open",
      occupancyPercent: 20,
      accessible: true,
      capacity: 100,
      occupancy: 20,
      kind: "shelter",
    },
    {
      id: "s2",
      name: "Steps",
      lat: 40.4101,
      lng: 49.8601,
      status: "open",
      occupancyPercent: 10,
      accessible: false,
      capacity: 100,
      occupancy: 10,
      kind: "park",
    },
    {
      id: "s3",
      name: "Park",
      lat: 40.42,
      lng: 49.87,
      status: "open",
      occupancyPercent: 30,
      accessible: true,
      capacity: 100,
      occupancy: 30,
      kind: "park",
    },
  ],
};
const context = {
  lat: 40.4093,
  lng: 49.8671,
  shelterId: "s1",
  profile: "special_needs",
  lang: "en",
};
const route = {
  shelter: shelters.items[0],
  route: {
    distanceMeters: 800,
    durationSec: 600,
    path: [
      [context.lat, context.lng],
      [40.41, 49.86],
    ],
  },
  source: "provider",
  offline: false,
  fallbackMode: null,
  notice: null,
  accessible: true,
  transport: "wheelchair_medical",
  accessibilityNotes: ["RAMP", "STEP_FREE"],
  alternatives: [],
};
function storage() {
  const entries = new Map();
  return {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };
}
test("persistent metadata and exact-context route survive cache reload", () => {
  const db = storage(),
    cache = createOfflineCache(db);
  cache.save("shelters", shelters, { lang: "en" });
  cache.save(
    "roads",
    {
      items: [
        {
          id: "r1",
          status: "closed",
          path: [
            [40, 49],
            [41, 50],
          ],
        },
      ],
    },
    { lang: "en" },
  );
  cache.save("route", route, context);
  const restored = createOfflineCache(db);
  assert.deepEqual(restored.list("shelters", "en"), shelters);
  assert.equal(restored.list("roads", "en").items[0].status, "closed");
  const backup = restored.route(context);
  assert.equal(backup.fallbackMode, "client_cache");
  assert.equal(backup.offline, true);
  assert.deepEqual(backup.route, route.route);
  assert.deepEqual(backup.alternatives, []);
});
test("new origin uses Haversine estimate to nearest compatible cached shelter; no verified accessibility claim", () => {
  const cache = createOfflineCache(storage());
  cache.save("shelters", shelters, { lang: "en" });
  const backup = cache.route({ ...context, lat: 40.41009, lng: 49.86009 });
  assert.equal(backup.shelter.id, "s1");
  assert.equal(backup.accessible, false);
  assert.equal(backup.fallbackMode, "straight_line");
  assert.equal(backup.route.path.length, 2);
  assert.equal(
    backup.route.distanceMeters,
    haversine(40.41009, 49.86009, shelters.items[0]),
  );
  assert.deepEqual(backup.accessibilityNotes, []);
  cache.update(
    "shelters",
    { ...shelters.items[0], status: "full", occupancyPercent: 100 },
    "en",
  );
  assert.equal(cache.route(context).shelter.id, "s3");
  cache.update("shelters", { ...shelters.items[2], status: "closed" }, "en");
  assert.equal(cache.route(context), null);
});
test("damaged cache and missing storage do not crash; no cache means no invented destination", () => {
  assert.equal(
    createOfflineCache({
      getItem: () => "{broken",
      setItem: () => {
        throw Error();
      },
    }).route(context),
    null,
  );
  assert.equal(createOfflineCache().nearest(context), null);
});
test("actual API layer restores cache on 503, preserves 409 and recovers live data", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async (url) =>
    Response.json(
      new URL(url).pathname === "/api/route"
        ? route
        : new URL(url).pathname === "/api/shelters"
          ? shelters
          : { items: [] },
    );
  await api.getDistricts("en");
  await api.getShelters("en");
  await api.getRoads("en");
  await getRoute(context.lat, context.lng, "s1", "en", "special_needs");
  globalThis.fetch = async () =>
    Response.json({ error: { code: "INTERNAL_ERROR" } }, { status: 503 });
  assert.deepEqual(await api.getShelters("en"), shelters);
  assert.deepEqual(await api.getRoads("en"), { items: [] });
  assert.equal(
    (await getNearestShelters(context.lat, context.lng, 3, "en")).items.length,
    3,
  );
  assert.equal(
    (await getRoute(context.lat, context.lng, "s1", "en", "special_needs"))
      .fallbackMode,
    "client_cache",
  );
  assert.equal(getClientOffline(), true);
  globalThis.fetch = async () =>
    Response.json({ error: { code: "NO_ACCESSIBLE_ROUTE" } }, { status: 409 });
  await assert.rejects(
    getRoute(context.lat, context.lng, "s1", "en", "special_needs"),
    { code: "NO_ACCESSIBLE_ROUTE" },
  );
  globalThis.fetch = async (url) =>
    Response.json(
      new URL(url).pathname === "/api/route"
        ? route
        : new URL(url).pathname === "/api/shelters"
          ? shelters
          : { items: [] },
    );
  await api.getDistricts("en");
  await api.getShelters("en");
  await api.getRoads("en");
  await getNearestShelters(context.lat, context.lng, 3, "en");
  await getRoute(context.lat, context.lng, "s1", "en", "special_needs");
  assert.equal(getClientOffline(), false);
});
test("5-second deadline aborts transport, including a stuck response body", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  assert.equal(REQUEST_TIMEOUT_MS, 5000);
  let signal;
  globalThis.fetch = async (_url, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  const pending = request("/api/roads");
  await Promise.resolve();
  t.mock.timers.tick(4999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, { code: "TIMEOUT" });
  assert.equal(signal.aborted, true);
  globalThis.fetch = async () => ({
    ok: true,
    json: () => new Promise(() => {}),
  });
  const body = request("/api/safe", { body: { citizenId: "test" } });
  await Promise.resolve();
  t.mock.timers.tick(5000);
  await assert.rejects(body, { code: "TIMEOUT" });
});
test("caller cancellation remains AbortError rather than using stale fallback", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () => new Promise(() => {});
  const controller = new AbortController();
  const pending = api.getShelters("en", controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
});
test("duplicate SOS response is acknowledged even when the status is conflict", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
  });
  globalThis.fetch = async () =>
    Response.json({ duplicate: true }, { status: 409 });
  assert.deepEqual(await request("/api/sos", { body: {} }), {
    duplicate: true,
  });
});
test("development outage fixtures model errors and latency; production transport ignores them", async (t) => {
  const original = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = original;
    setDevMode("live");
  });
  setDevMode("offline");
  await assert.rejects(simulateDevOutage(new AbortController().signal), {
    code: "NETWORK_ERROR",
  });
  setDevMode("http503");
  await assert.rejects(simulateDevOutage(new AbortController().signal), {
    status: 503,
  });
  globalThis.fetch = async () => Response.json({ items: [] });
  assert.deepEqual(await request("/api/roads"), { items: [] });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  setDevMode("latency");
  const pending = withDeadline((signal) => simulateDevOutage(signal));
  await Promise.resolve();
  t.mock.timers.tick(5000);
  await assert.rejects(pending, { code: "TIMEOUT" });
});
