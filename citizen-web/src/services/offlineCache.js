export const CACHE_KEY = "safebaku.offline-cache.v1";
export function haversine(lat, lng, point) {
  const rad = (x) => (x * Math.PI) / 180;
  const a =
    Math.sin(rad(point.lat - lat) / 2) ** 2 +
    Math.cos(rad(lat)) *
      Math.cos(rad(point.lat)) *
      Math.sin(rad(point.lng - lng) / 2) ** 2;
  return Math.round(6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
export function createOfflineCache(storage) {
  let memory = { version: 1, lists: {}, routes: [] };
  let dirty = false;
  const point = (value) =>
    Number.isFinite(value?.lat) &&
    Number.isFinite(value?.lng) &&
    Math.abs(value.lat) <= 90 &&
    Math.abs(value.lng) <= 180;
  const path = (value) =>
    Array.isArray(value) &&
    value.length >= 2 &&
    value.every(
      (pair) =>
        Array.isArray(pair) &&
        pair.length === 2 &&
        point({ lat: pair[0], lng: pair[1] }),
    );
  function load() {
    try {
      const saved = JSON.parse(storage?.getItem(CACHE_KEY) || "null");
      if (
        !dirty &&
        saved?.version === 1 &&
        saved.lists &&
        Array.isArray(saved.routes)
      )
        memory = {
          ...saved,
          routes: saved.routes.filter(
            (r) =>
              r?.context &&
              point(r.context) &&
              point(r.data?.shelter) &&
              path(r.data?.route?.path),
          ),
        };
    } catch {
      /* Cache corruption never prevents live operation. */
    }
    return memory;
  }
  function persist() {
    try {
      if (!storage) throw new Error("No storage");
      storage.setItem(CACHE_KEY, JSON.stringify(memory));
      dirty = false;
    } catch {
      dirty = true; /* In-memory backup remains available. */
    }
  }
  const list = (kind, lang) => {
    const lists = load().lists[kind] || {};
    const value =
      lists[lang] ||
      Object.values(lists).sort((a, b) => b.savedAt - a.savedAt)[0];
    if (!Array.isArray(value?.data?.items)) return null;
    const items = value.data.items.filter((item) =>
      kind === "roads" ? path(item?.path) : point(item),
    );
    return { items: structuredClone(items) };
  };
  function save(kind, data, context) {
    load();
    if (kind === "route") {
      if (
        !data?.shelter ||
        !Array.isArray(data.route?.path) ||
        data.route.path.length < 2
      )
        return;
      memory.routes = [
        { context, data: structuredClone(data), savedAt: Date.now() },
        ...memory.routes.filter(
          (r) => JSON.stringify(r.context) !== JSON.stringify(context),
        ),
      ].slice(0, 20);
    } else if (Array.isArray(data?.items)) {
      memory.lists[kind] = {
        ...memory.lists[kind],
        [context.lang]: { data: structuredClone(data), savedAt: Date.now() },
      };
    }
    persist();
  }
  function candidates(context) {
    const saved = list("shelters", context.lang);
    const shelters = saved
      ? saved.items
      : load().routes.map((r) => r.data.shelter);
    return shelters.filter(
      (s) =>
        Number.isFinite(s.lat) &&
        Number.isFinite(s.lng) &&
        !["full", "closed"].includes(s.status) &&
        (context.profile !== "special_needs" || s.accessible),
    );
  }
  function nearest(context) {
    const items = candidates(context)
      .map((s) => ({
        ...s,
        distanceMeters: haversine(context.lat, context.lng, s),
      }))
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, context.limit || 3);
    return items.length ? { items } : null;
  }
  function route(context) {
    const eligible = candidates(context).filter((s) => s.occupancyPercent < 90);
    const cached = load().routes.find(
      (r) =>
        r.context.profile === context.profile &&
        r.context.lat === context.lat &&
        r.context.lng === context.lng &&
        (!context.shelterId || r.context.shelterId === context.shelterId) &&
        eligible.some((s) => s.id === r.data.shelter.id),
    );
    if (cached)
      return {
        ...structuredClone(cached.data),
        shelter: eligible.find((s) => s.id === cached.data.shelter.id),
        offline: true,
        source: "fallback",
        fallbackMode: "client_cache",
        alternatives: [],
        notice: { code: "OFFLINE_BACKUP_ROUTE_MODE" },
        rerouted: false,
        reason: null,
      };
    const shelter = eligible.sort(
      (a, b) =>
        haversine(context.lat, context.lng, a) -
        haversine(context.lat, context.lng, b),
    )[0];
    if (!shelter) return null;
    const distance = haversine(context.lat, context.lng, shelter);
    return {
      shelter,
      route: {
        distanceMeters: distance,
        durationSec: Math.ceil(distance / 1.2),
        path: [
          [context.lat, context.lng],
          [shelter.lat, shelter.lng],
        ],
      },
      alternatives: [],
      source: "fallback",
      offline: true,
      fallbackMode: "straight_line",
      notice: { code: "OFFLINE_BACKUP_ROUTE_MODE" },
      requestedShelterId: context.shelterId || shelter.id,
      rerouted: false,
      reason: null,
      accessible: false,
      transport:
        context.profile === "special_needs" ? "wheelchair_medical" : "walk",
      accessibilityNotes: [],
    };
  }
  function update(kind, item, lang) {
    const data = list(kind, lang);
    if (data)
      save(
        kind,
        {
          items: data.items.some((s) => s.id === item.id)
            ? data.items.map((s) => (s.id === item.id ? item : s))
            : [...data.items, item],
        },
        { lang },
      );
  }
  return { save, list, nearest, route, update };
}
