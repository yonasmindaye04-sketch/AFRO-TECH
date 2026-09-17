import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, saveAuth } from './api'
import type { Me } from './api'
import { Field } from './ui'

const TYPES = [
  { value: 'pharmacy', label: 'Pharmacy', icon: 'fa-solid fa-pills', desc: 'POS, batch & expiry tracking' },
  { value: 'store', label: 'Store / Retail Shop', icon: 'fa-solid fa-store', desc: 'Inventory, sales & purchases' },
  { value: 'hospital', label: 'Hospital / Clinic', icon: 'fa-solid fa-hospital', desc: 'Patients, appointments, billing' },
  { value: 'school', label: 'School', icon: 'fa-solid fa-graduation-cap', desc: 'Students, attendance, fees' },
] as const

/**
 * Landing page for social sign-ins (Google redirect + Telegram widget).
 * Persists the token, then either goes straight to the app or — for brand-new
 * social users with no workspace — offers a one-step workspace creation.
 */
export default function SocialAuthCallback(): JSX.Element {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const token = params.get('token')
  const [me, setMe] = useState<Me | null>(null)
  const [error, setError] = useState<string | null>(
    params.get('error') ?? (token ? null : 'No sign-in token received — please try again')
  )
  const [stage, setStage] = useState<'loading' | 'workspace' | 'redirect'>('loading')
  const [busy, setBusy] = useState(false)

  const [companyName, setCompanyName] = useState('')
  const [businessType, setBusinessType] = useState<(typeof TYPES)[number]['value']>('pharmacy')
  const tokenRef = useRef<string | null>(token)

  useEffect(() => {
    if (!token) return
    let cancelled = false

    // Load the profile with the fresh token, then persist it
    fetch('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      .then(async (res) => {
        const body = (await res.json()) as { me?: Me }
        if (!res.ok || !body.me) throw new Error('Invalid or expired token')
        if (cancelled) return
        saveAuth({ token, me: body.me })
        setMe(body.me)
        if (body.me.tenant) {
          setStage('redirect')
          window.location.assign('/app')
        } else {
          setStage('workspace')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Sign-in failed — please try again')
        setStage('loading')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const createWorkspace = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!tokenRef.current) return
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<{ token: string; me: Me }>('/auth/complete-social', {
        company_name: companyName.trim(),
        business_type: businessType,
      })
      saveAuth({ token: res.token, me: res.me })
      window.location.assign('/app')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create your workspace')
      setBusy(false)
    }
  }

  if (error) {
    return (
      <div className="pl-auth">
        <div className="pl-auth-card">
          <div className="pl-auth-brand">
            AFRO<span>SUITE</span>
          </div>
          <div className="pl-panel">
            <h1>Sign-in problem</h1>
            <p role="alert" style={{ color: '#e07a7a', fontSize: '.92rem', margin: '14px 0 20px' }}>
              {error}
            </p>
            <button type="button" className="pl-btn pl-btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={() => navigate('/app/login')}>
              Back to sign in
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (stage === 'loading') {
    return (
      <div className="pl-auth">
        <div className="pl-auth-card">
          <div className="pl-auth-brand">
            AFRO<span>SUITE</span>
          </div>
          <div className="pl-panel">
            <h1>Signing you in…</h1>
            <p className="pl-sub">Finishing your social sign-in.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`pl-auth pl-firm-${businessType}`} data-firm={businessType}>
      <div className="pl-auth-card wide">
        <div className="pl-auth-brand">
          AFRO<span>SUITE</span>
        </div>
        <div className="pl-panel">
          <h1>One last step — create your workspace</h1>
          <p className="pl-sub">
            You're signed in as <strong style={{ color: 'var(--text)' }}>{me?.full_name}</strong>
            {me?.email ? ` (${me.email})` : ''}. Set up your company to start your free 45-day trial.
          </p>

          <form onSubmit={createWorkspace}>
            <Field label="What kind of business do you run?">
              <div className="pl-type-grid" role="radiogroup" aria-label="Business type">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={businessType === t.value}
                    className={`pl-type-opt ${t.value} ${businessType === t.value ? 'active' : ''}`}
                    onClick={() => setBusinessType(t.value)}
                  >
                    <i className={t.icon} aria-hidden="true" />
                    <span>
                      {t.label}
                      <small style={{ display: 'block', fontWeight: 400, color: 'var(--text-dim)' }}>{t.desc}</small>
                    </span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Company name">
              <input className="pl-input" required minLength={2} maxLength={120} placeholder="e.g. Bole Pharmacy" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
            </Field>
            {error && (
              <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem', margin: '0 0 12px' }}>
                {error}
              </p>
            )}
            <button type="submit" className="pl-btn pl-btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Creating workspace…' : 'Create workspace — it’s free'}
            </button>
          </form>
        </div>
        <p className="pl-auth-alt">
          Not you? <Link to="/app/login">Sign in with a different account</Link>
        </p>
      </div>
    </div>
  )
}
