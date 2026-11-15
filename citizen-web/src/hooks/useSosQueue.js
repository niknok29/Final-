import { useEffect, useEffectEvent, useState } from "react";
import { getCitizenId, submitSOSPayload } from "../api/client";
import { createSosQueue, SOS_QUEUE_KEY } from "../services/sosQueue";

let queue;
function getQueue() {
  if (!queue) {
    let storage;
    try {
      storage = localStorage;
    } catch {
      /* Surface storage failure in the UI. */
    }
    const lock = async (run) => {
      if (navigator.locks)
        return navigator.locks.request("safebaku-sos-queue", run);
      // Best-effort cross-tab lease for browsers without Web Locks.
      const owner = crypto.randomUUID(),
        key = "safebaku.sos-lease";
      try {
        const lease = JSON.parse(storage?.getItem(key) || "null");
        if (lease?.until > Date.now()) return null;
        storage?.setItem(
          key,
          JSON.stringify({ owner, until: Date.now() + 15000 }),
        );
      } catch {
        /* In-memory queue remains available. */
      }
      const heartbeat = setInterval(() => {
        try {
          storage?.setItem(
            key,
            JSON.stringify({ owner, until: Date.now() + 15000 }),
          );
        } catch {
          /* UI shows persistence error. */
        }
      }, 3000);
      try {
        return await run();
      } finally {
        clearInterval(heartbeat);
        try {
          if (JSON.parse(storage?.getItem(key) || "null")?.owner === owner)
            storage.removeItem(key);
        } catch {
          /* Optional lease storage */
        }
      }
    };
    queue = createSosQueue({ storage, send: submitSOSPayload, lock });
  }
  return queue;
}
export default function useSosQueue(onDelivered) {
  const service = getQueue();
  const [state, setState] = useState(service.getSnapshot);
  const [seen] = useState(
    () =>
      new Set(
        state.records.filter((r) => r.status === "sent").map((r) => r.id),
      ),
  );
  const delivered = useEffectEvent(onDelivered);
  useEffect(() => {
    const update = () => {
      const next = service.getSnapshot();
      setState(next);
      for (const record of next.records)
        if (record.status === "sent" && !seen.has(record.id)) {
          seen.add(record.id);
          delivered(record);
        }
    };
    const unsubscribe = service.subscribe(update);
    const process = () => {
      void service.process();
    };
    const onStorage = (event) => {
      if (event.key === SOS_QUEUE_KEY) process();
    };
    process();
    const timer = setInterval(process, 10000);
    window.addEventListener("online", process);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener("online", process);
      window.removeEventListener("storage", onStorage);
    };
  }, [service, seen]);
  return {
    ...state,
    sending: state.records.some((r) => r.status === "sending"),
    submit: async (payload) => {
      const record = await service.enqueue({
        citizenId: getCitizenId(),
        ...payload,
      });
      if (record) await service.process();
      return record
        ? service.getSnapshot().records.find((r) => r.id === record.id)
        : null;
    },
    markSafe: async (action) => {
      const result = await service.markSafe(action, getCitizenId());
      if (!result) throw new Error("SOS_BUSY");
      return result;
    },
  };
}
