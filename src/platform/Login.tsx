import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { ApiError, api } from './api'
import { Field } from './ui'
import TelegramWidgetButton from './TelegramWidgetButton'
import { initTelegramUi, isTelegram, loadTelegramSdk } from './utils/telegram'

interface Providers {
  google: boolean
  telegram_bot: string | null
}

export default function Login(): JSX.Element {
  const { login, persistFromTelegram } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tgStatus, setTgStatus] = useState<'idle' | 'working' | 'failed'>('idle')
  const [providers, setProviders] = useState<Providers | null>(null)

  // Which social providers are configured on this server
  useEffect(() => {
    api
      .get<Providers>('/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({ google: false, telegram_bot: null }))
  }, [])

  // Telegram Mini App: signed initData replaces the password entirely.
  // The SDK is loaded on demand (async) so it never blocks page rendering.
  useEffect(() => {
    let cancelled = false
    void loadTelegramSdk().then(() => {
      if (cancelled || !isTelegram()) return
      initTelegramUi()
      setTgStatus('working')
      const initData = (window as unknown as { Telegram: { WebApp: { initData: string } } }).Telegram.WebApp.initData
      const params = new URLSearchParams(window.location.search)
      const tenantId = params.get('tenant_id') || undefined
      const botId = params.get('bot_id') || undefined

      api
        .post<{ token: string; me: import('./api').Me }>('/telegram/verify', { initData, tenantId, botId })
        .then((res) => {
          if (cancelled) return
          persistFromTelegram(res.token, res.me)
          navigate('/app', { replace: true })
        })
        .catch(() => { if (!cancelled) setTgStatus('failed') })
    })
    return () => { cancelled = true }
  }, [navigate, persistFromTelegram])

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not sign in right now')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="pl-auth" id="main-content">
      <Link to="/" className="pl-back-link">
        ← Back to afrotech website
      </Link>
      
      <div className="pl-auth-card">
        <div className="pl-auth-brand">
          AFRO<span>SUITE</span>
        </div>
        <div className="pl-panel">
          {tgStatus !== 'idle' && (
            <p style={{ marginBottom: 16, fontSize: '.88rem', color: tgStatus === 'failed' ? '#e07a7a' : 'var(--text-dim)' }}>
              {tgStatus === 'working'
                ? 'Signing you in with Telegram…'
                : 'This Telegram account is not linked yet — sign in once below and connect it from Settings → Telegram.'}
            </p>
          )}
          <h1>Welcome back</h1>
          <p className="pl-sub">Sign in to your company workspace.</p>
          <form onSubmit={onSubmit}>
            <Field label="Email">
              <input className="pl-input" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Password">
              <div style={{ position: 'relative' }}>
                <input
                  className="pl-input"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{ paddingRight: 40 }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute',
                    right: 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                >
                  <i className={`fa-solid ${showPassword ? 'fa-eye-slash' : 'fa-eye'}`} aria-hidden="true" />
                </button>
              </div>
            </Field>
            {error && (
              <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem', margin: '0 0 12px' }}>
                {error}
              </p>
            )}
            <button type="submit" className="pl-btn pl-btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {(providers?.google || providers?.telegram_bot) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 14px' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ color: 'var(--text-dim)', fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>or continue with</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {providers.google && (
                  <a href="/api/v1/auth/google" className="pl-btn pl-btn-ghost" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
                    <i className="fa-brands fa-google" aria-hidden="true" style={{ color: '#4285F4' }} /> Continue with Google
                  </a>
                )}
                {providers.telegram_bot && (
                  <TelegramWidgetButton botUsername={providers.telegram_bot} onError={setError} />
                )}
              </div>
            </>
          )}
        </div>
        <p className="pl-auth-alt">
          New to AFRO-TECH systems?{' '}
          <Link to="/app/register">Start your free 45-day trial</Link>
        </p>
      </div>
    </main>
  )
}
