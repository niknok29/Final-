import {
  mockDistricts,
  mockShelters,
  mockRoads,
  localizeMock,
  mockOfflineNotice,
} from "./mock.js";
import { createOfflineCache } from "../services/offlineCache.js";
import { getDevMode, simulateDevOutage } from "./devOutage.js";

const env = import.meta.env || {};
export const USE_MOCK = env.VITE_USE_MOCK === "true";
const API_URL = env.VITE_API_URL || "http://localhost:8000";
export const REQUEST_TIMEOUT_MS = 5000;
const failures = new Set();
const connectionListeners = new Set();
export const getClientOffline = () => failures.size > 0;
export const subscribeClientOffline = (fn) => {
  connectionListeners.add(fn);
  return () => connectionListeners.delete(fn);
};
function connection(kind, failed) {
  const before = failures.size > 0;
  if (failed) failures.add(kind);
  else failures.delete(kind);
  if (before !== failures.size > 0) connectionListeners.forEach((fn) => fn());
}
let localCache;
function cache() {
  if (!localCache) {
    let storage;
    try {
      storage = localStorage;
    } catch {
      /* Use memory only. */
    }
    localCache = createOfflineCache(storage);
  }
  return localCache;
}
export const getCachedSnapshot = (lang) =>
  Object.fromEntries(
    ["districts", "shelters", "roads"].map((kind) => [
      kind,
      cache().list(kind, lang)?.items || [],
    ]),
  );
export const getCachedRoute = (context) => cache().route(context);
export const getCachedNearest = (context) => cache().nearest(context);
export const rememberLiveUpdate = (kind, item, lang) =>
  cache().update(kind, item, lang);
export const rememberRoute = (data, context) =>
  cache().save("route", data, context);
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let memoryId;
export function getCitizenId() {
  if (memoryId) return memoryId;
  try {
    memoryId = localStorage.getItem("citizenId");
  } catch {
    /* Private browsing */
  }
  if (!UUID.test(memoryId || "")) memoryId = crypto.randomUUID();
  try {
    localStorage.setItem("citizenId", memoryId);
  } catch {
    /* Use session identity */
  }
  return memoryId;
}
export class ApiError extends Error {
  constructor(code, status = 0, retryAfter = 0) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export function retrySeconds(value, now = Date.now()) {
  if (!value) return 60;
  const seconds = Number(value);
  return Math.max(
    1,
    Math.ceil(
      Number.isFinite(seconds) ? seconds : (Date.parse(value) - now) / 1000,
    ) || 60,
  );
}
export async function withDeadline(operation, signal) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () =>
    controller.abort(
      signal.reason || new DOMException("Cancelled", "AbortError"),
    );
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new DOMException("Timed out", "TimeoutError"));
  }, REQUEST_TIMEOUT_MS);
  let rejectAbort;
  const cancelled = new Promise((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason);
    if (controller.signal.aborted) rejectAbort();
    else
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => operation(controller.signal)),
      cancelled,
    ]);
  } catch (error) {
    if (signal?.aborted)
      throw signal.reason || new DOMException("Cancelled", "AbortError");
    if (timedOut) throw new ApiError("TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", rejectAbort);
  }
}
export async function request(
  endpoint,
  { lang = "az", params = {}, body, signal } = {},
) {
  return withDeadline(async (requestSignal) => {
    const url = new URL(endpoint, API_URL);
    if (!body) url.searchParams.set("lang", lang);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    let response;
    try {
      if (env.DEV) await simulateDevOutage(requestSignal);
      response = await fetch(url, {
        signal: requestSignal,
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      if (requestSignal.aborted) throw requestSignal.reason;
      if (error.name === "AbortError") throw error;
      if (error.code || error.status) throw error;
      throw new ApiError("NETWORK_ERROR");
    }
    const data = await response.json().catch(() => null);
    if (response.status < 500) connection("transport", false);
    if (endpoint === "/api/sos" && data?.duplicate === true) return data;
    if (!response.ok)
      throw new ApiError(
        data?.error?.code || "ERROR",
        response.status,
        response.status === 429
          ? retrySeconds(response.headers.get("Retry-After"))
          : 0,
      );
    if (!data) throw new ApiError("ERROR", response.status);
    connection("transport", false);
    if (env.DEV && getDevMode() === "backup" && endpoint === "/api/route")
      return {
        ...data,
        offline: true,
        source: "fallback",
        fallbackMode: "cache",
        notice: mockOfflineNotice(lang),
        alternatives: [],
      };
    return data;
  }, signal).catch((error) => {
    if (
      !signal?.aborted &&
      (error.status >= 500 || ["NETWORK_ERROR", "TIMEOUT"].includes(error.code))
    )
      connection("transport", true);
    throw error;
  });
}
async function mockOperation(operation, signal) {
  return withDeadline(async (requestSignal) => {
    if (env.DEV) await simulateDevOutage(requestSignal);
    return operation();
  }, signal);
}
async function readWithBackup(kind, context, operation) {
  try {
    const result = USE_MOCK
      ? await mockOperation(operation, context.signal)
      : await operation();
    if (kind !== "nearest")
      cache().save(kind, result, { ...context, signal: undefined });
    connection(kind, false);
    return result;
  } catch (error) {
    if (context.signal?.aborted || error.name === "AbortError") throw error;
    if (error.status && error.status < 500) {
      connection(kind, false);
      throw error;
    }
    if (!error.status && !["NETWORK_ERROR", "TIMEOUT"].includes(error.code))
      throw error;
    connection(kind, true);
    const result =
      kind === "route"
        ? cache().route(context)
        : kind === "nearest"
          ? cache().nearest(context)
          : cache().list(kind, context.lang);
    if (result) return result;
    throw error;
  }
}
const clone = (data) => structuredClone(data);
export const api = {
  getDistricts: (lang = "az", signal) =>
    readWithBackup("districts", { lang, signal }, () =>
      USE_MOCK
        ? Promise.resolve({
            items: mockDistricts.items.map((s) => localizeMock(s, lang)),
          })
        : request("/api/districts", { lang, signal }),
    ),
  getShelters: (lang = "az", signal) =>
    readWithBackup("shelters", { lang, signal }, () =>
      USE_MOCK
        ? Promise.resolve({
            items: mockShelters.items.map((s) => localizeMock(s, lang)),
          })
        : request("/api/shelters", { lang, signal }),
    ),
  getRoads: (lang = "az", signal) =>
    readWithBackup("roads", { lang, signal }, () =>
      USE_MOCK
        ? Promise.resolve({
            items: mockRoads.items.map((s) => localizeMock(s, lang)),
          })
        : request("/api/roads", { lang, signal }),
    ),
};
export function distanceMeters(lat, lng, shelter) {
  const rad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(shelter.lat - lat) / 2) ** 2 +
    Math.cos(rad(lat)) *
      Math.cos(rad(shelter.lat)) *
      Math.sin(rad(shelter.lng - lng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
async function fetchNearestShelters(lat, lng, limit = 3, lang = "az", signal) {
  if (USE_MOCK) {
    const available = mockShelters.items.filter(
      (s) => !["full", "closed"].includes(s.status),
    );
    return {
      items: (available.length ? available : mockShelters.items)
        .map((s) => ({
          ...localizeMock(s, lang),
          distanceMeters: distanceMeters(lat, lng, s),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, limit),
    };
  }
  return request("/api/shelters/nearest", {
    lang,
    signal,
    params: { lat, lng, limit },
  });
}
let mockTarget;
export function getNearestShelters(lat, lng, limit = 3, lang = "az", signal) {
  return readWithBackup("nearest", { lat, lng, limit, lang, signal }, () =>
    fetchNearestShelters(lat, lng, limit, lang, signal),
  );
}
export function getRoute(
  lat,
  lng,
  shelterId,
  lang = "az",
  profile = "standard",
  signal,
) {
  return readWithBackup(
    "route",
    { lat, lng, shelterId, lang, profile, signal },
    () => fetchRoute(lat, lng, shelterId, lang, profile, signal),
  );
}
async function fetchRoute(
  lat,
  lng,
  shelterId,
  lang = "az",
  profile = "standard",
  signal,
) {
  if (USE_MOCK) {
    const requested = mockShelters.items.find((s) => s.id === shelterId);
    if (!requested) throw new ApiError("SHELTER_NOT_FOUND", 404);
    const eligible = (s) =>
      s.occupancyPercent < 90 &&
      s.status !== "closed" &&
      (profile !== "special_needs" || s.accessible);
    const shelter = eligible(requested)
      ? requested
      : mockShelters.items.find(eligible);
    if (!shelter) throw new ApiError("NO_ACCESSIBLE_ROUTE", 409);
    const distance = distanceMeters(lat, lng, shelter);
    mockTarget = {
      shelter: localizeMock(shelter, lang),
      route: {
        distanceMeters: distance,
        durationSec: Math.ceil(distance / 1.2),
        path: [
          [lat, lng],
          [shelter.lat, shelter.lng],
        ],
      },
      alternatives: [],
      rerouted: shelter.id !== shelterId,
      reason:
        shelter.id === shelterId
          ? null
          : profile === "special_needs" && !requested.accessible
            ? "SHELTER_NOT_ACCESSIBLE"
            : "SHELTER_NEARLY_FULL",
      requestedShelterId: shelterId,
      source: "fallback",
      offline: true,
      fallbackMode: "straight_line",
      notice: mockOfflineNotice(lang),
      accessible: shelter.accessible,
      transport: profile === "special_needs" ? "wheelchair_medical" : "walk",
      accessibilityNotes:
        profile === "special_needs"
          ? ["RAMP", "STEP_FREE", "MEDICAL_TRANSPORT_AVAILABLE"]
          : [],
    };
    return clone(mockTarget);
  }
  return request("/api/route", {
    lang,
    signal,
    params: {
      fromLat: lat,
      fromLng: lng,
      shelterId,
      citizenId: getCitizenId(),
      profile,
    },
  });
}
export async function sendSOS(type, lat, lng, note = "", profile = "standard") {
  if (
    !["fire", "collapse", "flood", "medical"].includes(type) ||
    note.length > 200
  )
    throw new ApiError("VALIDATION_ERROR", 422);
  const body = { citizenId: getCitizenId(), type, lat, lng, note, profile };
  return submitSOSPayload(body);
}
export async function submitSOSPayload(body) {
  return USE_MOCK
    ? mockOperation(() => ({
        id: `sos_${Date.now()}`,
        status: "active",
        createdAt: new Date().toISOString(),
      }))
    : request("/api/sos", { body });
}
export async function markSafe(lat, lng) {
  const body = { citizenId: getCitizenId(), lat, lng };
  return USE_MOCK
    ? mockOperation(() => ({
        citizenId: body.citizenId,
        status: "safe",
        updatedAt: new Date().toISOString(),
      }))
    : request("/api/safe", { body });
}
export function connectCitizen(
  lang,
  onEvent,
  onStatus,
  onReconnect = () => {},
) {
  let stopped = false,
    socket,
    timer,
    attempt = 0,
    opened = false;
  if (USE_MOCK) {
    onStatus("connected");
    let tick = 0;
    timer = setInterval(() => {
      tick++;
      const shelter = mockShelters.items[0];
      shelter.occupancyPercent =
        shelter.occupancyPercent >= 95 ? 40 : shelter.occupancyPercent + 5;
      shelter.status =
        shelter.occupancyPercent >= 90
          ? "near_full"
          : shelter.occupancyPercent >= 75
            ? "filling"
            : "open";
      shelter.occupancy = Math.round(
        shelter.capacity * (shelter.occupancyPercent / 100),
      );
      onEvent({ type: "shelter.updated", data: localizeMock(shelter, lang) });
      mockRoads.items[0].status = tick % 2 ? "closed" : "open";
      onEvent({
        type: "road.updated",
        data: localizeMock(mockRoads.items[0], lang),
      });
      if (mockTarget && tick % 3 === 0)
        onEvent({
          type: "reroute",
          data: {
            ...clone(mockTarget),
            rerouted: true,
            reason: "ROAD_CLOSED",
            message: "ROUTE_CHANGED",
          },
        });
    }, 5000);
    return () => clearInterval(timer);
  }
  function connect() {
    if (stopped) return;
    onStatus(attempt ? "reconnecting" : "connecting");
    const url = new URL("/ws/citizen", API_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("citizenId", getCitizenId());
    url.searchParams.set("lang", lang);
    socket = new WebSocket(url);
    socket.onopen = () => {
      attempt = 0;
      onStatus("connected");
      if (opened) onReconnect();
      opened = true;
    };
    socket.onmessage = (event) => {
      if (stopped) return;
      try {
        onEvent(JSON.parse(event.data));
      } catch {
        /* Ignore malformed frames */
      }
    };
    socket.onerror = () => {
      /* onclose owns retry scheduling */
    };
    socket.onclose = (event) => {
      if (stopped) return;
      if (event.code === 1008) {
        onStatus("rejected");
        return;
      }
      onStatus("reconnecting");
      timer = setTimeout(connect, Math.min(1000 * 2 ** attempt++, 10000));
    };
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(timer);
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
  };
}
