import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import { USE_MOCK, markSafe } from "./api/client";
import useCitizen from "./hooks/useCitizen";
import useSosQueue from "./hooks/useSosQueue";
import { sosDisplayStatus } from "./services/sosQueue";
import DevOutageControls from "./DevOutageControls";
import {
  routeNoticeKey,
  routeWarningKey,
  shelterKindIcon,
} from "./routeDisplay";

const BAKU = [40.4093, 49.8671];
const EMPTY_PATH = [];
const icons = Object.fromEntries(
  ["open", "filling", "near_full", "full", "closed", "position"].map(
    (status) => [
      status,
      L.divIcon({
        className: `shelter-marker marker-${status}`,
        html: status === "position" ? "●" : "◆",
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    ],
  ),
);
const shelterIcons = Object.fromEntries(
  ["open", "filling", "near_full", "full", "closed"].flatMap((status) =>
    ["shelter", "park", "stadium"].map((kind) => [
      `${status}-${kind}`,
      L.divIcon({
        className: `shelter-marker marker-${status}`,
        html: shelterKindIcon(kind),
        iconSize: [28, 28],
        iconAnchor: [14, 14],
      }),
    ]),
  ),
);
function MapClick({ onSelect }) {
  useMapEvents({ click: (e) => onSelect([e.latlng.lat, e.latlng.lng]) });
  return null;
}
function MapNavigation({ position, path }) {
  const map = useMap();
  const { t } = useTranslation();
  useEffect(() => {
    if (path.length > 1)
      map.fitBounds(path, { padding: [30, 30], maxZoom: 16 });
    else map.setView(position, 13);
  }, [map, position, path]);
  useEffect(() => {
    const root = map.getContainer();
    root.setAttribute("aria-label", t("liveMap"));
    const zoomIn = root.querySelector(".leaflet-control-zoom-in");
    const zoomOut = root.querySelector(".leaflet-control-zoom-out");
    if (zoomIn) {
      zoomIn.title = t("zoomIn");
      zoomIn.setAttribute("aria-label", t("zoomIn"));
    }
    if (zoomOut) {
      zoomOut.title = t("zoomOut");
      zoomOut.setAttribute("aria-label", t("zoomOut"));
    }
    const translatePopupClose = () => {
      const close = root.querySelector(".leaflet-popup-close-button");
      if (close) {
        close.title = t("close");
        close.setAttribute("aria-label", t("close"));
      }
    };
    translatePopupClose();
    map.on("popupopen", translatePopupClose);
    return () => map.off("popupopen", translatePopupClose);
  }, [map, t]);
  return null;
}
function SosDialog({
  t,
  hazard,
  setHazard,
  note,
  setNote,
  busy,
  remaining,
  onSubmit,
  onClose,
  profile,
}) {
  const dialog = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="modal"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      aria-labelledby="sos-title"
    >
      <button
        className="close-modal"
        aria-label={t("close")}
        onClick={onClose}
        disabled={busy}
      >
        ×
      </button>
      <h2 id="sos-title">{t("sosTitle")}</h2>
      <p>{t("sosDescription")}</p>
      {profile === "special_needs" && (
        <p className="notice warning">{t("prioritySOS")}</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <fieldset className="hazard-grid" disabled={busy}>
          <legend>{t("hazardType")}</legend>
          {["fire", "collapse", "flood", "medical"].map((type) => (
            <label key={type} className={hazard === type ? "active" : ""}>
              <input
                type="radio"
                name="hazard"
                value={type}
                checked={hazard === type}
                onChange={() => setHazard(type)}
              />
              {t(type)}
            </label>
          ))}
        </fieldset>
        <label htmlFor="sos-note">{t("notePlaceholder")}</label>
        <textarea
          id="sos-note"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy}
        />
        <small>{note.length}/200</small>
        <button className="sos-main" disabled={busy || remaining > 0}>
          {busy
            ? t("sending")
            : remaining > 0
              ? t("waitSeconds", { count: remaining })
              : t("confirmSOS")}
        </button>
      </form>
    </dialog>
  );
}
function readProfile() {
  try {
    return localStorage.getItem("profile") === "special_needs"
      ? "special_needs"
      : "standard";
  } catch {
    return "standard";
  }
}
function errorText(error, fallback, t) {
  if (error?.status === 429)
    return t(error.code || "RATE_LIMITED", {
      count: error.retryAfter,
      defaultValue: t("rateLimitedSeconds", { count: error.retryAfter }),
    });
  return t(error?.code || fallback, { defaultValue: t(fallback) });
}
export default function App() {
  const { t, i18n } = useTranslation();
  const lang = i18n.resolvedLanguage;
  const [position, setPosition] = useState(BAKU);
  const [district, setDistrict] = useState("");
  const [selected, setSelected] = useState(null);
  const [profile, setProfile] = useState(readProfile);
  const data = useCitizen({ position, selected, profile, lang });
  const [sosOpen, setSosOpen] = useState(false);
  const [hazard, setHazard] = useState("fire");
  const [note, setNote] = useState("");
  const [submitting, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState(null);
  const sosQueue = useSosQueue((record) => {
    setMessage({ key: record.duplicate ? "sosDuplicate" : "sosSuccess" });
  });
  const until = sosQueue.cooldownUntil;
  const sosStatus = sosDisplayStatus(sosQueue);
  const sending = submitting || sosQueue.sending;
  const [now, setNow] = useState(() => Date.now());
  const pending = useRef(false);
  const mounted = useRef(false);
  const remaining = Math.max(0, Math.ceil((until - now) / 1000));
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!until) return;
    const timer = setInterval(() => {
      const timestamp = Date.now();
      setNow(timestamp);
      if (timestamp >= until) clearInterval(timer);
    }, 250);
    return () => clearInterval(timer);
  }, [until]);
  function changePosition(value, id = "") {
    setPosition(value);
    setDistrict(id);
    setSelected(null);
  }
  function changeProfile(checked) {
    const value = checked ? "special_needs" : "standard";
    setProfile(value);
    setSelected(null);
    try {
      localStorage.setItem("profile", value);
    } catch {
      /* Optional persistence */
    }
  }
  function detectLocation() {
    if (!navigator.geolocation)
      return setMessage({ key: "locationUnsupported" });
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (location) => {
        if (mounted.current) {
          changePosition([location.coords.latitude, location.coords.longitude]);
          setLocating(false);
        }
      },
      () => {
        if (mounted.current) {
          setMessage({ key: "locationDenied" });
          setLocating(false);
        }
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 },
    );
  }
  async function submitSOS() {
    if (pending.current || Date.now() < until) return;
    pending.current = true;
    setSending(true);
    try {
      const record = await sosQueue.submit({
        type: hazard,
        lat: position[0],
        lng: position[1],
        note,
        profile,
      });
      if (!record) {
        setMessage({ key: "SOS_BUSY" });
        return;
      }
      setSosOpen(false);
      setNote("");
      if (record.status !== "sent")
        setMessage({
          key: ["failed", "exhausted"].includes(record.status)
            ? "sosNeedsAttention"
            : "sosQueued",
        });
      setNow(Date.now());
    } catch (error) {
      setMessage({ error, fallback: "sosError" });
    } finally {
      pending.current = false;
      setSending(false);
    }
  }
  async function submitSafe() {
    if (pending.current || (Date.now() < until && sosStatus === "safe")) return;
    pending.current = true;
    setSaving(true);
    try {
      await sosQueue.markSafe(() => markSafe(position[0], position[1]));
      setMessage({ key: "safeSuccess" });
    } catch (error) {
      setMessage({ error, fallback: "safeError" });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const routeData = data.routeData;
  const path = routeData?.route?.path || EMPTY_PATH;
  const destination = routeData?.shelter;
  const offlineNotice = data.clientOffline
    ? "OFFLINE_BACKUP_ROUTE_MODE"
    : routeNoticeKey(routeData);
  function selectShelter(id) {
    if (id !== destination?.id) setSelected(id);
  }
  const blocked = (shelter) =>
    ["full", "closed"].includes(shelter.status) ||
    (profile === "special_needs" && !shelter.accessible);
  const shelterSummary = (shelter) => (
    <>
      <span>
        {t("occupancy")}: {shelter.occupancyPercent}% · {shelter.occupancy}/
        {shelter.capacity}
      </span>
      <span className={`badge status-${shelter.status}`}>
        {t(shelter.status)}
      </span>
      <span>
        {t(shelter.accessible ? "accessibleShelter" : "notAccessible")}
      </span>
    </>
  );
  return (
    <div className="citizen-app">
      <div className="mobile-actions" aria-label={t("emergencyHelp")}>
        <button
          className="sos-main"
          disabled={sending || saving || remaining > 0}
          onClick={() => setSosOpen(true)}
        >
          {remaining ? t("waitSeconds", { count: remaining }) : t("sendSOS")}
        </button>
        <button
          className="safe-main"
          disabled={sending || saving}
          onClick={submitSafe}
        >
          {t(saving ? "sending" : "safe")}
        </button>
      </div>
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon" aria-hidden="true">
            ✚
          </span>
          <div>
            <strong>{t("appName")}</strong>
            <small>{t("subtitle")}</small>
          </div>
        </div>
        <label className="language-picker">
          <span className="sr-only">{t("language")}</span>
          <select
            aria-label={t("language")}
            value={lang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
          >
            <option value="az">AZ</option>
            <option value="en">EN</option>
            <option value="ru">RU</option>
          </select>
        </label>
      </header>
      <main className="main-content">
        <div className="heading">
          <p className="eyebrow">{t("citizenPanel")}</p>
          <h1>{t("mainTitle")}</h1>
          <p>{t("description")}</p>
        </div>
        <div className="profile-bar">
          <label>
            <input
              type="checkbox"
              checked={profile === "special_needs"}
              onChange={(e) => changeProfile(e.target.checked)}
            />{" "}
            {t("specialNeeds")}
          </label>
          <span className="badge">
            {t(profile === "special_needs" ? "specialMode" : "standardMode")}
          </span>
          {profile === "special_needs" && (
            <span className="badge">♿ {t("accessibleRouting")}</span>
          )}
        </div>
        {data.notice && (
          <div
            key={data.notice.id}
            className="notice warning reroute-notice"
            role="status"
          >
            <strong>{t("rerouted")}</strong> —{" "}
            {t(data.notice.reason || "ROUTE_CHANGED")}
          </div>
        )}
        {data.dataError && (
          <div className="notice error" role="alert">
            {errorText(data.dataError, "dataError", t)}{" "}
            <button onClick={data.retry}>{t("retry")}</button>
          </div>
        )}
        {offlineNotice && (
          <div className="notice warning offline-notice" role="status">
            {t(offlineNotice)}
            <p>
              {t("fallbackMode")}:{" "}
              {t(`mode_${routeData?.fallbackMode || "client_cache"}`, {
                defaultValue: t("mode_client_cache"),
              })}
            </p>
          </div>
        )}
        {import.meta.env.DEV && <DevOutageControls onChange={data.retry} />}
        <div className="content-grid">
          <section className="map-card" aria-label={t("liveMap")}>
            <div className="card-heading">
              <strong>{t("liveMap")}</strong>
              <span
                className={`badge connection-${data.connection}`}
                role="status"
              >
                {t(data.connection)}
                {USE_MOCK && ` · ${t("mockMode")}`}
              </span>
            </div>
            <div className="location-controls">
              <button
                className="location-btn"
                disabled={locating}
                onClick={detectLocation}
              >
                {t(locating ? "locating" : "myLocation")}
              </button>
              <select
                aria-label={t("selectDistrict")}
                value={district}
                onChange={(e) => {
                  const d = data.districts.find((x) => x.id === e.target.value);
                  if (d) changePosition([d.lat, d.lng], d.id);
                }}
              >
                <option value="" disabled>
                  {t("selectDistrict")}
                </option>
                {data.districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <p className="location-caption">
              {t(position === BAKU ? "defaultLocation" : "selectedLocation")}{" "}
              {position.map((n) => n.toFixed(5)).join(", ")}
            </p>
            <div className="map-wrapper">
              <MapContainer center={BAKU} zoom={12} className="map">
                <TileLayer
                  attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClick onSelect={changePosition} />
                <MapNavigation position={position} path={path} />
                <Marker
                  key={`position-${lang}`}
                  position={position}
                  icon={icons.position}
                  title={t("yourLocation")}
                >
                  <Popup>{t("yourLocation")}</Popup>
                </Marker>
                {data.shelters.map((s) => (
                  <Marker
                    key={`${s.id}-${lang}-${s.status}-${s.name}`}
                    position={[s.lat, s.lng]}
                    icon={
                      shelterIcons[`${s.status}-${s.kind}`] ||
                      shelterIcons["open-shelter"]
                    }
                    title={`${s.name}: ${t(s.kind)} · ${t(s.status)}`}
                  >
                    <Popup>
                      <strong>{s.name}</strong>
                      <div className="shelter-details">{shelterSummary(s)}</div>
                      <button
                        disabled={blocked(s)}
                        onClick={() => selectShelter(s.id)}
                      >
                        {t("selectRoute")}
                      </button>
                    </Popup>
                  </Marker>
                ))}
                {data.roads
                  .filter(
                    (r) =>
                      r.status === "closed" ||
                      (profile === "special_needs" && !r.accessible),
                  )
                  .map((r) => (
                    <Polyline
                      key={r.id}
                      positions={r.path}
                      pathOptions={{
                        color: r.status === "closed" ? "#dc2626" : "#a16207",
                        weight: 5,
                        dashArray: "10,10",
                      }}
                    >
                      <Popup>
                        {r.name} ·{" "}
                        {t(r.status === "closed" ? "closed" : "notAccessible")}
                      </Popup>
                    </Polyline>
                  ))}
                {routeData?.alternatives?.map((a, i) => (
                  <Polyline
                    key={i}
                    positions={a.path}
                    pathOptions={{ color: "#64748b", weight: 3 }}
                  >
                    <Popup>{t("alternative", { count: i + 1 })}</Popup>
                  </Polyline>
                ))}
                {path.length > 0 && (
                  <Polyline
                    positions={path}
                    pathOptions={{
                      color: "#2563eb",
                      weight: 6,
                      dashArray:
                        routeData.source === "fallback" ? "8,8" : undefined,
                    }}
                  />
                )}
              </MapContainer>
            </div>
            <p className="map-hint">{t("mapHint")}</p>
            <div className="map-legend">
              {["open", "filling", "near_full", "full", "closed"].map(
                (status) => (
                  <span key={status}>
                    <i className={`legend-dot marker-${status}`} />
                    {t(status)}
                  </span>
                ),
              )}
            </div>
          </section>
          <aside className="side-panel">
            <section className="panel-card" aria-busy={data.loading}>
              <h2>{t("nearestShelters")}</h2>
              {data.loading && <p role="status">{t("routeLoading")}</p>}
              {data.routeError && (
                <div className="notice error" role="alert">
                  {errorText(data.routeError, "routeError", t)}{" "}
                  <button onClick={data.retry}>{t("retry")}</button>
                </div>
              )}
              {!data.loading && !data.nearest.length && (
                <p>{t("noShelters")}</p>
              )}
              {data.nearest.map((s) => (
                <button
                  key={s.id}
                  className={`shelter-item ${destination?.id === s.id ? "selected" : ""}`}
                  disabled={blocked(s)}
                  onClick={() => selectShelter(s.id)}
                >
                  <span className="shelter-title">
                    <span aria-hidden="true">{shelterKindIcon(s.kind)}</span>{" "}
                    {s.name}
                  </span>
                  <span>{t(s.kind)}</span>
                  <span className="shelter-distance">
                    {(s.distanceMeters / 1000).toFixed(2)} {t("km")}
                  </span>
                  <span className="progress-track">
                    <span
                      className={`progress-fill ${s.occupancyPercent >= 100 ? "full" : s.occupancyPercent >= 90 ? "high" : s.occupancyPercent >= 75 ? "medium" : "low"}`}
                      style={{ width: `${Math.min(s.occupancyPercent, 100)}%` }}
                    />
                  </span>
                  <span className="shelter-details">{shelterSummary(s)}</span>
                </button>
              ))}
            </section>
            <section className="panel-card route-card">
              <h2>{t("recommendedRoute")}</h2>
              {destination ? (
                <>
                  <h3>{destination.name}</h3>
                  <div className="route-stats">
                    <div>
                      <strong>
                        {(routeData.route.distanceMeters / 1000).toFixed(1)}{" "}
                        {t("km")}
                      </strong>
                      <small>{t("distance")}</small>
                    </div>
                    <div>
                      <strong>
                        {Math.ceil(routeData.route.durationSec / 60)}{" "}
                        {t("minutes")}
                      </strong>
                      <small>{t("estimatedTime")}</small>
                    </div>
                    <div>
                      <strong>{destination.occupancyPercent}%</strong>
                      <small>{t("occupancy")}</small>
                    </div>
                  </div>
                  <p>
                    <span className="badge">
                      {t(
                        data.clientOffline ||
                          ["client_cache", "straight_line"].includes(
                            routeData.fallbackMode,
                          )
                          ? "accessibilityUnverified"
                          : routeData.accessible
                            ? "accessibleRoute"
                            : "notAccessible",
                      )}
                    </span>{" "}
                    · {t(routeData.transport)}
                  </p>
                  {(data.clientOffline ||
                    routeData.fallbackMode === "client_cache") &&
                    routeData.accessibilityNotes?.length > 0 && (
                      <p>{t("cachedAccessibilityNotes")}</p>
                    )}
                  <ul>
                    {routeData.accessibilityNotes?.map((key) => (
                      <li key={key}>{t(key)}</li>
                    ))}
                  </ul>
                  {routeData.source === "fallback" && (
                    <div className="notice warning" role="status">
                      {t("fallbackRoute")}
                      <p>{t(routeWarningKey(routeData))}</p>
                      <button onClick={data.retry}>{t("refreshRoute")}</button>
                    </div>
                  )}
                  {routeData.alternatives?.map((a, i) => (
                    <p key={i}>
                      {t("alternative", { count: i + 1 })}:{" "}
                      {(a.distanceMeters / 1000).toFixed(1)} {t("km")} ·{" "}
                      {Math.ceil(a.durationSec / 60)} {t("minutes")}
                    </p>
                  ))}
                </>
              ) : (
                <p>{t("routeWaiting")}</p>
              )}
            </section>
            <section className="panel-card emergency-card">
              <h2>{t("emergencyHelp")}</h2>
              <p>{t("emergencyDescription")}</p>
              {sosStatus && (
                <div
                  role="status"
                  className={`notice ${sosStatus === "safe" ? "success" : "warning"}`}
                >
                  {t(sosStatus === "safe" ? "safeStatus" : "activeSOS")}
                  {sosStatus === "special_needs" && (
                    <strong className="priority-badge">
                      {t("prioritySOS")}
                    </strong>
                  )}
                </div>
              )}
              <button
                className="sos-main"
                disabled={sending || saving || remaining > 0}
                onClick={() => setSosOpen(true)}
              >
                {remaining
                  ? t("waitSeconds", { count: remaining })
                  : t(sosStatus ? "sosAgain" : "sendSOS")}
              </button>
              <button
                className="safe-main"
                disabled={sending || saving}
                onClick={submitSafe}
              >
                {t(saving ? "sending" : "safe")}
              </button>
            </section>
          </aside>
        </div>
      </main>
      {(sosQueue.storageError ||
        sosQueue.records.some((r) =>
          ["pending", "sending", "failed", "exhausted"].includes(r.status),
        )) && (
        <section
          className="queue-panel panel-card"
          aria-label={t("sosQueueTitle")}
        >
          {sosQueue.storageError && (
            <p role="alert" className="notice error">
              {t("queueStorageError")}
            </p>
          )}
          {sosQueue.records
            .filter((r) =>
              ["pending", "sending", "failed", "exhausted"].includes(r.status),
            )
            .map((record) => (
              <div
                key={record.id}
                className={`notice ${["failed", "exhausted"].includes(record.status) ? "error" : "warning"}`}
                role="status"
              >
                <strong>
                  {t(
                    record.status === "sending"
                      ? "sending"
                      : record.status === "pending"
                        ? "sosQueued"
                        : "sosNeedsAttention",
                  )}
                </strong>
                <p>
                  {t(record.payload.type)} ·{" "}
                  {t("sosAttempts", { count: record.attempts })}
                </p>
                {record.errorCode && (
                  <p>
                    {t(record.errorCode, {
                      count: Math.max(
                        0,
                        Math.ceil((record.nextAttemptAt - now) / 1000),
                      ),
                      defaultValue: t("sosError"),
                    })}
                  </p>
                )}
                {record.status === "pending" && (
                  <p>
                    {t("sosRetryCountdown", {
                      count: Math.max(
                        0,
                        Math.ceil((record.nextAttemptAt - now) / 1000),
                      ),
                    })}
                  </p>
                )}
                {["failed", "exhausted"].includes(record.status) && (
                  <p>{t("sosManualHelp")}</p>
                )}
              </div>
            ))}
        </section>
      )}
      {message && (
        <div className="toast" role={message.error ? "alert" : "status"}>
          {message.key
            ? t(message.key)
            : errorText(message.error, message.fallback, t)}
          <button aria-label={t("close")} onClick={() => setMessage(null)}>
            ×
          </button>
        </div>
      )}
      {sosOpen && (
        <SosDialog
          t={t}
          hazard={hazard}
          setHazard={setHazard}
          note={note}
          setNote={setNote}
          busy={sending}
          remaining={remaining}
          onSubmit={submitSOS}
          onClose={() => setSosOpen(false)}
          profile={profile}
        />
      )}
    </div>
  );
}
