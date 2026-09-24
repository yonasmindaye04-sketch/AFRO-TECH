import { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'

interface Plan {
  id: string
  code: string
  name: string
  business_types: string[]
  price_monthly: string
  price_semiannual: string
  price_annual: string
  description: string
  features: string[]
}

interface Subscription {
  id: string
  plan_id: string
  plan_code: string
  plan_name: string
  status: 'active' | 'expired' | 'cancelled'
  current_period_start: string
  current_period_end: string
  amount_last: string | null
}

interface PaymentRow {
  id: string
  tx_ref: string
  provider: string
  amount: string
  currency: string
  period_months: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
  paid_at: string | null
  created_at: string
  plan_name: string | null
  failure_reason: string | null
}

interface ProviderInfo {
  id: string
  name: string
  configured: boolean
}

/** Display label + short description per payment provider. */
const PROVIDER_META: Record<string, { label: string; hint: string }> = {
  chapa: { label: 'Chapa', hint: 'Cards, bank transfer & mobile money' },
  telebirr: { label: 'Telebirr', hint: 'Pay directly with the Telebirr app' },
  mpesa: { label: 'M-Pesa', hint: 'Safaricom Ethiopia mobile money' },
  cbe: { label: 'CBE Birr', hint: 'Manual bank transfer — confirmed by our team' },
  mock: { label: 'Test mode', hint: 'No real payment (development only)' },
}

declare global {
  interface Window {
    __billing_refresh?: () => void
  }
}

type TabKey = 'plans' | 'your-plan' | 'payment-history'

export default function Subscription(): JSX.Element {
  const [plans, setPlans] = useState<Plan[] | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [payments, setPayments] = useState<PaymentRow[]>([])
  const [accessUntil, setAccessUntil] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('plans')
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [provider, setProvider] = useState<string>('')

  const load = async (): Promise<void> => {
    setError(null)
    try {
      const [p, s, pay] = await Promise.all([
        api.get<{ plans: Plan[] }>('/billing/plans'),
        api.get<{ subscription: Subscription | null; access_until: string | null }>('/billing/subscription'),
        api.get<{ payments: PaymentRow[] }>('/billing/payments'),
      ])
      setPlans(p.plans)
      setSubscription(s.subscription)
      setAccessUntil(s.access_until)
      setPayments(pay.payments)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load billing info')
    } finally {
      setLoading(false)
    }
  }

  // Available payment providers (independent of plan state)
  useEffect(() => {
    api.get<{ providers: ProviderInfo[] }>('/billing/providers')
      .then((res) => {
        const available = res.providers.filter((pr) => pr.configured)
        setProviders(res.providers)
        if (!provider && available.length) setProvider(available[0].id)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    void load()
  }, [])

  // Poll: when we land here after a payment redirect, auto-verify
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const tx = q.get('tx_ref')
    if (!tx) return
    const t = setTimeout(async () => {
      try {
        const res = await api.post<{ ok: boolean; access_until: string | null }>('/billing/verify', { tx_ref: tx })
        setAccessUntil(res.access_until)
        setOk('Payment confirmed — your subscription is active.')
        window.history.replaceState({}, '', '/app/subscription')
        void load()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Verification failed')
      }
    }, 500)
    return () => clearTimeout(t)
  }, [])

  const pendingTx = useMemo(() => payments.find((p) => p.status === 'pending'), [payments])

  const PERIODS: { months: 1 | 6 | 12; label: string }[] = [
    { months: 1, label: 'monthly' },
    { months: 6, label: '6month' },
    { months: 12, label: 'annual' },
  ]

  const periodPrice = (plan: Plan, months: 1 | 6 | 12): number =>
    months === 12 ? Number(plan.price_annual) : months === 6 ? Number(plan.price_semiannual) : Number(plan.price_monthly)

  const startCheckout = async (plan: Plan, period: 1 | 6 | 12): Promise<void> => {
    setBusy(plan.code + period)
    setError(null)
    const idempotencyKey = `${plan.code}-${period}-${crypto.randomUUID().slice(0, 8)}`
    try {
      const res = await api.post<{ checkout_url: string | null; tx_ref: string; mock: boolean; provider?: string }>(
        '/billing/checkout',
        { plan_code: plan.code, period_months: period, provider: provider || undefined },
        { 'Idempotency-Key': idempotencyKey }
      )
      const providerName = PROVIDER_META[res.provider ?? provider]?.label ?? 'the selected provider'
      if (res.mock) {
        setError('Development mode: use the MOCKS section in the admin panel to confirm this payment.')
        void load()
      } else if (res.checkout_url) {
        window.location.href = res.checkout_url
      } else if (res.provider === 'cbe') {
        // Manual bank transfer: no hosted checkout — the team confirms the transfer.
        setOk(`Manual transfer initiated — reference ${res.tx_ref}. Pay ${period} month(s) via CBE Birr / bank transfer quoting this reference; your workspace is activated once the payment is confirmed by AFRO-TECH.`)
        void load()
      } else {
        setError(`No checkout link available for ${providerName} right now. Try another payment method.`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="pl-page">
      {/* ── Header with tabs ── */}
      <div className="pl-page-head">
        <div>
          <h1 className="pl-page-title">Subscription &amp; Billing</h1>
        </div>
        <div className="sub-tabs">
          <button
            type="button"
            className={`sub-tab ${tab === 'your-plan' ? 'sub-tab-active' : ''}`}
            onClick={() => setTab(tab === 'your-plan' ? 'plans' : 'your-plan')}
          >
            Your plan
          </button>
          <button
            type="button"
            className={`sub-tab ${tab === 'payment-history' ? 'sub-tab-active' : ''}`}
            onClick={() => setTab(tab === 'payment-history' ? 'plans' : 'payment-history')}
          >
            Payment history
          </button>
        </div>
      </div>

      {error && <div className="pl-error-box" role="alert"><i className="fa-solid fa-circle-exclamation" /> {error}</div>}
      {ok && <div className="pl-ok-box" role="status"><i className="fa-solid fa-circle-check" /> {ok}</div>}
      {pendingTx && !ok && (
        <div className="pl-warn-box" style={{ marginBottom: 16 }}>
          <i className="fa-solid fa-hourglass-half" /> A payment is pending: <strong>{pendingTx.tx_ref}</strong> — complete it with{' '}
          {PROVIDER_META[pendingTx.provider]?.label ?? pendingTx.provider} or contact support.
        </div>
      )}

      {/* ── Tab: Your Plan ── */}
      {tab === 'your-plan' && (
        <div className="pl-card">
          <h2 style={{ marginTop: 0 }}>Your plan</h2>
          {loading ? (
            <p>Loading…</p>
          ) : subscription ? (
            <table className="pl-table">
              <tbody>
                <tr><td>Status</td><td><span className={`pl-badge pl-badge-${subscription.status === 'active' ? 'good' : subscription.status === 'expired' ? 'bad' : 'warn'}`}>{subscription.status}</span></td></tr>
                <tr><td>Plan</td><td>{subscription.plan_name}</td></tr>
                <tr><td>Current period</td><td>{fmtDate(subscription.current_period_start)} → {fmtDate(subscription.current_period_end)}</td></tr>
                <tr><td>Access valid until</td><td><strong>{fmtDate(accessUntil ?? undefined)}</strong></td></tr>
              </tbody>
            </table>
          ) : (
            <p>No active subscription. Choose a plan below to unlock the full platform.</p>
          )}
        </div>
      )}

      {/* ── Tab: Payment History ── */}
      {tab === 'payment-history' && (
        <div className="pl-card">
          <h2 style={{ marginTop: 0 }}>Payment history</h2>
          {loading ? (
            <p>Loading…</p>
          ) : payments.length === 0 ? (
            <p>No payments yet.</p>
          ) : (
            <div className="pl-table-wrap">
              <table className="pl-table">
                <thead>
                  <tr><th>Date</th><th>Ref</th><th>Plan</th><th>Method</th><th>Amount</th><th>Period</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td>{fmtDate(p.created_at)}</td>
                      <td><code>{p.tx_ref.slice(0, 16)}…</code></td>
                      <td>{p.plan_name ?? '—'}</td>
                      <td>{PROVIDER_META[p.provider]?.label ?? p.provider}</td>
                      <td>{fmtMoney(p.amount)} {p.currency}</td>
                      <td>{p.period_months}mo</td>
                      <td>
                        <span className={`pl-badge pl-badge-${p.status === 'success' ? 'good' : p.status === 'failed' ? 'bad' : p.status === 'pending' ? 'warn' : 'neutral'}`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Plans (default — 3 pricing cards) ── */}
      {tab === 'plans' && (
        <>
          {/* Payment method picker — only shown when more than one provider is live */}
          {providers.filter((p) => p.configured).length > 1 && (
            <div className="pl-card sub-provider-picker">
              <div className="sub-provider-picker-label">
                <i className="fa-solid fa-wallet" /> Payment method
              </div>
              <div className="sub-provider-options" role="radiogroup" aria-label="Payment method">
                {providers.filter((p) => p.configured).map((p) => {
                  const meta = PROVIDER_META[p.id] ?? { label: p.name, hint: '' }
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`sub-provider-option${provider === p.id ? ' sub-provider-option-active' : ''}`}
                      onClick={() => setProvider(p.id)}
                      role="radio"
                      aria-checked={provider === p.id}
                    >
                      <span className="sub-provider-name">{meta.label}</span>
                      {meta.hint && <span className="sub-provider-hint">{meta.hint}</span>}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          {loading ? (
            <p>Loading plans…</p>
          ) : !plans?.length ? (
            <p>No plans available for your business type.</p>
          ) : (() => {
            const plan = plans[0]
            return (
              <div className="pl-grid-3">
                {PERIODS.map(({ months, label }) => {
                  const price = periodPrice(plan, months)
                  const perMonth = price / months
                  const monthly = Number(plan.price_monthly)
                  const savePct = monthly > 0 ? Math.round((1 - price / (monthly * months)) * 100) : 0
                  return (
                    <div className="pl-card" key={months}>
                      <div className="sub-plan-card">
                        <div className="sub-period-label">{label}</div>

                        <div className="sub-price">
                          <div className="sub-price-total">{fmtMoney(price)} ETB</div>
                          <div className="sub-price-per">
                            {months === 1 ? 'billed every month' : `≈ ${fmtMoney(perMonth)} ETB / month · billed every ${months} months`}
                          </div>
                          {savePct > 0 && <span className="sub-save-badge">save {savePct}% vs monthly</span>}
                        </div>

                        <div className="sub-features-box">
                          <div className="sub-features-header">{plan.name}</div>
                          <ul className="sub-features-list">
                            {plan.features.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        </div>

                        <button
                          type="button"
                          className={`pl-btn ${months === 12 ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                          style={{ width: '100%', justifyContent: 'center' }}
                          disabled={busy !== null}
                          onClick={() => void startCheckout(plan, months)}
                        >
                          {busy === plan.code + months ? 'Starting…' : 'Subscribe'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )
          })()}

          <p style={{ marginTop: 32, color: 'var(--text-dim)' }}>
            Pay securely with Chapa, Telebirr, M-Pesa or CBE Birr — whichever is enabled for your plan above.
            If you have questions or a pending payment that didn't complete, contact{' '}
            <a href="mailto:yonasmindaye04@gmail.com" style={{ color: 'inherit' }}>yonasmindaye04@gmail.com</a> or Telegram @yona64.
          </p>
        </>
      )}
    </div>
  )
}
