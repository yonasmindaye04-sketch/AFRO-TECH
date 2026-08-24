import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth, type RegisterInput } from './AuthContext'
import { ApiError } from './api'
import { Field } from './ui'

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
    <div className="pl-auth">
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
                    className={`pl-type-opt ${form.business_type === t.value ? 'active' : ''}`}
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
        </div>
        <p className="pl-auth-alt">
          Already registered? <Link to="/app/login">Sign in</Link>
        </p>
      </div>
    </div>
  )
}
