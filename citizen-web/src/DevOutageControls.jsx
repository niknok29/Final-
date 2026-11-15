import { useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { getDevMode, setDevMode, subscribeDevMode } from "./api/devOutage";
export default function DevOutageControls({ onChange }) {
  const { t } = useTranslation();
  const mode = useSyncExternalStore(subscribeDevMode, getDevMode);
  return (
    <details className="dev-controls">
      <summary>{t("devOutages")}</summary>
      <label>
        {t("devMode")}{" "}
        <select
          value={mode}
          onChange={(event) => {
            setDevMode(event.target.value);
            onChange();
          }}
        >
          {["live", "offline", "backup", "http503", "latency"].map((value) => (
            <option key={value} value={value}>
              {t(`dev_${value}`)}
            </option>
          ))}
        </select>
      </label>
      <p>{t("devOutageHelp")}</p>
    </details>
  );
}
