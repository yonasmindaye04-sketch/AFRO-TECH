import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { ApiError } from './api'
import { Field } from './ui'

export default function Login(): JSX.Element {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
