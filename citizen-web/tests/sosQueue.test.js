import test from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "../src/api/client.js";
import {
  createSosQueue,
  SOS_COOLDOWN_MS,
  SOS_QUEUE_KEY,
} from "../src/services/sosQueue.js";
const payload = {
  citizenId: "8eafc601-13d0-4f14-bd9c-400d052970a1",
  type: "medical",
  lat: 40.41,
  lng: 49.86,
  note: "Help",
  profile: "special_needs",
};
function fixture(send) {
  const entries = new Map();
  const storage = {
    getItem: (key) => entries.get(key) || null,
    setItem: (key, value) => entries.set(key, value),
  };
  let clock = 1000,
    seq = 0;
  const options = {
    send,
    storage,
    now: () => clock,
    uuid: () => `local-${++seq}`,
    isOnline: () => true,
  };
  return {
    options,
    create: () => createSosQueue(options),
    advance: (ms) => {
      clock += ms;
    },
    entries,
  };
}
test("10-second cooldown is persisted; duplicate:true confirms success", async () => {
  const f = fixture(async () => ({ duplicate: true }));
  const q = f.create();
  await q.enqueue(payload);
  await q.process();
  assert.equal(SOS_COOLDOWN_MS, 10000);
  assert.equal(q.getSnapshot().cooldownUntil, 11000);
  assert.equal(q.getSnapshot().records[0].status, "sent");
  assert.equal(q.getSnapshot().records[0].duplicate, true);
  assert.equal(await f.create().enqueue({ ...payload, type: "fire" }), null);
  f.advance(10000);
  assert.ok(await f.create().enqueue({ ...payload, type: "fire" }));
});
for (const code of [
  "RATE_LIMITED",
  "CITIZEN_RATE_LIMITED",
  "SOS_FLOOD_THROTTLED",
]) {
  test(`${code}: persistent Retry-After deadline, same payload, at most three actual attempts`, async () => {
    const sent = [];
    const f = fixture(async (body) => {
      sent.push(body);
      throw new ApiError(code, 429, 23);
    });
    let q = f.create();
    const record = await q.enqueue(payload);
    await q.process();
    assert.equal(q.getSnapshot().records[0].errorCode, code);
    assert.equal(q.getSnapshot().records[0].nextAttemptAt, 24000);
    f.advance(22000);
    await q.process();
    assert.equal(sent.length, 1);
    f.advance(1000);
    q = f.create();
    await q.process();
    assert.equal(sent.length, 2);
    f.advance(23000);
    q = f.create();
    await q.process();
    assert.equal(sent.length, 3);
    assert.equal(q.getSnapshot().records[0].status, "exhausted");
    f.advance(60000);
    await f.create().process();
    assert.equal(sent.length, 3);
    assert.equal(q.getSnapshot().records[0].id, record.id);
    for (const body of sent) assert.deepEqual(body, payload);
    assert.equal(
      JSON.parse(f.entries.get(SOS_QUEUE_KEY)).records[0].attempts,
      3,
    );
  });
}
test("offline waiting does not consume attempts; reload preserves pending SOS", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls++;
    return { id: "sos-1" };
  });
  f.options.isOnline = () => false;
  await f.create().enqueue(payload);
  const q = f.create();
  await q.process();
  assert.equal(calls, 0);
  assert.equal(q.getSnapshot().records[0].attempts, 0);
  f.options.isOnline = () => true;
  await f.create().process();
  assert.equal(calls, 1);
});
test("concurrent submissions coalesce and attempts are persisted before transmission", async () => {
  let release,
    calls = 0;
  const f = fixture(async () => {
    calls++;
    assert.equal(
      JSON.parse(f.entries.get(SOS_QUEUE_KEY)).records[0].attempts,
      1,
    );
    await new Promise((resolve) => {
      release = resolve;
    });
    return { id: "sos-2" };
  });
  const q = f.create();
  await q.enqueue(payload);
  const task = q.process();
  await q.process();
  await q.enqueue(payload);
  assert.equal(calls, 1);
  release();
  await task;
  assert.equal(q.getSnapshot().records.length, 1);
});
test("permanent failures remain visible; successful safe action cancels pending sends", async () => {
  const f = fixture(async () => {
    throw new ApiError("VALIDATION_ERROR", 422);
  });
  const q = f.create();
  await q.enqueue(payload);
  await q.process();
  assert.equal(q.getSnapshot().records[0].status, "failed");
  f.advance(10000);
  await q.enqueue({ ...payload, type: "fire" });
  await q.markSafe(async () => ({ status: "safe" }), payload.citizenId);
  assert.equal(q.getSnapshot().records[1].status, "cancelled");
  assert.equal(q.getSnapshot().records[0].status, "failed");
});
test("storage write failure preserves in-memory records and is surfaced", async () => {
  const q = createSosQueue({
    send: async () => {
      throw new ApiError("NETWORK_ERROR");
    },
    storage: {
      getItem: () => null,
      setItem: () => {
        throw Error("quota");
      },
    },
    isOnline: () => false,
  });
  await q.enqueue(payload);
  await q.process();
  assert.equal(q.getSnapshot().records.length, 1);
  assert.equal(q.getSnapshot().storageError, true);
});
