
import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import az from "./az.json";
import en from "./en.json";
import ru from "./ru.json";

const savedLanguage = localStorage.getItem("language") || "az";

i18n.use(initReactI18next).init({
  resources: {
    az: { translation: az },
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: savedLanguage,
  fallbackLng: "az",
  interpolation: {
    escapeValue: false,
  },
});

i18n.on("languageChanged", (lng) => {
  localStorage.setItem("language", lng);
});

export default i18n;
