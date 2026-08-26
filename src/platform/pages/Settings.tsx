import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { Card, Field, OkBox, Spinner } from '../ui'

interface TenantSettings {
  business_phone?: string
  business_address?: string
  receipt_footer?: string
  currency?: string
  tax_rate?: number
  academic_year?: string
  margin_presets?: string
}
interface TelegramConfig {
  enabled: boolean
  bot_username: string | null
  linked: boolean
  app_url: string
}

export default function Settings(): JSX.Element {
  const { me } = useAuth()
  const isSchool = me?.tenant?.business_type === 'school'
  const [settings, setSettings] = useState<TenantSettings>({})
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [companyName, setCompanyName] = useState(me?.tenant?.name ?? '')
  const [companyBusy, setCompanyBusy] = useState(false)
  const [companyMsg, setCompanyMsg] = useState<string | null>(null)

  const [pwForm, setPwForm] = useState({ current_password: '', new_password: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwOk, setPwOk] = useState(false)

  // Telegram bot + Mini App linking
  const [tgCfg, setTgCfg] = useState<TelegramConfig | null>(null)
  const [tgCode, setTgCode] = useState<string | null>(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgError, setTgError] = useState<string | null>(null)

  useEffect(() => {
    api
      .get<{ settings: TenantSettings }>('/tenant/settings')
      .then((r) => setSettings(r.settings))
      .catch(() => undefined)
      .finally(() => setLoaded(true))
    api
      .get<TelegramConfig>('/telegram/config')
      .then(setTgCfg)
      .catch(() => setTgCfg({ enabled: false, bot_username: null, linked: false, app_url: '' }))
  }, [])

  const generateTgCode = async (): Promise<void> => {
    setTgBusy(true)
    setTgError(null)
    try {
      const r = await api.post<{ code: string; bot_username: string | null }>('/telegram/link-code')
      setTgCode(r.code)
      if (r.bot_username && !tgCfg?.bot_username) setTgCfg((c) => (c ? { ...c, bot_username: r.bot_username } : c))
    } catch (err) {
      setTgError(err instanceof Error ? err.message : 'Could not generate code')
    } finally {
      setTgBusy(false)
    }
  }

  const unlinkTelegram = async (): Promise<void> => {
    setTgBusy(true)
    try {
      await api.post('/telegram/unlink')
      setTgCfg((c) => (c ? { ...c, linked: false } : c))
      setTgCode(null)
    } catch (err) {
      setTgError(err instanceof Error ? err.message : 'Unlink failed')
    } finally {
      setTgBusy(false)
    }
  }

  const set = (key: keyof TenantSettings) => (e: { target: { value: string } }) =>
    setSettings((s) => ({ ...s, [key]: e.target.value }))

  const saveCompany = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setCompanyBusy(true)
    setCompanyMsg(null)
    try {
      await api.patch('/tenant', { name: companyName.trim() })
      setCompanyMsg('Company name updated ✓')
    } catch (err) {
      setCompanyMsg(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setCompanyBusy(false)
    }
  }

  const saveSettings = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    try {
      const body: TenantSettings = {
        business_phone: settings.business_phone || undefined,
        business_address: settings.business_address || undefined,
        receipt_footer: settings.receipt_footer || undefined,
        currency: settings.currency || undefined,
        tax_rate: settings.tax_rate !== undefined && settings.tax_rate !== null ? Number(settings.tax_rate) : undefined,
        academic_year: isSchool ? settings.academic_year || undefined : undefined,
        margin_presets: settings.margin_presets || undefined,
      }
      const r = await api.put<{ settings: TenantSettings }>('/tenant/settings', body)
      setSettings(r.settings)
      setMsg('Settings saved ✓')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const changePassword = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setPwBusy(true)
    setPwError(null)
    setPwOk(false)
    try {
      await api.post('/auth/change-password', pwForm)
      setPwOk(true)
      setPwForm({ current_password: '', new_password: '' })
    } catch (err) {
      setPwError(err instanceof Error ? err.message : 'Change failed')
    } finally {
      setPwBusy(false)
    }
  }

  return (
    <div>
      <h1 className="pl-page-title" style={{ marginBottom: 4 }}>
        Settings
      </h1>
      <p className="pl-page-sub" style={{ marginBottom: 22 }}>
        Workspace: <strong>{me?.tenant?.slug}</strong> · Plan: free trial
      </p>

      <div className="pl-cols-2">
        <Card>
          <h2>Business profile</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', marginBottom: 14 }}>
            Shown on receipts, invoices and report cards.
          </p>
          {loaded && (
            <form onSubmit={saveSettings}>
              <Field label="Phone">
                <input className="pl-input" value={settings.business_phone ?? ''} onChange={set('business_phone')} placeholder="+251…" />
              </Field>
              <Field label="Address">
                <input className="pl-input" value={settings.business_address ?? ''} onChange={set('business_address')} placeholder="Bole, Addis Ababa" />
              </Field>
              <div className="pl-grid-2">
                <Field label="Currency label" hint="Shown next to amounts">
                  <input className="pl-input" value={settings.currency ?? ''} onChange={set('currency')} placeholder="ETB" />
                </Field>
                <Field label="Tax / VAT rate %" hint="0 = no tax on receipts">
                  <input className="pl-input" type="number" min="0" max="100" step="0.01" value={settings.tax_rate ?? ''} onChange={set('tax_rate')} placeholder="15" />
                </Field>
              </div>
              {isSchool && (
                <Field label="Current academic year">
                  <input className="pl-input" value={settings.academic_year ?? ''} onChange={set('academic_year')} placeholder="2025/2026" />
                </Field>
              )}
              <Field label="Receipt footer message">
                <input className="pl-input" value={settings.receipt_footer ?? ''} onChange={set('receipt_footer')} placeholder="Thank you for your business!" />
              </Field>
              {!isSchool && (
                <Field label="POS margin presets" hint="Comma-separated percentages shown in the New Sale screen (e.g. 20,25,30)">
                  <input className="pl-input" value={settings.margin_presets ?? ''} onChange={set('margin_presets')} placeholder="20,25,30" />
                </Field>
              )}
              {msg && <OkBox message={msg} />}
              <div className="pl-form-actions">
                <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            </form>
          )}
        </Card>

        <div>
          <Card>
            <h2>Company name</h2>
            <form onSubmit={saveCompany}>
              <Field label="Workspace name">
                <input className="pl-input" required minLength={2} maxLength={120} value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
              </Field>
              {companyMsg && <OkBox message={companyMsg} />}
              <div className="pl-form-actions">
                <button type="submit" className="pl-btn pl-btn-primary" disabled={companyBusy}>
                  {companyBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>
          </Card>

          <Card>
            <h2>Change your password</h2>
            <form onSubmit={changePassword}>
              <Field label="Current password">
                <input className="pl-input" type="password" required autoComplete="current-password" value={pwForm.current_password} onChange={(e) => setPwForm((f) => ({ ...f, current_password: e.target.value }))} />
              </Field>
              <Field label="New password" hint="At least 8 characters">
                <input className="pl-input" type="password" required minLength={8} autoComplete="new-password" value={pwForm.new_password} onChange={(e) => setPwForm((f) => ({ ...f, new_password: e.target.value }))} />
              </Field>
              {pwError && (
                <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>
                  {pwError}
                </p>
              )}
              {pwOk && <OkBox message="Password changed ✓" />}
              <div className="pl-form-actions">
                <button type="submit" className="pl-btn pl-btn-primary" disabled={pwBusy}>
                  {pwBusy ? 'Saving…' : 'Change password'}
                </button>
              </div>
            </form>
          </Card>
        </div>
      </div>

      <Card>
        <h2>
          <i className="fa-brands fa-telegram" aria-hidden="true" style={{ color: '#2AABEE', marginRight: 8 }} />
          Telegram assistant
        </h2>
        {!tgCfg ? (
          <Spinner label="Checking Telegram…" />
        ) : !tgCfg.enabled ? (
          <p style={{ color: 'var(--text-dim)', fontSize: '.9rem' }}>
            The Telegram assistant is not configured on this server yet. Ask AFRO-TECH to enable it — it sends low-stock, expiry, fee and appointment alerts and
            gives you a one-tap Mini App inside Telegram.
          </p>
        ) : tgCfg.linked ? (
          <>
            <p style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
              ✅ This account is linked. The bot sends you <strong>stock, expiry, fee and appointment alerts</strong> and answers <code>/today</code>,{' '}
              <code>/lowstock</code>, <code>/expiring</code>, <code>/shift</code>.
            </p>
            <div className="pl-form-actions" style={{ justifyContent: 'flex-start' }}>
              {tgCfg.bot_username && (
                <a className="pl-btn pl-btn-primary" href={`https://t.me/${tgCfg.bot_username}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  Open bot chat
                </a>
              )}
              <button type="button" className="pl-btn pl-btn-ghost" disabled={tgBusy} onClick={() => unlinkTelegram()}>
                Unlink
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: '.9rem', lineHeight: 1.7, marginBottom: 12 }}>
              Link your account to get <strong>low-stock, expiry, fee and appointment alerts</strong> plus one-tap access to your workspace inside Telegram.
            </p>
            {tgCode ? (
              <div style={{ background: 'var(--input)', border: '1px dashed var(--border2)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <p style={{ fontSize: '.85rem', color: 'var(--text-dim)', marginBottom: 6 }}>
                  Send this to the bot in Telegram (valid 15 minutes):
                </p>
                <code style={{ fontSize: '1.05rem', fontWeight: 700, color: 'var(--accent)' }}>/link {tgCode}</code>
                {tgCfg.bot_username && (
                  <p style={{ marginTop: 10 }}>
                    <a className="pl-btn pl-btn-primary pl-btn-sm" href={`https://t.me/${tgCfg.bot_username}?start=${tgCode}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      Open @{tgCfg.bot_username} →
                    </a>
                  </p>
                )}
              </div>
            ) : (
              <div className="pl-form-actions" style={{ justifyContent: 'flex-start' }}>
                <button type="button" className="pl-btn pl-btn-primary" disabled={tgBusy} onClick={() => generateTgCode()}>
                  <i className="fa-solid fa-link" aria-hidden="true" /> {tgBusy ? 'Generating…' : 'Generate link code'}
                </button>
              </div>
            )}
            {tgError && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{tgError}</p>}
          </>
        )}
      </Card>

      <Card>
        <h2>Subscription</h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', lineHeight: 1.7 }}>
          You are on the <strong style={{ color: 'var(--text)' }}>free 45-day trial</strong>. Online subscription payments are coming soon — when they launch,
          you will be able to upgrade right from this page. Until then, to keep your workspace active after the trial, contact AFRO-TECH:
        </p>
        <p style={{ marginTop: 10 }}>
          <strong>+251-910-011-818</strong> · yonasmindaye04@gmail.com · Telegram <strong>@yona64</strong>
        </p>
      </Card>
    </div>
  )
}
