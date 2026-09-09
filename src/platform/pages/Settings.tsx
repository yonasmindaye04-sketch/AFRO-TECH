import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { useAuth } from '../AuthContext'
import { useTheme } from '../../context/useTheme'
import { Card, Field, OkBox, Spinner } from '../ui'

import ThermalReceipt from '../ui/ThermalReceipt'
import type { ReceiptData } from '../utils/receipt'

interface TenantSettings {
  business_name?: string
  tin_number?: string
  vat_number?: string
  business_phone?: string
  business_address?: string
  receipt_header?: string
  receipt_footer?: string
  currency?: string
  tax_rate?: number
  academic_year?: string
  margin_presets?: string
  auto_print_receipt?: boolean
}
interface TelegramConfig {
  enabled: boolean
  bot_username: string | null
  is_tenant_bot?: boolean
  linked: boolean
  app_url: string
}

export default function Settings(): JSX.Element {
  const { me } = useAuth()
  const { dark, toggle: toggleTheme } = useTheme()
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

  const firmType = me?.tenant?.business_type || 'store'
  const [liveTransaction, setLiveTransaction] = useState<ReceiptData | null>(null)

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

    // Load latest real transaction from the platform to populate receipt with actual company data
    if (firmType === 'school') {
      api
        .get<{ fees: any[] }>('/school/fees')
        .then((r) => {
          const f = r.fees?.find((x) => x.status === 'paid') || r.fees?.[0]
          if (f) {
            const amt = Number(f.paid_amount || f.amount || 0)
            setLiveTransaction({
              invoice_no: `FEE-${f.id.slice(0, 8).toUpperCase()}`,
              customer_name: `${f.student_name} (${f.class_name || 'Student'})`,
              cashier_name: me?.full_name || 'Bursar / Cashier',
              created_at: f.paid_at || f.created_at,
              items: [{ name: f.title || 'Tuition Fee', quantity: 1, unit_price: amt, line_total: amt }],
              subtotal: amt,
              discount: 0,
              total: amt,
              payment_method: 'Bank Transfer / Cash',
              amount_paid: amt,
              change_due: 0,
            })
          }
        })
        .catch(() => undefined)
    } else if (firmType === 'hospital') {
      api
        .get<{ invoices: any[] }>('/hospital/invoices')
        .then((r) => {
          const inv = r.invoices?.[0]
          if (inv) {
            const amt = Number(inv.amount || 0)
            const paid = Number(inv.paid_amount || amt)
            setLiveTransaction({
              invoice_no: inv.number || `MED-${inv.id.slice(0, 8).toUpperCase()}`,
              customer_name: inv.patient_name || 'Patient',
              cashier_name: me?.full_name || 'Cashier',
              created_at: inv.issued_on,
              items: [{ name: inv.description || 'Medical Consultation & Service', quantity: 1, unit_price: amt, line_total: amt }],
              subtotal: amt,
              discount: 0,
              total: amt,
              payment_method: 'Cash',
              amount_paid: paid,
              change_due: Math.max(0, paid - amt),
            })
          }
        })
        .catch(() => undefined)
    } else {
      // Store / Pharmacy
      api
        .get<{ sales: any[] }>('/retail/sales?limit=1')
        .then((r) => {
          const s = r.sales?.[0]
          if (s && s.items && s.items.length > 0) {
            const sub = Number(s.subtotal || s.total || 0)
            const disc = Number(s.discount || 0)
            const tot = Number(s.total || 0)
            setLiveTransaction({
              invoice_no: s.invoice_no || `INV-${s.id.slice(0, 8).toUpperCase()}`,
              customer_name: s.customer_name || 'Walk-in Customer',
              cashier_name: s.cashier || me?.full_name || 'Cashier',
              created_at: s.created_at,
              items: s.items.map((it: any) => ({
                name: it.name,
                quantity: it.quantity,
                unit_price: Number(it.unit_price),
                line_total: it.quantity * Number(it.unit_price),
                sold_as_pills: it.sold_as_pills,
              })),
              subtotal: sub,
              discount: disc,
              total: tot,
              payment_method: s.payment_method || 'Cash',
              amount_paid: tot,
              change_due: 0,
            })
          } else {
            api
              .get<{ products: any[] }>('/retail/products')
              .then((pr) => {
                if (pr.products && pr.products.length > 0) {
                  const p1 = pr.products[0]
                  const p2 = pr.products[1]
                  const itms = [
                    { name: p1.name, quantity: 1, unit_price: Number(p1.sell_price), line_total: Number(p1.sell_price), sold_as_pills: p1.sell_by_pill },
                  ]
                  if (p2) {
                    itms.push({ name: p2.name, quantity: 2, unit_price: Number(p2.sell_price), line_total: 2 * Number(p2.sell_price), sold_as_pills: p2.sell_by_pill })
                  }
                  const tot = itms.reduce((acc, x) => acc + x.line_total, 0)
                  setLiveTransaction({
                    invoice_no: 'INV-CAT-001',
                    customer_name: 'Walk-in Customer',
                    cashier_name: me?.full_name || 'Cashier',
                    created_at: new Date().toISOString(),
                    items: itms,
                    subtotal: tot,
                    discount: 0,
                    total: tot,
                    payment_method: 'Cash',
                    amount_paid: tot,
                    change_due: 0,
                  })
                }
              })
              .catch(() => undefined)
          }
        })
        .catch(() => undefined)
    }
  }, [firmType, me?.full_name])

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

  const set = (key: keyof TenantSettings) => (e: { target: { value: string; type?: string; checked?: boolean } }) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value
    setSettings((s) => ({ ...s, [key]: val }))
  }

  const saveCompany = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setCompanyBusy(true)
    setCompanyMsg(null)
    try {
      await api.patch('/tenant', { name: companyName.trim() })
      setCompanyMsg('Company name updated')
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
        business_name: settings.business_name?.trim() || undefined,
        tin_number: settings.tin_number?.trim() || undefined,
        vat_number: settings.vat_number?.trim() || undefined,
        business_phone: settings.business_phone?.trim() || undefined,
        business_address: settings.business_address?.trim() || undefined,
        receipt_header: settings.receipt_header?.trim() || undefined,
        receipt_footer: settings.receipt_footer?.trim() || undefined,
        currency: settings.currency?.trim() || undefined,
        tax_rate: settings.tax_rate !== undefined && settings.tax_rate !== null ? Number(settings.tax_rate) : undefined,
        academic_year: isSchool ? settings.academic_year || undefined : undefined,
        margin_presets: settings.margin_presets || undefined,
        auto_print_receipt: !!settings.auto_print_receipt,
      }
      const r = await api.put<{ settings: TenantSettings }>('/tenant/settings', body)
      setSettings(r.settings)
      setMsg('Settings saved')
    } catch (err) {
      setMsg(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const fallbackItems: Record<
    string,
    {
      header?: string
      footer: string
      customer: string
      items: ReceiptData['items']
      subtotal: number
      total: number
      amount_paid: number
      change_due: number
    }
  > = {
    school: {
      header: settings.academic_year ? `Academic Year: ${settings.academic_year}` : 'Student Fee Receipt',
      footer: 'Thank you! Education is the key to success.',
      customer: 'Student Parent / Guardian',
      items: [
        { name: 'Tuition Fee — Semester 1', quantity: 1, unit_price: 2500, line_total: 2500 },
        { name: 'Registration & Books', quantity: 1, unit_price: 450, line_total: 450 },
      ],
      subtotal: 2950,
      total: 2950,
      amount_paid: 3000,
      change_due: 50,
    },
    hospital: {
      header: 'Medical Billing & Services',
      footer: 'Wishing you a speedy recovery!',
      customer: 'Patient (Outpatient)',
      items: [
        { name: 'Doctor Consultation', quantity: 1, unit_price: 350, line_total: 350 },
        { name: 'Laboratory Diagnostics', quantity: 1, unit_price: 450, line_total: 450 },
      ],
      subtotal: 800,
      total: 800,
      amount_paid: 800,
      change_due: 0,
    },
    pharmacy: {
      footer: 'Thank you! Get well soon.',
      customer: 'Walk-in Customer',
      items: [
        { name: 'Amoxicillin 500mg (caps)', quantity: 2, unit_price: 120, line_total: 240 },
        { name: 'Paracetamol 500mg (pills)', quantity: 10, unit_price: 5, line_total: 50, sold_as_pills: true },
      ],
      subtotal: 290,
      total: 290,
      amount_paid: 300,
      change_due: 10,
    },
    store: {
      footer: 'Thank you for shopping with us!',
      customer: 'Walk-in Customer',
      items: [
        { name: 'Store Merchandise 01', quantity: 2, unit_price: 150, line_total: 300 },
        { name: 'Store Merchandise 02', quantity: 1, unit_price: 220, line_total: 220 },
      ],
      subtotal: 520,
      total: 520,
      amount_paid: 600,
      change_due: 80,
    },
  }

  const defaultMeta = fallbackItems[firmType] || fallbackItems.store

  const previewReceiptData: ReceiptData = {
    business_name:
      settings.business_name ||
      companyName ||
      me?.tenant?.name ||
      (firmType === 'school'
        ? 'AFRO SUITE ACADEMY'
        : firmType === 'hospital'
        ? 'AFRO SUITE CLINIC'
        : 'AFRO SUITE STORE'),
    tin_number: settings.tin_number || undefined,
    vat_number: settings.vat_number || undefined,
    business_phone: settings.business_phone || undefined,
    business_address: settings.business_address || undefined,
    receipt_header: settings.receipt_header || (liveTransaction ? undefined : defaultMeta.header),
    receipt_footer: settings.receipt_footer || defaultMeta.footer,
    currency: settings.currency || 'ETB',
    tax_rate: settings.tax_rate,
    invoice_no: liveTransaction?.invoice_no || `REC-${firmType.slice(0, 3).toUpperCase()}-001`,
    created_at: liveTransaction?.created_at || new Date().toISOString(),
    cashier_name: liveTransaction?.cashier_name || me?.full_name || 'Cashier',
    customer_name: liveTransaction?.customer_name || defaultMeta.customer,
    items: liveTransaction?.items || defaultMeta.items,
    subtotal: liveTransaction ? liveTransaction.subtotal : defaultMeta.subtotal,
    discount: liveTransaction ? liveTransaction.discount : 0,
    total: liveTransaction ? liveTransaction.total : defaultMeta.total,
    payment_method: liveTransaction?.payment_method || 'Cash',
    amount_paid: liveTransaction ? (liveTransaction.amount_paid ?? liveTransaction.total) : defaultMeta.amount_paid,
    change_due: liveTransaction ? (liveTransaction.change_due ?? 0) : defaultMeta.change_due,
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

      {/* ── Appearance & Theme ────────────────────────────────────────────── */}
      <div style={{ marginBottom: 20 }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>
                <i className="fa-solid fa-palette" style={{ marginRight: 8, color: 'var(--accent)' }} />
                Appearance & Theme
              </h2>
              <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', margin: '4px 0 0' }}>
                Select your preferred visual mode for the entire AFRO SUITE platform.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className={`pl-btn ${!dark ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                onClick={() => { if (dark) toggleTheme() }}
              >
                <i className="fa-solid fa-sun" /> Light Mode
              </button>
              <button
                type="button"
                className={`pl-btn ${dark ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                onClick={() => { if (!dark) toggleTheme() }}
              >
                <i className="fa-solid fa-moon" /> Dark Mode
              </button>
            </div>
          </div>
        </Card>
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Business profile & Receipt (80mm)</h2>
          <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', marginBottom: 14 }}>
            Configure your business identity, tax numbers, and 80mm thermal receipt details.
          </p>
          {loaded && (
            <form onSubmit={saveSettings}>
              <Field label="Business / Trade Name" hint="Shown on receipts & invoices (leave blank for workspace name)">
                <input
                  className="pl-input"
                  value={settings.business_name ?? ''}
                  onChange={set('business_name')}
                  placeholder={companyName || me?.tenant?.name || 'My Store'}
                />
              </Field>

              <div className="pl-grid-2">
                <Field label="TIN Number" hint="Tax Identification Number on receipts">
                  <input
                    className="pl-input"
                    value={settings.tin_number ?? ''}
                    onChange={set('tin_number')}
                    placeholder="e.g. 0012345678"
                  />
                </Field>
                <Field label="VAT Reg Number" hint="Optional VAT registration ID">
                  <input
                    className="pl-input"
                    value={settings.vat_number ?? ''}
                    onChange={set('vat_number')}
                    placeholder="e.g. VAT-987654"
                  />
                </Field>
              </div>

              <div className="pl-grid-2">
                <Field label="Phone">
                  <input className="pl-input" value={settings.business_phone ?? ''} onChange={set('business_phone')} placeholder="+251…" />
                </Field>
                <Field label="Address">
                  <input className="pl-input" value={settings.business_address ?? ''} onChange={set('business_address')} placeholder="Bole, Addis Ababa" />
                </Field>
              </div>

              <Field label="Receipt Header / Slogan" hint="Printed below business name (e.g. branch or greeting)">
                <input
                  className="pl-input"
                  value={settings.receipt_header ?? ''}
                  onChange={set('receipt_header')}
                  placeholder="Bole Medhanialem Branch · Addis Ababa"
                />
              </Field>

              <Field label="Receipt Footer Note" hint="Printed at bottom (e.g. return policy or thank-you note)">
                <input
                  className="pl-input"
                  value={settings.receipt_footer ?? ''}
                  onChange={set('receipt_footer')}
                  placeholder="Goods sold are not returnable. Thank you!"
                />
              </Field>

              <div className="pl-grid-2">
                <Field label="Currency label" hint="Shown next to amounts">
                  <input className="pl-input" value={settings.currency ?? ''} onChange={set('currency')} placeholder="ETB" />
                </Field>
                <Field label="Tax / VAT rate %" hint="0 = no tax calculation on receipts">
                  <input className="pl-input" type="number" min="0" max="100" step="0.01" value={settings.tax_rate ?? ''} onChange={set('tax_rate')} placeholder="15" />
                </Field>
              </div>

              {!isSchool && (
                <div style={{ margin: '10px 0 14px' }}>
                  <label className="pl-checkbox-label" style={{ fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={!!settings.auto_print_receipt}
                      onChange={set('auto_print_receipt')}
                    />
                    <span>Auto-print 80mm receipt immediately after POS checkout</span>
                  </label>
                  <small style={{ color: 'var(--text-dim)', display: 'block', marginLeft: 24, marginTop: 3 }}>
                    Automatically opens the thermal printer dialogue on each sale.
                  </small>
                </div>
              )}

              {isSchool && (
                <Field label="Current academic year">
                  <input className="pl-input" value={settings.academic_year ?? ''} onChange={set('academic_year')} placeholder="2025/2026" />
                </Field>
              )}

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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>
                <i className="fa-solid fa-receipt" style={{ marginRight: 8, color: 'var(--accent)' }} />
                80mm Thermal Receipt Preview
              </h2>
            </div>
            <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', marginBottom: 14 }}>
              {liveTransaction
                ? 'Showing your company’s latest live transaction. Changes to business details, tax numbers, and footer update here in real time.'
                : 'Formatted for your firm with real company details. When transactions are recorded, your latest receipt displays here automatically.'}
            </p>
            <ThermalReceipt data={previewReceiptData} showActions={true} />
          </Card>

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
              {pwOk && <OkBox message="Password changed" />}
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
          Telegram Assistant
          {tgCfg?.is_tenant_bot && (
            <span style={{ marginLeft: 10, fontSize: '.75rem', padding: '3px 8px', borderRadius: 4, background: 'rgba(42, 171, 238, 0.15)', color: '#2AABEE', verticalAlign: 'middle' }}>
              Company Bot
            </span>
          )}
        </h2>
        {!tgCfg ? (
          <Spinner label="Checking Telegram…" />
        ) : !tgCfg.enabled ? (
          <div>
            <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', marginBottom: 12 }}>
              No Telegram bot is active for your company yet.
            </p>
            {me?.role === 'owner' && (
              <p style={{ fontSize: '.88rem' }}>
                <Link to="/app/bot-studio" className="pl-btn pl-btn-primary pl-btn-sm" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <i className="fa-solid fa-robot" aria-hidden="true" /> Set up your company bot in Bot Studio →
                </Link>
              </p>
            )}
          </div>
        ) : tgCfg.linked ? (
          <>
            <p style={{ fontSize: '.9rem', lineHeight: 1.7 }}>
              This account is linked to {tgCfg.is_tenant_bot ? <strong>your company bot (@{tgCfg.bot_username})</strong> : <strong>the AFRO-TECH assistant (@{tgCfg.bot_username})</strong>}. You will receive <strong>stock, expiry, fee and shift alerts</strong>, and can run <code>/today</code>,{' '}
              <code>/lowstock</code>, <code>/expiring</code>, <code>/shift</code>.
            </p>
            <div className="pl-form-actions" style={{ justifyContent: 'flex-start' }}>
              {tgCfg.bot_username && (
                <a className="pl-btn pl-btn-primary" href={`https://t.me/${tgCfg.bot_username}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  Open @{tgCfg.bot_username}
                </a>
              )}
              <button type="button" className="pl-btn pl-btn-ghost" disabled={tgBusy} onClick={() => unlinkTelegram()}>
                Unlink
              </button>
            </div>
            {me?.role === 'owner' && !tgCfg.is_tenant_bot && (
              <p style={{ fontSize: '.82rem', color: 'var(--text-dim)', marginTop: 12 }}>
                Want a dedicated bot branded with your company name?{' '}
                <Link to="/app/bot-studio" style={{ color: 'var(--accent)' }}>Configure your company bot in Bot Studio →</Link>
              </p>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: '.9rem', lineHeight: 1.7, marginBottom: 12 }}>
              Link your account to {tgCfg.is_tenant_bot ? <strong>your company's bot (@{tgCfg.bot_username})</strong> : <strong>the assistant (@{tgCfg.bot_username})</strong>} to get <strong>daily reports, low-stock alerts, shift summaries</strong>, and 1-tap workspace access.
            </p>
            {tgCode ? (
              <div style={{ background: 'var(--input)', border: '1px dashed var(--border2)', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                <p style={{ fontSize: '.85rem', color: 'var(--text-dim)', marginBottom: 6 }}>
                  Send this code to <strong>@{tgCfg.bot_username}</strong> in Telegram (valid 15 minutes):
                </p>
                <code style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--accent)', letterSpacing: 2 }}>/link {tgCode}</code>
                {tgCfg.bot_username && (
                  <p style={{ marginTop: 12 }}>
                    <a className="pl-btn pl-btn-primary pl-btn-sm" href={`https://t.me/${tgCfg.bot_username}?start=${tgCode}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                      <i className="fa-brands fa-telegram" aria-hidden="true" /> Open @{tgCfg.bot_username} & Link →
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
            {me?.role === 'owner' && !tgCfg.is_tenant_bot && (
              <p style={{ fontSize: '.82rem', color: 'var(--text-dim)', marginTop: 12 }}>
                <i className="fa-solid fa-circle-info" style={{ marginRight: 6, color: 'var(--accent)' }} />You can create a bot with your company's name on Telegram and link it directly to your workspace.{' '}
                <Link to="/app/bot-studio" style={{ color: 'var(--accent)' }}>Go to Bot Studio →</Link>
              </p>
            )}
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
