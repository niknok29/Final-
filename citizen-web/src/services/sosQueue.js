export const SOS_COOLDOWN_MS = 10000;
export const SOS_MAX_ATTEMPTS = 3;
export const SOS_QUEUE_KEY = "safebaku.sos-queue.v1";
export function sosDisplayStatus(snapshot) {
  const safeAt = snapshot.lastSafeAt || 0;
  const delivered = snapshot.records
    .filter((r) => r.status === "sent" && r.deliveredAt > safeAt)
    .sort((a, b) => b.deliveredAt - a.deliveredAt)[0];
  if (delivered) return delivered.payload.profile;
  if (
    safeAt &&
    !snapshot.records.some(
      (r) => r.createdAt > safeAt && r.status !== "cancelled",
    )
  )
    return "safe";
  return null;
}

// Queue IDs are local bookkeeping, never undocumented backend request fields.
export function createSosQueue({
  send,
  storage,
  now = Date.now,
  uuid = () => crypto.randomUUID(),
  isOnline = () => globalThis.navigator?.onLine !== false,
  lock,
} = {}) {
  let snapshot = {
    records: [],
    cooldownUntil: 0,
    retryNotBefore: 0,
    lastSafeAt: 0,
    storageError: false,
  };
  let busy = false;
  let corrupt = false;
  let dirty = false;
  const listeners = new Set();
  function read() {
    try {
      const raw = storage?.getItem(SOS_QUEUE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (
        saved.version !== 1 ||
        !Array.isArray(saved.records) ||
        saved.records.some(
          (r) =>
            !r.id ||
            !r.payload ||
            !Number.isInteger(r.attempts) ||
            r.attempts < 0 ||
            r.attempts > SOS_MAX_ATTEMPTS,
        )
      )
        throw new Error("Invalid queue");
      const records = dirty
        ? [
            ...saved.records.filter(
              (r) => !snapshot.records.some((local) => local.id === r.id),
            ),
            ...snapshot.records,
          ]
        : saved.records;
      snapshot = {
        ...snapshot,
        records,
        cooldownUntil: Math.max(
          snapshot.cooldownUntil,
          saved.cooldownUntil || 0,
        ),
        retryNotBefore: Math.max(
          snapshot.retryNotBefore,
          saved.retryNotBefore || 0,
        ),
        lastSafeAt: Math.max(snapshot.lastSafeAt, saved.lastSafeAt || 0),
      };
    } catch {
      corrupt = true;
      snapshot = { ...snapshot, storageError: true };
    }
  }
  read();
  function publish() {
    try {
      if (!storage || corrupt) throw new Error("Storage unavailable");
      storage.setItem(
        SOS_QUEUE_KEY,
        JSON.stringify({
          version: 1,
          records: snapshot.records,
          cooldownUntil: snapshot.cooldownUntil,
          retryNotBefore: snapshot.retryNotBefore,
          lastSafeAt: snapshot.lastSafeAt,
        }),
      );
      dirty = false;
      snapshot = { ...snapshot, storageError: false };
    } catch {
      dirty = true;
      snapshot = { ...snapshot, storageError: true };
    }
    listeners.forEach((fn) => fn());
  }
  async function exclusive(fn) {
    if (busy) return null;
    busy = true;
    try {
      const run = async () => {
        read();
        return fn();
      };
      return lock ? await lock(run) : await run();
    } finally {
      busy = false;
    }
  }
  async function enqueue(payload) {
    return exclusive(() => {
      const existing = snapshot.records.find(
        (r) =>
          ["pending", "sending"].includes(r.status) &&
          JSON.stringify(r.payload) === JSON.stringify(payload),
      );
      if (existing) return existing;
      if (now() < snapshot.cooldownUntil) return null;
      const record = {
        id: uuid(),
        payload: structuredClone(payload),
        status: "pending",
        attempts: 0,
        createdAt: now(),
        nextAttemptAt: now(),
        errorCode: null,
      };
      snapshot = {
        ...snapshot,
        records: [...snapshot.records, record],
        cooldownUntil: now() + SOS_COOLDOWN_MS,
      };
      publish();
      return record;
    });
  }
  async function process() {
    return exclusive(async () => {
      // An interrupted send counts as an attempt; never reset the budget on reload.
      snapshot = {
        ...snapshot,
        records: snapshot.records.map((r) =>
          r.status === "sending"
            ? {
                ...r,
                status:
                  r.attempts >= SOS_MAX_ATTEMPTS ? "exhausted" : "pending",
              }
            : r,
        ),
      };
      const record = snapshot.records.find(
        (r) =>
          r.status === "pending" &&
          r.attempts < SOS_MAX_ATTEMPTS &&
          r.nextAttemptAt <= now(),
      );
      if (!record || !isOnline() || now() < snapshot.retryNotBefore) {
        publish();
        return;
      }
      record.status = "sending";
      record.attempts++;
      record.lastAttemptAt = now();
      snapshot = {
        ...snapshot,
        cooldownUntil: Math.max(
          snapshot.cooldownUntil,
          now() + SOS_COOLDOWN_MS,
        ),
      };
      publish(); // Persist the attempt BEFORE transmitting.
      try {
        const result = await send(structuredClone(record.payload));
        record.status = "sent";
        record.duplicate = result?.duplicate === true;
        record.response = result;
        record.deliveredAt = now();
        record.errorCode = null;
      } catch (error) {
        record.errorCode = error.code || "NETWORK_ERROR";
        const retryable =
          !error.status || error.status === 429 || error.status >= 500;
        record.status = !retryable
          ? "failed"
          : record.attempts >= SOS_MAX_ATTEMPTS
            ? "exhausted"
            : "pending";
        record.nextAttemptAt =
          now() +
          Math.max(
            SOS_COOLDOWN_MS,
            error.status === 429
              ? Math.max(1, error.retryAfter || 60) * 1000
              : 0,
          );
        if (error.status === 429) {
          snapshot.cooldownUntil = Math.max(
            snapshot.cooldownUntil,
            record.nextAttemptAt,
          );
          snapshot.retryNotBefore = record.nextAttemptAt;
        }
      }
      snapshot = { ...snapshot, records: [...snapshot.records] };
      publish();
      return record;
    });
  }
  async function markSafe(action, citizenId) {
    return exclusive(async () => {
      const result = await action();
      snapshot = {
        ...snapshot,
        lastSafeAt: now(),
        records: snapshot.records.map((r) =>
          r.payload.citizenId === citizenId &&
          ["pending", "sending"].includes(r.status)
            ? { ...r, status: "cancelled" }
            : r,
        ),
      };
      publish();
      return result;
    });
  }
  return {
    enqueue,
    process,
    markSafe,
    getSnapshot: () => snapshot,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
