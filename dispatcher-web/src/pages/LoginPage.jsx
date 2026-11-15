import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { USE_MOCK } from '../api/client.js'
import { useDashboard } from '../state/dashboardStore.js'

const LANGUAGES = ['az', 'en', 'ru']

export function LoginPage() {
  const { t, i18n } = useTranslation()
  const { handleLogin } = useDashboard()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError('')
    setSubmitting(true)
    try {
      await handleLogin(username.trim(), password)
    } catch (err) {
      if (err?.status === 401) {
        setError(t('login.error401'))
      } else {
        setError(t('login.errorGeneric'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  function fillDemo(u, p) {
    setUsername(u)
    setPassword(p)
    setError('')
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-top-bar">
          <div className="login-brand">
            <span className="brand-dot" />
            <span>{t('app.shortTitle')}</span>
            {USE_MOCK && <span className="badge badge-mock">{t('app.mockMode')}</span>}
          </div>

          <div className="lang-switcher" role="group" aria-label="Language">
            {LANGUAGES.map((lng) => (
              <button
                key={lng}
                type="button"
                className={`lang-btn ${i18n.language === lng ? 'lang-btn-active' : ''}`}
                onClick={() => i18n.changeLanguage(lng)}
              >
                {lng.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <h1 className="login-heading">{t('login.heading')}</h1>
        <p className="login-subheading">{t('login.subheading')}</p>

        <form className="login-form" onSubmit={onSubmit}>
          <div className="form-field">
            <label htmlFor="login-username">{t('login.username')}</label>
            <input
              id="login-username"
              type="text"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('login.usernamePlaceholder')}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="login-password">{t('login.password')}</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('login.passwordPlaceholder')}
              required
            />
          </div>

          {error && (
            <div className="login-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="login-submit-btn" disabled={submitting}>
            {submitting ? t('login.submitting') : t('login.submit')}
          </button>
        </form>

        <div className="login-demo-box">
          <span className="login-demo-title">{t('login.demoTitle')}</span>
          <div className="login-demo-chips">
            <button
              type="button"
              className="demo-chip"
              onClick={() => fillDemo('dispatcher', 'dispatcher123')}
            >
              {t('login.demoDispatcher')}
            </button>
            <button
              type="button"
              className="demo-chip"
              onClick={() => fillDemo('admin', 'admin123')}
            >
              {t('login.demoAdmin')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
