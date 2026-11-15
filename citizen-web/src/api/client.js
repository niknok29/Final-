
import {
  mockDistricts,
  mockShelters,
  mockRoads,
  mockRoute,
} from "./mock";

const API_URL = import.meta.env.VITE_API_URL;
const USE_MOCK = import.meta.env.VITE_USE_MOCK === "true";

async function apiGet(endpoint, mockData, lang = "az") {
  if (USE_MOCK) {
    return structuredClone(mockData);
  }

  const url = new URL(`${API_URL}${endpoint}`);
  url.searchParams.set("lang", lang);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export const api = {
  getDistricts: (lang = "az") =>
    apiGet("/api/districts", mockDistricts, lang),

  getShelters: (lang = "az") =>
    apiGet("/api/shelters", mockShelters, lang),

  getRoads: (lang = "az") =>
    apiGet("/api/roads", mockRoads, lang),

  // Bu funksiya növbəti addımda koordinatlarla tamamlanacaq.
  getRouteMock: () =>
    structuredClone(mockRoute),
};

export async function getNearestShelters(
  lat,
  lng,
  limit = 3,
  lang = "az"
) {
  if (USE_MOCK) {
    const toRadians = (value) => (value * Math.PI) / 180;

    const distanceMeters = (shelter) => {
      const earthRadius = 6371000;

      const dLat = toRadians(shelter.lat - lat);
      const dLng = toRadians(shelter.lng - lng);

      const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRadians(lat)) *
          Math.cos(toRadians(shelter.lat)) *
          Math.sin(dLng / 2) ** 2;

      return (
        2 *
        earthRadius *
        Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      );
    };

    const available = mockShelters.items.filter(
      (shelter) =>
        shelter.status !== "full" &&
        shelter.status !== "closed"
    );

    const candidates =
      available.length > 0 ? available : mockShelters.items;

    return {
      items: candidates
        .map((shelter) => ({
          ...shelter,
          distanceMeters: Math.round(distanceMeters(shelter)),
        }))
        .sort((a, b) => a.distanceMeters - b.distanceMeters)
        .slice(0, limit),
    };
  }

  const url = new URL(`${API_URL}/api/shelters/nearest`);

  url.searchParams.set("lat", lat);
  url.searchParams.set("lng", lng);
  url.searchParams.set("limit", limit);
  url.searchParams.set("lang", lang);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export async function getRoute(
  lat,
  lng,
  shelterId,
  lang = "az"
) {
  if (USE_MOCK) {
    return structuredClone(mockRoute);
  }

  const url = new URL(`${API_URL}/api/route`);

  url.searchParams.set("fromLat", lat);
  url.searchParams.set("fromLng", lng);
  url.searchParams.set("shelterId", shelterId);
  url.searchParams.set("lang", lang);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}


function getCitizenId() {
  let citizenId = localStorage.getItem("citizenId");

  if (!citizenId) {
    citizenId = crypto.randomUUID();
    localStorage.setItem("citizenId", citizenId);
  }

  return citizenId;
}

export async function sendSOS(type, lat, lng, note = "") {
  const validTypes = ["fire", "collapse", "flood", "medical"];

  if (!validTypes.includes(type)) {
    throw new Error("INVALID_HAZARD_TYPE");
  }

  if (note.length > 200) {
    throw new Error("NOTE_TOO_LONG");
  }

  const payload = {
    citizenId: getCitizenId(),
    type,
    lat,
    lng,
    note,
  };

  if (USE_MOCK) {
    return {
      id: `sos_${Date.now()}`,
      status: "active",
      createdAt: new Date().toISOString(),
    };
  }

  const response = await fetch(`${API_URL}/api/sos`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("RATE_LIMITED");
    }

    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}


export async function markSafe(lat, lng) {
  const payload = {
    citizenId: getCitizenId(),
  };

  if (
    typeof lat === "number" &&
    typeof lng === "number"
  ) {
    payload.lat = lat;
    payload.lng = lng;
  }

  if (USE_MOCK) {
    return {
      citizenId: payload.citizenId,
      status: "safe",
      updatedAt: new Date().toISOString(),
    };
  }

  const response = await fetch(`${API_URL}/api/safe`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error("RATE_LIMITED");
    }

    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
