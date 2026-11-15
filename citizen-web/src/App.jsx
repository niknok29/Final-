
import { useEffect, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./App.css";

import { api, getNearestShelters, getRoute, sendSOS, markSafe } from "./api/client";

const BAKU = [40.4093, 49.8671];

const markerIcon = new L.Icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

function MapClick({ onSelect }) {
  useMapEvents({
    click(e) {
      onSelect([e.latlng.lat, e.latlng.lng]);
    },
  });
  return null;
}

function MapNavigation({ position, route }) {
  const map = useMap();

  useEffect(() => {
    if (route?.length > 1) {
      map.fitBounds(route, { padding: [40, 40] });
    } else {
      map.setView(position, 13);
    }
  }, [map, position, route]);

  return null;
}

const hazards = [
  { type: "fire", name: "🔥 Yanğın" },
  { type: "collapse", name: "🏚️ Dağıntı" },
  { type: "flood", name: "🌊 Su basması" },
  { type: "medical", name: "🚑 Tibbi yardım" },
];

export default function App() {
  const [position, setPosition] = useState(BAKU);
  const [districts, setDistricts] = useState([]);
  const [shelters, setShelters] = useState([]);
  const [nearest, setNearest] = useState([]);
  const [roads, setRoads] = useState([]);
  const [selected, setSelected] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sosOpen, setSosOpen] = useState(false);
  const [hazard, setHazard] = useState("fire");
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(false);
  const [activeSOS, setActiveSOS] = useState(false);
  const [safe, setSafe] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([
      api.getDistricts(),
      api.getShelters(),
      api.getRoads(),
    ])
      .then(([d, s, r]) => {
        setDistricts(d.items);
        setShelters(s.items);
        setRoads(r.items);
      })
      .catch(() => setError("Məlumatları yükləmək mümkün olmadı."));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadRoute() {
      setLoading(true);
      setError("");

      try {
        const result = await getNearestShelters(
          position[0],
          position[1],
          3
        );

        if (cancelled) return;

        setNearest(result.items);

        const target =
          result.items.find((s) => s.id === selected) ||
          result.items[0];

        if (!target) {
          setRouteData(null);
          return;
        }

        const route = await getRoute(
          position[0],
          position[1],
          target.id
        );

        if (!cancelled) {
          setSelected(target.id);
          setRouteData(route);
        }
      } catch {
        if (!cancelled) {
          setError("Marşrut yüklənmədi. Yenidən cəhd edin.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadRoute();
    return () => {
      cancelled = true;
    };
  }, [position, selected]);

  function detectLocation() {
    if (!navigator.geolocation) {
      setMessage("Cihazda geolokasiya dəstəklənmir.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (location) => {
        setPosition([
          location.coords.latitude,
          location.coords.longitude,
        ]);
      },
      () => setMessage("Rayon seçə və ya xəritəyə toxuna bilərsiniz."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  async function submitSOS() {
    if (sending || cooldown) return;

    setSending(true);

    try {
      await sendSOS(hazard, position[0], position[1], note);
      setActiveSOS(true);
      setSafe(false);
      setSosOpen(false);
      setMessage("SOS uğurla göndərildi!");
      setCooldown(true);
      setTimeout(() => setCooldown(false), 5000);
    } catch (err) {
      setMessage(
        err.message === "RATE_LIMITED"
          ? "Çox sayda sorğu göndərilib. Bir az sonra təkrar edin."
          : "SOS göndərilmədi. Yenidən cəhd edin."
      );
    } finally {
      setSending(false);
    }
  }

  async function submitSafe() {
    try {
      await markSafe(position[0], position[1]);
      setSafe(true);
      setActiveSOS(false);
      setMessage("Təhlükəsiz olduğunuz bildirildi.");
    } catch {
      setMessage("Əməliyyat alınmadı. Yenidən cəhd edin.");
    }
  }

  const path = routeData?.route?.path || [];
  const destination = routeData?.shelter;
  const occupancy = destination?.occupancyPercent ?? 0;

  return (
    <div className="citizen-app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">✚</span>
          <div>
            <strong>SafeBaku</strong>
            <small>Fövqəladə təhlükəsizlik platforması</small>
          </div>
        </div>
        <span className="demo-tag">● DEMO</span>
      </header>

      <main className="main-content">
        <div className="heading">
          <div>
            <p className="eyebrow">VƏTƏNDAŞ PANELİ</p>
            <h1>Təhlükəsiz yolunuzu tapın</h1>
            <p>Yaxınlıqdakı toplanış nöqtələrini və təhlükəsiz marşrutu görün.</p>
          </div>
        </div>

        <div className="content-grid">
          <section className="map-card">
            <div className="card-heading">
              <strong>🗺️ Canlı təhlükəsizlik xəritəsi</strong>
              <span className="status-live">● Xəritə aktivdir</span>
            </div>

            <div className="location-controls">
              <button className="location-btn" onClick={detectLocation}>
                ◎ Mənim yerim
              </button>
              <select
                defaultValue=""
                onChange={(e) => {
                  const district = districts.find(
                    (d) => d.id === e.target.value
                  );
                  if (district) {
                    setPosition([district.lat, district.lng]);
                  }
                }}
              >
                <option value="" disabled>Rayon seçin</option>
                {districts.map((district) => (
                  <option key={district.id} value={district.id}>
                    {district.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="map-wrapper">
              <MapContainer center={BAKU} zoom={12} className="map">
                <TileLayer
                  attribution='&copy; OpenStreetMap contributors'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />

                <MapClick onSelect={setPosition} />
                <MapNavigation position={position} route={path} />

                <Marker position={position} icon={markerIcon}>
                  <Popup>Sizin mövqeyiniz</Popup>
                </Marker>

                {shelters.map((shelter) => (
                  <Marker
                    key={shelter.id}
                    position={[shelter.lat, shelter.lng]}
                    icon={markerIcon}
                  >
                    <Popup>
                      <strong>{shelter.name}</strong>
                      <p>Doluluq: {shelter.occupancyPercent}%</p>
                      <button onClick={() => setSelected(shelter.id)}>
                        Marşrut seç
                      </button>
                    </Popup>
                  </Marker>
                ))}

                {roads.filter((r) => r.status === "closed").map((road) => (
                  <Polyline
                    key={road.id}
                    positions={road.path}
                    pathOptions={{
                      color: "#dc2626",
                      weight: 5,
                      dashArray: "10, 10",
                    }}
                  />
                ))}

                {routeData?.alternatives?.map((alternative, index) => (
                  <Polyline
                    key={index}
                    positions={alternative.path}
                    pathOptions={{ color: "#94a3b8", weight: 3 }}
                  />
                ))}

                {path.length > 0 && (
                  <Polyline
                    positions={path}
                    pathOptions={{ color: "#2563eb", weight: 6 }}
                  />
                )}
              </MapContainer>
            </div>

            <p className="map-hint">📍 Mövqeyinizi dəyişmək üçün xəritəyə toxunun.</p>
          </section>

          <aside className="side-panel">
            <section className="panel-card">
              <div className="card-heading">
                <strong>📍 Ən yaxın təhlükəsiz nöqtələr</strong>
              </div>

              {loading && <p>Marşrut hesablanır...</p>}
              {error && (
                <div className="notice error">
                  {error}
                  <button onClick={() => setSelected(null)}>Yenilə</button>
                </div>
              )}

              {!loading && nearest.length === 0 && (
                <p>Toplanış nöqtəsi tapılmadı.</p>
              )}

              {nearest.map((shelter) => (
                <button
                  key={shelter.id}
                  className={`shelter-item ${selected === shelter.id ? "selected" : ""}`}
                  onClick={() => setSelected(shelter.id)}
                >
                  <span className="shelter-title">
                    {shelter.kind === "park" ? "🌳" : "🏟️"} {shelter.name}
                  </span>
                  <span className="shelter-distance">
                    {(shelter.distanceMeters / 1000).toFixed(2)} km
                  </span>
                  <div className="progress-track">
                    <div
                      className={`progress-fill ${shelter.occupancyPercent >= 90 ? "high" : shelter.occupancyPercent >= 75 ? "medium" : "low"}`}
                      style={{ width: `${Math.min(shelter.occupancyPercent, 100)}%` }}
                    />
                  </div>
                  <small>Doluluq: {shelter.occupancyPercent}%</small>
                </button>
              ))}
            </section>

            <section className="panel-card route-card">
              <div className="card-heading">
                <strong>🧭 Tövsiyə edilən marşrut</strong>
              </div>

              {destination ? (
                <>
                  <h3>{destination.name}</h3>
                  <div className="route-stats">
                    <div>
                      <strong>{(routeData.route.distanceMeters / 1000).toFixed(1)} km</strong>
                      <small>Məsafə</small>
                    </div>
                    <div>
                      <strong>{Math.ceil(routeData.route.durationSec / 60)} dəq</strong>
                      <small>Təxmini vaxt</small>
                    </div>
                    <div>
                      <strong>{occupancy}%</strong>
                      <small>Doluluq</small>
                    </div>
                  </div>
                  {routeData.rerouted && (
                    <div className="notice warning">
                      ⚠️ Marşrut dəyişdirildi: {routeData.reason}
                    </div>
                  )}
                  {routeData.source === "fallback" && (
                    <div className="notice warning">
                      Təxmini marşrut (xarici xidmət əlçatmazdır)
                    </div>
                  )}
                </>
              ) : (
                <p>Marşrut məlumatı gözlənilir.</p>
              )}
            </section>

            <section className="panel-card emergency-card">
              <h3>Fövqəladə yardım</h3>
              <p>Təhlükədəsinizsə, SOS siqnalı göndərin.</p>

              {activeSOS && <div className="notice warning">● Aktiv SOS</div>}
              {safe && <div className="notice success">✓ Təhlükəsizsiniz</div>}

              <button
                className="sos-main"
                onClick={() => setSosOpen(true)}
              >
                🆘 {safe ? "Yenidən SOS" : "SOS GÖNDƏR"}
              </button>

              <button className="safe-main" onClick={submitSafe}>
                ✓ Təhlükəsizəm
              </button>
            </section>
          </aside>
        </div>
      </main>

      {message && (
        <div className="toast" role="status" onClick={() => setMessage("")}>
          {message} ×
        </div>
      )}

      {sosOpen && (
        <div className="modal-overlay">
          <div className="modal">
            <button className="close-modal" onClick={() => setSosOpen(false)}>✕</button>
            <h2>🆘 SOS göndər</h2>
            <p>Fövqəladə vəziyyətin növünü seçin.</p>

            <div className="hazard-grid">
              {hazards.map((item) => (
                <button
                  key={item.type}
                  className={hazard === item.type ? "active" : ""}
                  onClick={() => setHazard(item.type)}
                >
                  {item.name}
                </button>
              ))}
            </div>

            <textarea
              placeholder="Əlavə məlumat (istəyə bağlı)"
              maxLength={200}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <small>{note.length}/200</small>

            <button
              className="sos-main"
              disabled={sending || cooldown}
              onClick={submitSOS}
            >
              {sending ? "Göndərilir..." : "SOS təsdiqlə və göndər"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
