import { useMemo, useState, type FormEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'
import {
  buildPaymentLinkUrl,
  computeGatewayFee,
  PAYMENT_PROVIDERS,
  validateGatewayConfig,
  validateOutboundPayout,
  type GatewayMode,
  type PaymentProviderId,
} from '../utils/paymentEngine'

interface GatewayRecord {
  provider: PaymentProviderId
  enabled: boolean
  configured: boolean
  is_default: boolean
  mode: GatewayMode
  public_config: Record<string, string>
  masked_secrets: Record<string, string>
  has_secret: boolean
  health_status: 'unconfigured' | 'configured' | 'verified' | 'error'
  last_tested_at: string | null
  updated_at: string | null
}

interface PaymentIntentRow {
  id: string
  tx_ref: string
  token: string | null
  direction: 'receive' | 'pay'
  provider: PaymentProviderId
  party_id: string | null
  party_name: string
  destination_account?: string
  description: string
  amount: number
  fee_amount: number
  net_amount: number
  currency: string
  status: 'pending' | 'processing' | 'settled' | 'failed' | 'refunded'
  payer_reference: string | null
  verified_signature: boolean
  gl_voucher_no: string | null
  customer_email?: string | null
  invoice?: {
    invoice_number: string
    pdf_url: string
    filename: string
    delivery_status: string
    recipient_email?: string | null
  } | null
  created_at: string
  settled_at: string | null
}

interface TransactionsResponse {
  intents: PaymentIntentRow[]
  summary: {
    settled_inbound: number
    settled_outbound: number
    pending_count: number
    total_fees: number
    active_gateways: number
  }
  gateways: GatewayRecord[]
}

interface PartnerOpt {
  id: string
  name: string
  phone?: string | null
  balance: string
}

type Tab = 'transactions' | 'gateways' | 'security'

const STATUS_TONE: Record<PaymentIntentRow['status'], 'good' | 'warn' | 'bad' | 'info' | 'neutral'> = {
  settled: 'good',
  pending: 'warn',
  processing: 'info',
  failed: 'bad',
  refunded: 'neutral',
}

export default function Payments(): JSX.Element {
  const [searchParams] = useSearchParams()
  const initialTab = (searchParams.get('tab') as Tab | null) || 'transactions'
  const [tab, setTab] = useState<Tab>(['transactions', 'gateways', 'security'].includes(initialTab) ? initialTab : 'transactions')
  const [dirFilter, setDirFilter] = useState<'all' | 'receive' | 'pay'>('all')
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const gwQ = useApiData<{ gateways: GatewayRecord[]; webhook_url: string }>('/payments/gateways')
  const txQ = useApiData<TransactionsResponse>('/payments/transactions')
  const custQ = useApiData<{ customers: PartnerOpt[] }>('/retail/customers')
  const supQ = useApiData<{ suppliers: PartnerOpt[] }>('/retail/suppliers')

  // Configure Gateway modal
  const [editProvider, setEditProvider] = useState<PaymentProviderId | null>(null)
  const [gwEnabled, setGwEnabled] = useState(true)
  const [gwMode, setGwMode] = useState<GatewayMode>('sandbox')
  const [gwDefault, setGwDefault] = useState(false)
  const [gwValues, setGwValues] = useState<Record<string, string>>({})
  const [gwFieldErrors, setGwFieldErrors] = useState<Record<string, string>>({})
  const [gwBusy, setGwBusy] = useState(false)
  const [testingProv, setTestingProv] = useState<PaymentProviderId | null>(null)

  // Create Payment Link modal
  const [openLink, setOpenLink] = useState(false)
  const [linkForm, setLinkForm] = useState({
    provider: '' as PaymentProviderId | '',
    party_id: '',
    party_name: '',
    customer_email: '',
    amount: '',
    description: '',
  })
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState(false)

  // Outbound Payout modal
  const [openPayout, setOpenPayout] = useState(false)
  const [payoutForm, setPayoutForm] = useState({
    provider: 'cbe_bank' as PaymentProviderId,
    party_id: '',
    party_name: '',
    destination_account: '',
    amount: '',
    remarks: '',
  })
  const [payoutBusy, setPayoutBusy] = useState(false)

  const gateways = useMemo(() => gwQ.data?.gateways ?? [], [gwQ.data])
  const enabledGateways = useMemo(() => gateways.filter((g) => g.enabled && g.configured), [gateways])
  const outboundGateways = useMemo(
    () => enabledGateways.filter((g) => PAYMENT_PROVIDERS[g.provider]?.supportsOutbound),
    [enabledGateways],
  )
  const intents = useMemo(() => {
    const list = txQ.data?.intents ?? []
    return list.filter((i) => dirFilter === 'all' || i.direction === dirFilter)
  }, [txQ.data, dirFilter])

  const effectiveLinkProvider =
    linkForm.provider || (enabledGateways.find((g) => g.is_default) ?? enabledGateways[0])?.provider || ''

  const reloadAll = (): void => {
    gwQ.reload()
    txQ.reload()
    custQ.reload()
    supQ.reload()
  }

  const openConfigureGateway = (gw: GatewayRecord): void => {
    setEditProvider(gw.provider)
    setGwEnabled(gw.configured ? gw.enabled : true)
    setGwMode(gw.mode || 'sandbox')
    setGwDefault(gw.is_default)
    setGwValues({ ...(gw.public_config || {}) })
    setGwFieldErrors({})
    setErrMsg(null)
  }

  const saveGateway = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!editProvider) return
    const existing = gateways.find((g) => g.provider === editProvider)
    const check = validateGatewayConfig(editProvider, gwValues, Boolean(existing?.has_secret))
    if (!check.valid) {
      setGwFieldErrors(check.errors)
      return
    }
    setGwBusy(true)
    setErrMsg(null)
    setNotice(null)
    try {
      const def = PAYMENT_PROVIDERS[editProvider]
      const public_config: Record<string, string> = {}
      const secrets: Record<string, string> = {}
      for (const f of def.fields) {
        const val = (gwValues[f.key] ?? '').trim()
        if (f.secret) {
          if (val) secrets[f.key] = val
        } else {
          public_config[f.key] = val
        }
      }
      await api.put(`/payments/gateways/${editProvider}`, {
        enabled: gwEnabled,
        mode: gwMode,
        is_default: gwDefault,
        public_config,
        secrets,
      })
      setNotice(`${def.name} saved securely (${gwMode.toUpperCase()} mode).`)
      setEditProvider(null)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to save gateway configuration')
    } finally {
      setGwBusy(false)
    }
  }

  const testGateway = async (provider: PaymentProviderId): Promise<void> => {
    setTestingProv(provider)
    setErrMsg(null)
    setNotice(null)
    try {
      await api.post(`/payments/gateways/${provider}/test`, {})
      setNotice(`${PAYMENT_PROVIDERS[provider].name} credentials verified successfully.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Gateway verification failed')
    } finally {
      setTestingProv(null)
    }
  }

  const createPaymentLink = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setLinkBusy(true)
    setErrMsg(null)
    setCreatedUrl(null)
    try {
      const cust = (custQ.data?.customers ?? []).find((c) => c.id === linkForm.party_id)
      const res = await api.post<{ intent: PaymentIntentRow; pay_path: string }>('/payments/links', {
        provider: effectiveLinkProvider || undefined,
        party_id: linkForm.party_id || null,
        party_name: linkForm.party_name.trim() || cust?.name || 'Customer',
        customer_email: linkForm.customer_email.trim() || undefined,
        amount: Number(linkForm.amount) || 0,
        description: linkForm.description.trim() || 'Invoice Payment',
        reference_type: linkForm.party_id ? 'customer_credit' : 'custom',
        reference_id: linkForm.party_id || null,
      })
      const fullUrl = buildPaymentLinkUrl(window.location.origin, res.intent.token || '')
      setCreatedUrl(fullUrl)
      setNotice(`Payment link ${res.intent.tx_ref} generated securely.`)
      setLinkForm((f) => ({ ...f, party_id: '', party_name: '', customer_email: '', amount: '', description: '' }))
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not create payment link')
    } finally {
      setLinkBusy(false)
    }
  }

  const sendPayout = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const prov = payoutForm.provider
    const gw = gateways.find((g) => g.provider === prov)
    const check = validateOutboundPayout({
      amount: Number(payoutForm.amount) || 0,
      destinationAccount: payoutForm.destination_account,
      providerEnabled: Boolean(gw?.enabled && gw?.configured),
      providerSupportsOutbound: Boolean(PAYMENT_PROVIDERS[prov]?.supportsOutbound),
    })
    if (!check.valid) {
      setErrMsg(check.error)
      return
    }
    setPayoutBusy(true)
    setErrMsg(null)
    setNotice(null)
    try {
      const res = await api.post<{ payout: PaymentIntentRow }>('/payments/payouts', {
        provider: prov,
        party_id: payoutForm.party_id || null,
        party_name: payoutForm.party_name.trim() || undefined,
        destination_account: payoutForm.destination_account.trim(),
        amount: Number(payoutForm.amount),
        remarks: payoutForm.remarks.trim() || undefined,
      })
      setNotice(`Outbound payout ${res.payout.tx_ref} settled & posted to GL (${res.payout.gl_voucher_no}).`)
      setOpenPayout(false)
      setPayoutForm({ provider: prov, party_id: '', party_name: '', destination_account: '', amount: '', remarks: '' })
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Outbound payout failed')
    } finally {
      setPayoutBusy(false)
    }
  }

  const settleIntent = async (intent: PaymentIntentRow): Promise<void> => {
    setErrMsg(null)
    try {
      await api.post(`/payments/intents/${intent.id}/settle`, {})
      setNotice(`Payment ${intent.tx_ref} verified & settled cleanly to GL.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not settle payment')
    }
  }

  const refundIntent = async (intent: PaymentIntentRow): Promise<void> => {
    setErrMsg(null)
    try {
      await api.post(`/payments/intents/${intent.id}/refund`, {})
      setNotice(`Refund issued for ${intent.tx_ref} and contra entry posted to GL.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not refund payment')
    }
  }

  const copyPayLink = (token: string): void => {
    const url = buildPaymentLinkUrl(window.location.origin, token)
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(url)
    }
    setNotice(`Copied checkout link: ${url}`)
  }

  const summary = txQ.data?.summary ?? {
    settled_inbound: 0,
    settled_outbound: 0,
    pending_count: 0,
    total_fees: 0,
    active_gateways: 0,
  }

  const linkFeePreview = effectiveLinkProvider && Number(linkForm.amount) > 0
    ? computeGatewayFee(Number(linkForm.amount), effectiveLinkProvider as PaymentProviderId)
    : null

  return (
    <div>
      <PageHeader
        title="Payments & Gateways"
        subtitle="Configure your own payment gateways, generate secure customer checkout links, and send verified payouts"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs" role="tablist" aria-label="Payments views">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'transactions'}
                className={`sub-tab ${tab === 'transactions' ? 'sub-tab-active' : ''}`}
                onClick={() => setTab('transactions')}
              >
                Transactions &amp; Links
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'gateways'}
                className={`sub-tab ${tab === 'gateways' ? 'sub-tab-active' : ''}`}
                onClick={() => setTab('gateways')}
              >
                Gateway Setup ({enabledGateways.length})
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'security'}
                className={`sub-tab ${tab === 'security' ? 'sub-tab-active' : ''}`}
                onClick={() => setTab('security')}
              >
                Webhooks &amp; Vault
              </button>
            </div>
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() => {
                setErrMsg(null)
                if (outboundGateways.length > 0) {
                  setPayoutForm((f) => ({ ...f, provider: outboundGateways[0].provider }))
                }
                setOpenPayout(true)
              }}
            >
              <i className="fa-solid fa-paper-plane" aria-hidden="true" /> Send Payout
            </button>
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              onClick={() => {
                setErrMsg(null)
                setCreatedUrl(null)
                setOpenLink(true)
              }}
            >
              <i className="fa-solid fa-link" aria-hidden="true" /> Create Payment Link
            </button>
          </div>
        }
      />

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-circle-arrow-down" label="Settled Received" value={`${fmtMoney(summary.settled_inbound)} ETB`} tone="#34d399" />
        <StatCard icon="fa-solid fa-circle-arrow-up" label="Settled Payouts" value={`${fmtMoney(summary.settled_outbound)} ETB`} tone="#f59e0b" />
        <StatCard icon="fa-solid fa-hourglass-half" label="Pending Pay Links" value={summary.pending_count} />
        <StatCard icon="fa-solid fa-shield-halved" label="Active Gateways" value={summary.active_gateways} tone="var(--accent)" />
      </div>

      {tab === 'transactions' && (
        <>
          <div className="pl-toolbar" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(['all', 'receive', 'pay'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  className={`pl-btn pl-btn-sm ${dirFilter === d ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                  onClick={() => setDirFilter(d)}
                >
                  {d === 'all' ? 'All Transfers' : d === 'receive' ? 'Inbound Receipts' : 'Outbound Payouts'}
                </button>
              ))}
            </div>
          </div>

          {txQ.loading && !txQ.data ? (
            <Spinner label="Loading payment transactions…" />
          ) : intents.length === 0 ? (
            <EmptyState
              icon="fa-solid fa-credit-card"
              title="No gateway transactions yet"
              hint="Create a secure payment link for customers or send a vendor payout."
            />
          ) : (
            <DataTable
              rows={intents}
              searchPlaceholder="Search reference, party, gateway…"
              columns={[
                {
                  key: 'tx_ref',
                  header: 'Reference',
                  render: (i) => (
                    <div>
                      <strong>{i.tx_ref}</strong>
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>{fmtDateTime(i.created_at)}</small>
                    </div>
                  ),
                },
                {
                  key: 'direction',
                  header: 'Flow',
                  render: (i) => (
                    <Badge tone={i.direction === 'receive' ? 'good' : 'warn'}>
                      {i.direction === 'receive' ? 'INBOUND' : 'PAYOUT'}
                    </Badge>
                  ),
                },
                {
                  key: 'party_name',
                  header: 'Party & Description',
                  render: (i) => (
                    <div>
                      <strong>{i.party_name}</strong>
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>{i.description}</small>
                    </div>
                  ),
                },
                {
                  key: 'provider',
                  header: 'Gateway',
                  render: (i) => PAYMENT_PROVIDERS[i.provider]?.name ?? i.provider,
                },
                {
                  key: 'amount',
                  header: 'Gross / Net',
                  render: (i) => (
                    <div style={{ fontVariantNumeric: 'tabular-nums' }}>
                      <strong>{fmtMoney(i.amount)} {i.currency}</strong>
                      {i.fee_amount > 0 && (
                        <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                          Net {fmtMoney(i.net_amount)} · Fee {fmtMoney(i.fee_amount)}
                        </small>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'status',
                  header: 'Status',
                  render: (i) => (
                    <div>
                      <Badge tone={STATUS_TONE[i.status]}>{i.status.toUpperCase()}</Badge>
                      {i.gl_voucher_no && (
                        <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 2 }}>GL: {i.gl_voucher_no}</small>
                      )}
                    </div>
                  ),
                },
                {
                  key: 'act',
                  header: '',
                  width: '230px',
                  render: (i) => (
                    <div className="pl-row-actions">
                      {i.token && i.status === 'pending' && (
                        <>
                          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => copyPayLink(i.token!)}>
                            Copy Link
                          </button>
                          <a className="pl-btn pl-btn-ghost pl-btn-sm" href={`/pay/${i.token}`} target="_blank" rel="noreferrer">
                            Checkout
                          </a>
                          <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => void settleIntent(i)}>
                            Verify
                          </button>
                        </>
                      )}
                      {i.status === 'settled' && i.direction === 'receive' && (
                        <>
                          <a
                            className="pl-btn pl-btn-ghost pl-btn-sm"
                            href={i.invoice?.pdf_url || `/api/invoices/${encodeURIComponent(i.tx_ref)}/pdf`}
                            download={i.invoice?.filename || `${i.tx_ref}.pdf`}
                            style={{ textDecoration: 'none' }}
                            title="Download Automated PDF Invoice"
                          >
                            <i className="fa-solid fa-file-pdf" aria-hidden="true" /> PDF
                          </a>
                          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => void refundIntent(i)}>
                            Refund
                          </button>
                        </>
                      )}
                    </div>
                  ),
                },
              ]}
            />
          )}
        </>
      )}

      {tab === 'gateways' && (
        <div className="pl-cols-2">
          {(Object.keys(PAYMENT_PROVIDERS) as PaymentProviderId[]).map((pid) => {
            const def = PAYMENT_PROVIDERS[pid]
            const gw = gateways.find((g) => g.provider === pid) ?? {
              provider: pid,
              enabled: false,
              configured: false,
              is_default: false,
              mode: 'sandbox' as GatewayMode,
              public_config: {},
              masked_secrets: {},
              has_secret: false,
              health_status: 'unconfigured' as const,
              last_tested_at: null,
              updated_at: null,
            }
            const statusTone = gw.enabled && gw.configured ? 'good' : gw.configured ? 'warn' : 'neutral'
            const statusText = gw.enabled && gw.configured ? 'ACTIVE' : gw.configured ? 'PAUSED' : 'NOT CONFIGURED'
            return (
              <Card key={pid}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 10 }}>
                  <div>
                    <h2 style={{ marginBottom: 4 }}>
                      <i className={def.icon} aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 8 }} />
                      {def.name}
                    </h2>
                    <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', margin: 0 }}>{def.tagline}</p>
                  </div>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {gw.is_default && <Badge tone="info">DEFAULT</Badge>}
                    <Badge tone={statusTone}>{statusText}</Badge>
                  </div>
                </div>

                <div style={{ fontSize: '.83rem', color: 'var(--text-dim)', marginBottom: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>
                    Fee: <strong style={{ color: 'var(--text)' }}>{def.feePct}%</strong> · Mode:{' '}
                    <strong style={{ color: 'var(--text)', textTransform: 'uppercase' }}>{gw.mode}</strong> · Outbound Payouts:{' '}
                    <strong style={{ color: 'var(--text)' }}>{def.supportsOutbound ? 'Supported' : 'Inbound Only'}</strong>
                  </div>
                  {gw.public_config.settlement_account && (
                    <div>
                      Settlement Account: <strong style={{ color: 'var(--text)' }}>{gw.public_config.settlement_account}</strong>
                    </div>
                  )}
                  {gw.masked_secrets.secret_key && (
                    <div>
                      Encrypted Secret: <code>{gw.masked_secrets.secret_key}</code>{' '}
                      {gw.health_status === 'verified' && <span style={{ color: '#34d399' }}>· Verified</span>}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => openConfigureGateway(gw)}>
                    <i className="fa-solid fa-sliders" aria-hidden="true" /> {gw.configured ? 'Edit Settings' : 'Configure'}
                  </button>
                  {gw.configured && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      disabled={testingProv === pid}
                      onClick={() => void testGateway(pid)}
                    >
                      <i className="fa-solid fa-plug-circle-check" aria-hidden="true" />{' '}
                      {testingProv === pid ? 'Verifying…' : 'Test Connection'}
                    </button>
                  )}
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {tab === 'security' && (
        <div className="pl-cols-2">
          <Card>
            <h2>
              <i className="fa-solid fa-lock" aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 8 }} />
              AES-256-GCM Credential Vault
            </h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '.88rem', lineHeight: 1.65 }}>
              Every tenant stores independent merchant credentials encrypted at rest using <strong>AES-256-GCM</strong> with per-secret random initialization vectors. Secret keys are never returned to the browser after saving — only masked tail previews are displayed.
            </p>
            <div style={{ marginTop: 12, padding: 12, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--input)' }}>
              <div style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: 4 }}>Double-Entry GL &amp; Reconciliation</div>
              <div style={{ fontSize: '.87rem' }}>
                Every settled inbound receipt debits <code>1120 Bank / Payment Gateway</code>, expenses gateway fees to <code>5200</code>, and credits <code>1210 AR</code> or <code>4100 Revenue</code> automatically.
              </div>
            </div>
          </Card>

          <Card>
            <h2>
              <i className="fa-solid fa-tower-broadcast" aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 8 }} />
              Signed Payment Webhook Endpoint
            </h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '.88rem', lineHeight: 1.65 }}>
              Point your Chapa, Telebirr, or Stripe dashboard webhook to the URL below. Incoming notifications are validated using timing-safe <strong>HMAC-SHA256</strong> against your encrypted webhook secret.
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <input
                className="pl-input"
                readOnly
                style={{ fontFamily: 'monospace', fontSize: '.78rem' }}
                aria-label="Tenant payment webhook URL"
                value={`${window.location.origin}${gwQ.data?.webhook_url ?? '/api/v1/webhooks/payments/tenant-demo-1'}`}
              />
              <button
                type="button"
                className="pl-btn pl-btn-ghost"
                onClick={() => {
                  const full = `${window.location.origin}${gwQ.data?.webhook_url ?? '/api/v1/webhooks/payments/tenant-demo-1'}`
                  if (navigator.clipboard?.writeText) void navigator.clipboard.writeText(full)
                  setNotice('Webhook URL copied to clipboard.')
                }}
              >
                Copy
              </button>
            </div>
          </Card>
        </div>
      )}

      {/* Configure Gateway Modal */}
      <Modal
        open={editProvider !== null}
        title={editProvider ? `Configure ${PAYMENT_PROVIDERS[editProvider].name}` : ''}
        onClose={() => setEditProvider(null)}
      >
        {editProvider && (
          <form onSubmit={saveGateway}>
            <div className="pl-grid-2">
              <Field label="Environment Mode">
                <select className="pl-select" value={gwMode} onChange={(e) => setGwMode(e.target.value as GatewayMode)}>
                  <option value="sandbox">Sandbox / Test Mode</option>
                  <option value="live">Live Production</option>
                </select>
              </Field>
              <Field label="Gateway Status">
                <select className="pl-select" value={gwEnabled ? 'enabled' : 'disabled'} onChange={(e) => setGwEnabled(e.target.value === 'enabled')}>
                  <option value="enabled">Enabled (Accept &amp; Pay)</option>
                  <option value="disabled">Paused</option>
                </select>
              </Field>
            </div>

            {PAYMENT_PROVIDERS[editProvider].fields.map((field) => {
              const existing = gateways.find((g) => g.provider === editProvider)
              const maskedPreview = existing?.masked_secrets?.[field.key]
              return (
                <Field
                  key={field.key}
                  label={field.label}
                  hint={maskedPreview ? `Saved: ${maskedPreview} (leave blank to keep existing)` : field.hint}
                >
                  <input
                    className="pl-input"
                    type={field.secret ? 'password' : 'text'}
                    placeholder={maskedPreview ? 'Enter new secret to rotate…' : field.placeholder}
                    value={gwValues[field.key] ?? ''}
                    onChange={(e) => {
                      const v = e.target.value
                      setGwValues((prev) => ({ ...prev, [field.key]: v }))
                      setGwFieldErrors((prev) => ({ ...prev, [field.key]: '' }))
                    }}
                  />
                  {gwFieldErrors[field.key] && (
                    <small role="alert" style={{ color: '#e07a7a', display: 'block', marginTop: 4 }}>
                      {gwFieldErrors[field.key]}
                    </small>
                  )}
                </Field>
              )
            })}

            <div style={{ margin: '8px 0 14px' }}>
              <label className="pl-checkbox-label">
                <input type="checkbox" checked={gwDefault} onChange={(e) => setGwDefault(e.target.checked)} />
                <span>Set as default checkout gateway for this workspace</span>
              </label>
            </div>

            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setEditProvider(null)}>
                Cancel
              </button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={gwBusy}>
                {gwBusy ? 'Encrypting & Saving…' : 'Save Gateway Credentials'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Create Payment Link Modal */}
      <Modal open={openLink} title="Create Secure Payment Link" onClose={() => setOpenLink(false)}>
        <form onSubmit={createPaymentLink}>
          <Field label="Receiving Gateway">
            <select
              className="pl-select"
              required
              value={effectiveLinkProvider}
              onChange={(e) => setLinkForm((f) => ({ ...f, provider: e.target.value as PaymentProviderId }))}
            >
              {enabledGateways.length === 0 && <option value="">No active gateways configured</option>}
              {enabledGateways.map((g) => (
                <option key={g.provider} value={g.provider}>
                  {PAYMENT_PROVIDERS[g.provider]?.name} ({g.mode})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Customer (optional)">
            <select
              className="pl-select"
              value={linkForm.party_id}
              onChange={(e) => {
                const c = (custQ.data?.customers ?? []).find((x) => x.id === e.target.value)
                setLinkForm((f) => ({
                  ...f,
                  party_id: e.target.value,
                  party_name: c ? c.name : f.party_name,
                  amount: c && Number(c.balance) > 0 && !f.amount ? String(Number(c.balance)) : f.amount,
                }))
              }}
            >
              <option value="">Walk-in / Custom payer…</option>
              {(custQ.data?.customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {Number(c.balance) > 0 ? `(Due: ${fmtMoney(c.balance)} ETB)` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="pl-grid-2">
            <Field label="Payer Name">
              <input
                className="pl-input"
                required
                placeholder="Customer or company name"
                value={linkForm.party_name}
                onChange={(e) => setLinkForm((f) => ({ ...f, party_name: e.target.value }))}
              />
            </Field>
            <Field label="Amount (ETB)">
              <input
                className="pl-input"
                type="number"
                min="1"
                step="0.01"
                required
                placeholder="450"
                value={linkForm.amount}
                onChange={(e) => setLinkForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
          </div>

          <div className="pl-grid-2">
            <Field label="Customer Email (for PDF Invoice)">
              <input
                className="pl-input"
                type="email"
                placeholder="customer@company.com"
                value={linkForm.customer_email}
                onChange={(e) => setLinkForm((f) => ({ ...f, customer_email: e.target.value }))}
              />
            </Field>
            <Field label="Payment Description">
              <input
                className="pl-input"
                required
                placeholder="e.g. Credit settlement or Invoice #1024"
                value={linkForm.description}
                onChange={(e) => setLinkForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
          </div>

          {linkFeePreview && (
            <div style={{ padding: 10, borderRadius: 8, background: 'var(--input)', fontSize: '.84rem', marginBottom: 12 }}>
              Processing Fee ({linkFeePreview.feePct}%): <strong>{fmtMoney(linkFeePreview.fee)} ETB</strong> · Net Settlement:{' '}
              <strong style={{ color: '#34d399' }}>{fmtMoney(linkFeePreview.net)} ETB</strong>
            </div>
          )}

          {createdUrl && (
            <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--accent)', marginBottom: 14 }}>
              <div style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginBottom: 6 }}>Shareable Checkout Link Ready</div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input className="pl-input" readOnly value={createdUrl} aria-label="Generated checkout link" />
                <a className="pl-btn pl-btn-primary pl-btn-sm" href={createdUrl} target="_blank" rel="noreferrer">
                  Open
                </a>
              </div>
            </div>
          )}

          <div className="pl-form-actions">
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setOpenLink(false)}>
              Close
            </button>
            <button type="submit" className="pl-btn pl-btn-primary" disabled={linkBusy || enabledGateways.length === 0}>
              {linkBusy ? 'Generating…' : 'Generate Pay Link'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Send Outbound Payout Modal */}
      <Modal open={openPayout} title="Send Secure Vendor / Expense Payout" onClose={() => setOpenPayout(false)}>
        <form onSubmit={sendPayout}>
          <Field label="Outbound Gateway">
            <select
              className="pl-select"
              required
              value={payoutForm.provider}
              onChange={(e) => setPayoutForm((f) => ({ ...f, provider: e.target.value as PaymentProviderId }))}
            >
              {outboundGateways.map((g) => (
                <option key={g.provider} value={g.provider}>
                  {PAYMENT_PROVIDERS[g.provider]?.name} ({g.mode})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Supplier / Payee">
            <select
              className="pl-select"
              value={payoutForm.party_id}
              onChange={(e) => {
                const s = (supQ.data?.suppliers ?? []).find((x) => x.id === e.target.value)
                setPayoutForm((f) => ({
                  ...f,
                  party_id: e.target.value,
                  party_name: s ? s.name : f.party_name,
                  destination_account: s?.phone || f.destination_account,
                }))
              }}
            >
              <option value="">Other Vendor / Operating Expense…</option>
              {(supQ.data?.suppliers ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} {Number(s.balance) > 0 ? `(Payable: ${fmtMoney(s.balance)} ETB)` : ''}
                </option>
              ))}
            </select>
          </Field>

          <div className="pl-grid-2">
            <Field label="Recipient Name">
              <input
                className="pl-input"
                required
                placeholder="Supplier or vendor name"
                value={payoutForm.party_name}
                onChange={(e) => setPayoutForm((f) => ({ ...f, party_name: e.target.value }))}
              />
            </Field>
            <Field label="Destination Account / Wallet">
              <input
                className="pl-input"
                required
                placeholder="CBE Account # or +251 wallet"
                value={payoutForm.destination_account}
                onChange={(e) => setPayoutForm((f) => ({ ...f, destination_account: e.target.value }))}
              />
            </Field>
          </div>

          <div className="pl-grid-2">
            <Field label="Payout Amount (ETB)">
              <input
                className="pl-input"
                type="number"
                min="1"
                step="0.01"
                required
                placeholder="500"
                value={payoutForm.amount}
                onChange={(e) => setPayoutForm((f) => ({ ...f, amount: e.target.value }))}
              />
            </Field>
            <Field label="Payment Note">
              <input
                className="pl-input"
                placeholder="e.g. PO-1001 settlement"
                value={payoutForm.remarks}
                onChange={(e) => setPayoutForm((f) => ({ ...f, remarks: e.target.value }))}
              />
            </Field>
          </div>

          <div className="pl-form-actions">
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setOpenPayout(false)}>
              Cancel
            </button>
            <button type="submit" className="pl-btn pl-btn-primary" disabled={payoutBusy || outboundGateways.length === 0}>
              {payoutBusy ? 'Executing…' : 'Authorize & Send Payout'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
