let mode = "live";
const listeners = new Set();
export const getDevMode = () => mode;
export const subscribeDevMode = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
export function setDevMode(value) {
  if (!["live", "offline", "backup", "http503", "latency"].includes(value))
    return;
  mode = value;
  listeners.forEach((fn) => fn());
}
export async function simulateDevOutage(signal) {
  if (mode === "offline")
    throw Object.assign(new Error("NETWORK_ERROR"), { code: "NETWORK_ERROR" });
  if (mode === "http503")
    throw Object.assign(new Error("INTERNAL_ERROR"), {
      code: "INTERNAL_ERROR",
      status: 503,
    });
  if (mode === "latency")
    await new Promise((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 6000);
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
}
