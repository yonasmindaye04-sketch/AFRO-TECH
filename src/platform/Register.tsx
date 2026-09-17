import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, type RegisterInput } from './AuthContext'
import { api, ApiError } from './api'
import { Field } from './ui'
import TelegramWidgetButton from './TelegramWidgetButton'

const TYPES = [
  { value: 'pharmacy', label: 'Pharmacy', icon: 'fa-solid fa-pills', desc: 'POS, batch & expiry tracking' },
  { value: 'store', label: 'Store / Retail Shop', icon: 'fa-solid fa-store', desc: 'Inventory, sales & purchases' },
  { value: 'hospital', label: 'Hospital / Clinic', icon: 'fa-solid fa-hospital', desc: 'Patients, appointments, billing' },
  { value: 'school', label: 'School', icon: 'fa-solid fa-graduation-cap', desc: 'Students, attendance, fees' },
] as const

export default function Register(): JSX.Element {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const initialType = (params.get('type') ?? 'pharmacy') as RegisterInput['business_type']

  const [form, setForm] = useState<RegisterInput>({
    company_name: '',
    business_type: TYPES.some((t) => t.value === initialType) ? initialType : 'pharmacy',
    owner_name: '',
    email: '',
    password: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [providers, setProviders] = useState<{ google: boolean; telegram_bot: string | null } | null>(null)

  useEffect(() => {
    api
      .get<{ google: boolean; telegram_bot: string | null }>('/auth/providers')
      .then(setProviders)
      .catch(() => setProviders({ google: false, telegram_bot: null }))
  }, [])

  const set = (key: keyof RegisterInput) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const onSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (form.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await register(form)
      navigate('/app', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Registration failed — please try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`pl-auth pl-firm-${form.business_type}`} data-firm={form.business_type}>
      <div className="pl-auth-card wide">
        <div className="pl-auth-brand">
          AFRO<span>SUITE</span>
        </div>
        <div className="pl-panel">
          <h1>Create your company workspace</h1>
          <p className="pl-sub">Free for 45 days. No credit card — your team gets full access instantly.</p>

          <form onSubmit={onSubmit}>
            <Field label="What kind of business do you run?">
              <div className="pl-type-grid" role="radiogroup" aria-label="Business type">
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    role="radio"
                    aria-checked={form.business_type === t.value}
                    className={`pl-type-opt ${t.value} ${form.business_type === t.value ? 'active' : ''}`}
                    onClick={() => setForm((f) => ({ ...f, business_type: t.value }))}
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

            <div className="pl-grid-2">
              <Field label="Company name">
                <input className="pl-input" required minLength={2} maxLength={120} placeholder="e.g. Bole Pharmacy" value={form.company_name} onChange={set('company_name')} />
              </Field>
              <Field label="Owner full name">
                <input className="pl-input" required minLength={2} maxLength={120} placeholder="e.g. Sara Tadesse" value={form.owner_name} onChange={set('owner_name')} />
              </Field>
            </div>
            <div className="pl-grid-2">
              <Field label="Work email">
                <input className="pl-input" type="email" required autoComplete="email" placeholder="you@company.com" value={form.email} onChange={set('email')} />
              </Field>
              <Field label="Password" hint="At least 8 characters">
                <input className="pl-input" type="password" required autoComplete="new-password" minLength={8} value={form.password} onChange={set('password')} />
              </Field>
            </div>

            {error && (
              <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem', margin: '0 0 12px' }}>
                {error}
              </p>
            )}
            <button type="submit" className="pl-btn pl-btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
              {busy ? 'Creating workspace…' : 'Create workspace — it’s free'}
            </button>
          </form>

          {(providers?.google || providers?.telegram_bot) && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '18px 0 14px' }}>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
                <span style={{ color: 'var(--text-dim)', fontSize: '.78rem', textTransform: 'uppercase', letterSpacing: '.05em' }}>or sign up with</span>
                <span style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {providers.google && (
                  <a href="/api/v1/auth/google" className="pl-btn pl-btn-ghost" style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}>
                    <i className="fa-brands fa-google" aria-hidden="true" style={{ color: '#4285F4' }} /> Sign up with Google
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
          Already registered? <Link to="/app/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
