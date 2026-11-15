import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import az from "./az.json";
import en from "./en.json";
import ru from "./ru.json";
let saved = "az";
try {
  saved = localStorage.getItem("language") || "az";
} catch {
  /* Storage unavailable */
}
const language = ["az", "en", "ru"].includes(saved) ? saved : "az";
i18n
  .use(initReactI18next)
  .init({
    resources: {
      az: { translation: az },
      en: { translation: en },
      ru: { translation: ru },
    },
    lng: language,
    fallbackLng: "az",
    interpolation: { escapeValue: false },
  });
function remember(lng) {
  document.documentElement.lang = lng;
  document.title = i18n.t("appName") + " — " + i18n.t("citizenPanel");
  try {
    localStorage.setItem("language", lng);
  } catch {
    /* Storage unavailable */
  }
}
i18n.on("languageChanged", remember);
remember(language);
export default i18n;
