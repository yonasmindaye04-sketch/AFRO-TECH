import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { ApiError, api } from './api'
import { Field } from './ui'
import { initTelegramUi, isTelegram } from './utils/telegram'

export default function Login(): JSX.Element {
  const { login, persistFromTelegram } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tgStatus, setTgStatus] = useState<'idle' | 'working' | 'failed'>('idle')

  // Telegram Mini App: signed initData replaces the password entirely.
  useEffect(() => {
    if (!isTelegram()) return
    initTelegramUi()
    setTgStatus('working')
    const initData = (window as unknown as { Telegram: { WebApp: { initData: string } } }).Telegram.WebApp.initData
    api
      .post<{ token: string; me: import('./api').Me }>('/telegram/verify', { initData })
      .then((res) => {
        persistFromTelegram(res.token, res.me)
        navigate('/app', { replace: true })
      })
      .catch(() => setTgStatus('failed'))
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
    <div className="pl-auth">
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
              <input className="pl-input" type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
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
        </div>
        <p className="pl-auth-alt">
          New to AFRO-TECH systems?{' '}
          <Link to="/app/register">Start your free 45-day trial</Link>
        </p>
        <p className="pl-auth-alt" style={{ marginTop: 8 }}>
          <Link to="/">← Back to afrotech website</Link>
        </p>
      </div>
    </div>
  )
}
