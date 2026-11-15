
export const mockDistricts = {
  items: [
    {
      id: "nasimi",
      name: "Nəsimi",
      lat: 40.4093,
      lng: 49.8671,
    },
  ],
};

export const mockShelters = {
  items: [
    {
      id: "s1",
      name: "Heydər Əliyev Parkı",
      kind: "park",
      lat: 40.395,
      lng: 49.852,
      capacity: 2000,
      occupancy: 1500,
      occupancyPercent: 75.0,
      status: "filling",
    },
    {
      id: "s2",
      name: "Bakı Olimpiya Stadionu",
      kind: "stadium",
      lat: 40.4,
      lng: 49.9,
      capacity: 5000,
      occupancy: 2000,
      occupancyPercent: 40.0,
      status: "open",
    },
  ],
};

export const mockRoads = {
  items: [
    {
      id: "r1",
      name: "Neftçilər pr.",
      status: "closed",
      path: [
        [40.4, 49.85],
        [40.41, 49.86],
      ],
    },
  ],
};

export const mockRoute = {
  shelter: {
    id: "s2",
    name: "Bakı Olimpiya Stadionu",
    kind: "stadium",
    lat: 40.4,
    lng: 49.9,
    occupancyPercent: 40.0,
    status: "open",
  },

  route: {
    distanceMeters: 2400,
    durationSec: 540,
    path: [
      [40.41, 49.86],
      [40.405, 49.88],
      [40.4, 49.9],
    ],
  },

  alternatives: [
    {
      label: "Alternativ 1",
      distanceMeters: 3100,
      durationSec: 700,
      path: [
        [40.41, 49.86],
        [40.4, 49.9],
      ],
    },
  ],

  rerouted: true,
  reason: "SHELTER_NEARLY_FULL",
  requestedShelterId: "s1",
  source: "provider",
};
