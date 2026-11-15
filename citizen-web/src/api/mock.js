// Contract-shaped demo data; real mode never uses these fixtures.
export const mockDistricts = {
  items: [{ id: "nasimi", name: "Nəsimi", lat: 40.4093, lng: 49.8671 }],
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
      occupancyPercent: 75,
      status: "filling",
      accessible: true,
    },
    {
      id: "s2",
      name: "Bakı Olimpiya Stadionu",
      kind: "stadium",
      lat: 40.4,
      lng: 49.9,
      capacity: 5000,
      occupancy: 2000,
      occupancyPercent: 40,
      status: "open",
      accessible: true,
    },
    {
      id: "s3",
      name: "Mərkəzi park",
      kind: "park",
      lat: 40.414,
      lng: 49.865,
      capacity: 1000,
      occupancy: 930,
      occupancyPercent: 93,
      status: "near_full",
      accessible: false,
    },
    {
      id: "s10",
      name: "Toplanış nöqtəsi",
      kind: "shelter",
      lat: 40.42,
      lng: 49.85,
      capacity: 100,
      occupancy: 100,
      occupancyPercent: 100,
      status: "full",
      accessible: false,
    },
    {
      id: "s12",
      name: "Ehtiyat toplanış nöqtəsi",
      kind: "shelter",
      lat: 40.43,
      lng: 49.89,
      capacity: 500,
      occupancy: 0,
      occupancyPercent: 0,
      status: "closed",
      accessible: true,
    },
  ],
};
export const mockRoads = {
  items: [
    {
      id: "r1",
      name: "Neftçilər pr.",
      status: "closed",
      accessible: true,
      path: [
        [40.4, 49.85],
        [40.41, 49.86],
      ],
    },
  ],
};
const names = {
  en: {
    nasimi: "Nasimi",
    s1: "Heydar Aliyev Park",
    s2: "Baku Olympic Stadium",
    s3: "Central Park",
    s10: "Assembly Point",
    s12: "Reserve Assembly Point",
    r1: "Neftchilar Ave.",
  },
  ru: {
    nasimi: "Насими",
    s1: "Парк Гейдара Алиева",
    s2: "Бакинский олимпийский стадион",
    s3: "Центральный парк",
    s10: "Пункт сбора",
    s12: "Резервный пункт сбора",
    r1: "Проспект Нефтчиляр",
  },
};
export function localizeMock(item, lang) {
  return {
    ...structuredClone(item),
    name: names[lang]?.[item.id] || item.name,
  };
}

export function mockOfflineNotice(lang) {
  return {
    code: "OFFLINE_BACKUP_ROUTE_MODE",
    message:
      {
        az: "Oflayn / Ehtiyat marşrut rejimində işləyir",
        en: "Offline / backup route mode is active",
        ru: "Работает офлайн / в режиме резервных маршрутов",
      }[lang] || "Oflayn / Ehtiyat marşrut rejimində işləyir",
  };
}
