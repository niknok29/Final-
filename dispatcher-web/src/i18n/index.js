import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import az from './az.json'
import en from './en.json'
import ru from './ru.json'

const LANG_KEY = 'dispatcher_lang'
const SUPPORTED_LANGS = ['az', 'en', 'ru']

function getInitialLanguage() {
  try {
    const saved = sessionStorage.getItem(LANG_KEY)
    if (saved && SUPPORTED_LANGS.includes(saved)) {
      return saved
    }
  } catch {
    // Ignore storage access errors
  }
  return 'az'
}

function syncDocumentLanguage(lng) {
  const normalized = SUPPORTED_LANGS.includes(lng) ? lng : 'az'
  if (typeof document !== 'undefined') {
    document.documentElement.lang = normalized
  }
  try {
    sessionStorage.setItem(LANG_KEY, normalized)
  } catch {
    // Ignore storage write errors
  }
}

const initialLng = getInitialLanguage()
syncDocumentLanguage(initialLng)

i18n.use(initReactI18next).init({
  resources: {
    az: { translation: az },
    en: { translation: en },
    ru: { translation: ru },
  },
  lng: initialLng,
  fallbackLng: 'az',
  interpolation: {
    escapeValue: false,
  },
})

i18n.on('languageChanged', (lng) => {
  syncDocumentLanguage(lng)
})

export default i18n
