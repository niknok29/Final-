import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import i18next from "i18next";
import {
  routeNoticeKey,
  routeWarningKey,
  shelterKindIcon,
} from "../src/routeDisplay.js";
import {
  api,
  getCitizenId,
  getNearestShelters,
  getRoute,
  sendSOS,
  markSafe,
  request,
  retrySeconds,
  connectCitizen,
} from "../src/api/client.js";

const originalFetch = globalThis.fetch;
test("Citizen API contract and reliability", async (t) => {
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: new URL(url), options });
    return Response.json({ items: [] });
  };
  await t.test(
    "valid persistent UUID v4, shared between route/SOS/safe",
    async () => {
      const id = getCitizenId();
      assert.match(
        id,
        /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i,
      );
      assert.equal(getCitizenId(), id);
      await getRoute(40.41, 49.86, "s1", "ru", "special_needs");
      const route = calls.at(-1).url;
      assert.equal(route.pathname, "/api/route");
      assert.equal(route.searchParams.get("citizenId"), id);
      assert.equal(route.searchParams.get("profile"), "special_needs");
      assert.equal(route.searchParams.get("lang"), "ru");
      assert.equal(route.searchParams.get("fromLat"), "40.41");
      await getRoute(40.41, 49.86, "s1", "en", "standard");
      assert.equal(calls.at(-1).url.searchParams.get("profile"), "standard");
      await sendSOS(
        "medical",
        40.41,
        49.86,
        "<script>text only</script>",
        "special_needs",
      );
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
        citizenId: id,
        type: "medical",
        lat: 40.41,
        lng: 49.86,
        note: "<script>text only</script>",
        profile: "special_needs",
      });
      await markSafe(40.41, 49.86);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), {
        citizenId: id,
        lat: 40.41,
        lng: 49.86,
      });
    },
  );
  await t.test(
    "all citizen GETs carry language and cancellation signal",
    async () => {
      const controller = new AbortController();
      for (const name of ["getDistricts", "getShelters", "getRoads"]) {
        await api[name]("en", controller.signal);
        assert.equal(calls.at(-1).url.searchParams.get("lang"), "en");
        assert.equal(calls.at(-1).options.signal, controller.signal);
      }
      await getNearestShelters(40.41, 49.86, 3, "az", controller.signal);
      assert.equal(calls.at(-1).url.searchParams.get("limit"), "3");
    },
  );
  await t.test(
    "validation rejects unsupported hazard and oversized note before fetching",
    async () => {
      const length = calls.length;
      await assert.rejects(sendSOS("invalid", 0, 0), {
        code: "VALIDATION_ERROR",
      });
      await assert.rejects(sendSOS("fire", 0, 0, "x".repeat(201)), {
        code: "VALIDATION_ERROR",
      });
      assert.equal(calls.length, length);
    },
  );
  await t.test(
    "429 preserves machine code and Retry-After seconds/date",
    async () => {
      globalThis.fetch = async () =>
        Response.json(
          { error: { code: "RATE_LIMITED", message: "text" } },
          { status: 429, headers: { "Retry-After": "17" } },
        );
      await assert.rejects(sendSOS("fire", 0, 0), {
        code: "RATE_LIMITED",
        status: 429,
        retryAfter: 17,
      });
      assert.equal(
        retrySeconds(
          "Sun, 15 Nov 2026 10:00:20 GMT",
          Date.parse("2026-11-15T10:00:00Z"),
        ),
        20,
      );
      assert.equal(retrySeconds(null), 60);
    },
  );
  await t.test(
    "409 accessibility failure, network failure and cancellation stay distinct",
    async () => {
      globalThis.fetch = async () =>
        Response.json(
          { error: { code: "NO_ACCESSIBLE_ROUTE" } },
          { status: 409 },
        );
      await assert.rejects(getRoute(0, 0, "s1"), {
        code: "NO_ACCESSIBLE_ROUTE",
        status: 409,
      });
      globalThis.fetch = async () => {
        throw new Error("offline");
      };
      await assert.rejects(request("/api/roads"), { code: "NETWORK_ERROR" });
      globalThis.fetch = async () => {
        throw new DOMException("aborted", "AbortError");
      };
      await assert.rejects(request("/api/roads"), { name: "AbortError" });
    },
  );
  await t.test(
    "successful fallback response remains a valid route",
    async () => {
      const fallback = {
        source: "fallback",
        alternatives: [],
        route: {
          path: [
            [40, 49],
            [41, 50],
          ],
        },
      };
      globalThis.fetch = async () => Response.json(fallback);
      assert.deepEqual(await getRoute(40, 49, "s1"), fallback);
    },
  );
});

test("WebSocket reconnects with capped backoff; cleanup and 1008 stop retries", (t) => {
  const originalSocket = globalThis.WebSocket;
  const sockets = [];
  class FakeSocket {
    constructor(url) {
      this.url = new URL(url);
      sockets.push(this);
    }
    close() {
      this.closed = true;
    }
  }
  globalThis.WebSocket = FakeSocket;
  t.after(() => {
    globalThis.WebSocket = originalSocket;
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const statuses = [],
    events = [];
  let resync = 0;
  const cleanup = connectCitizen(
    "ru",
    (event) => events.push(event),
    (status) => statuses.push(status),
    () => resync++,
  );
  assert.equal(sockets[0].url.pathname, "/ws/citizen");
  assert.equal(sockets[0].url.searchParams.get("lang"), "ru");
  assert.equal(sockets[0].url.searchParams.get("citizenId"), getCitizenId());
  sockets[0].onopen();
  sockets[0].onmessage({
    data: JSON.stringify({ type: "reroute", data: { reason: "ROAD_CLOSED" } }),
  });
  sockets[0].onmessage({ data: "bad JSON" });
  assert.equal(events.length, 1);
  sockets[0].onclose({ code: 1006 });
  t.mock.timers.tick(999);
  assert.equal(sockets.length, 1);
  t.mock.timers.tick(1);
  assert.equal(sockets.length, 2);
  for (const delay of [2000, 4000, 8000, 10000, 10000]) {
    const count = sockets.length;
    sockets.at(-1).onclose({ code: 1006 });
    t.mock.timers.tick(delay - 1);
    assert.equal(sockets.length, count);
    t.mock.timers.tick(1);
    assert.equal(sockets.length, count + 1);
  }
  sockets.at(-1).onopen();
  assert.equal(resync, 1);
  sockets.at(-1).onclose({ code: 1008 });
  assert.equal(statuses.at(-1), "rejected");
  const count = sockets.length;
  t.mock.timers.tick(30000);
  assert.equal(sockets.length, count);
  cleanup();
  assert.equal(sockets.at(-1).closed, true);
  assert.equal(sockets.at(-1).onmessage, null);
  const cleanup2 = connectCitizen(
    "en",
    () => {},
    () => {},
  );
  assert.equal(sockets.at(-1).url.searchParams.get("lang"), "en");
  sockets.at(-1).onclose({ code: 1006 });
  cleanup2();
  const count2 = sockets.length;
  t.mock.timers.tick(20000);
  assert.equal(sockets.length, count2);
});

test("section K server backup presentation distinguishes cache, matrix and straight line", () => {
  assert.equal(routeNoticeKey({ offline: true }), "OFFLINE_BACKUP_ROUTE_MODE");
  assert.equal(routeNoticeKey({ offline: false }), null);
  assert.equal(routeNoticeKey(null), null);
  assert.equal(
    routeWarningKey({ fallbackMode: "cache" }),
    "backupCacheWarning",
  );
  assert.equal(
    routeWarningKey({ fallbackMode: "static_matrix" }),
    "backupMatrixWarning",
  );
  assert.equal(
    routeWarningKey({ fallbackMode: "straight_line" }),
    "fallbackWarning",
  );
  assert.equal(routeWarningKey({ source: "fallback" }), "fallbackWarning");
  assert.equal(
    new Set(["shelter", "park", "stadium"].map(shelterKindIcon)).size,
    3,
  );
});

test("actual i18next language changes translate judging UI, statuses and offline notice", async () => {
  const resources = Object.fromEntries(
    ["az", "en", "ru"].map((lang) => [
      lang,
      {
        translation: JSON.parse(
          fs.readFileSync(
            new URL(`../src/i18n/${lang}.json`, import.meta.url),
            "utf8",
          ),
        ),
      },
    ]),
  );
  const instance = i18next.createInstance();
  await instance.init({ resources, lng: "az", fallbackLng: "az" });
  const headings = new Set(),
    notices = new Set();
  const keys = [
    "mainTitle",
    "sendSOS",
    "safe",
    "specialNeeds",
    "accessibleRoute",
    "walk",
    "wheelchair_medical",
    "RAMP",
    "STEP_FREE",
    "MEDICAL_TRANSPORT_AVAILABLE",
    "prioritySOS",
    "activeSOS",
    "safeStatus",
    "ROAD_CLOSED",
    "SHELTER_NEARLY_FULL",
    "SHELTER_FULL",
    "SHELTER_NOT_ACCESSIBLE",
    "ROAD_NOT_ACCESSIBLE",
    "NO_ACCESSIBLE_ROUTE",
    "OFFLINE_BACKUP_ROUTE_MODE",
    "fallbackRoute",
    "backupCacheWarning",
    "backupMatrixWarning",
    "shelter",
    "park",
    "stadium",
    "NETWORK_ERROR",
    "connected",
    "rejected",
  ];
  for (const lang of ["az", "en", "ru"]) {
    await instance.changeLanguage(lang);
    assert.equal(instance.resolvedLanguage, lang);
    for (const key of keys)
      assert.notEqual(instance.t(key), key, `${lang}: missing ${key}`);
    assert.ok(!instance.t("rateLimitedSeconds", { count: 17 }).includes("{{"));
    headings.add(instance.t("mainTitle"));
    notices.add(instance.t("OFFLINE_BACKUP_ROUTE_MODE"));
  }
  assert.equal(headings.size, 3);
  assert.equal(notices.size, 3);
});

test("AZ / EN / RU dictionaries have matching nonempty keys and all literal UI translations", () => {
  const dictionaries = ["az", "en", "ru"].map((lang) =>
    JSON.parse(
      fs.readFileSync(
        new URL(`../src/i18n/${lang}.json`, import.meta.url),
        "utf8",
      ),
    ),
  );
  const keys = Object.keys(dictionaries[0]).sort();
  for (const dictionary of dictionaries) {
    assert.deepEqual(Object.keys(dictionary).sort(), keys);
    for (const value of Object.values(dictionary)) {
      assert.equal(typeof value, "string");
      assert.ok(value.length > 0);
      assert.ok(!value.includes("\ufffd"));
    }
  }
  for (const name of ["App.jsx", "ErrorBoundary.jsx"]) {
    const code = fs.readFileSync(
      new URL(`../src/${name}`, import.meta.url),
      "utf8",
    );
    for (const match of code.matchAll(/\bt\(["']([^"']+)["']/g))
      assert.ok(keys.includes(match[1]), `Missing translation ${match[1]}`);
  }
  assert.ok(dictionaries[1].specialNeeds.includes("accessible"));
  assert.ok(dictionaries[0].specialNeeds.includes("Əlçatan"));
  assert.ok(dictionaries[2].specialNeeds.includes("доступная"));
});
