import { useEffect, useState, type FormEvent } from 'react'
import { useParams } from 'react-router-dom'
import { fmtDateTime, fmtMoney } from '../api'
import { PAYMENT_PROVIDERS, type PaymentProviderId } from '../utils/paymentEngine'
import '../platform.css'

interface PublicGatewayOption {
  provider: PaymentProviderId
  mode: 'sandbox' | 'live'
  is_default: boolean
  public_config: Record<string, string>
}

interface InvoiceMeta {
  invoice_number: string
  tx_ref: string
  provider: PaymentProviderId
  provider_label: string
  recipient_email: string | null
  delivery_status: 'sent' | 'sandbox_outbox' | 'failed' | 'skipped_no_email'
  delivery_transport: string
  delivery_reason?: string
  last_sent_at?: string | null
  send_count?: number
  filename: string
  size_bytes?: number
  pdf_url: string
}

interface PublicCheckoutPayload {
  merchant: {
    name: string
    tin_number: string | null
    phone: string | null
    address: string | null
  }
  intent: {
    id: string
    tx_ref: string
    provider: PaymentProviderId
    party_name: string
    customer_email?: string | null
    description: string
    amount: number
    fee_amount: number
    net_amount: number
    currency: string
    status: 'pending' | 'processing' | 'settled' | 'failed' | 'refunded'
    payer_reference: string | null
    gl_voucher_no: string | null
    return_url?: string | null
    invoice?: InvoiceMeta | null
    created_at: string
    settled_at: string | null
  }
  enabled_gateways: PublicGatewayOption[]
}

export default function PublicCheckout(): JSX.Element {
  const { token = '' } = useParams<{ token: string }>()
  const [data, setData] = useState<PublicCheckoutPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProv, setSelectedProv] = useState<PaymentProviderId>('cbe_bank')
  const [payerName, setPayerName] = useState('')
  const [payerEmail, setPayerEmail] = useState('')
  const [payerRef, setPayerRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [resendingInvoice, setResendingInvoice] = useState(false)
  const [invoiceFeedback, setInvoiceFeedback] = useState<string | null>(null)
  const [receiptSig, setReceiptSig] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/v1/public/pay/${encodeURIComponent(token)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => null)
        if (!res.ok) throw new Error(json?.error || 'Payment link unavailable')
        return json as PublicCheckoutPayload
      })
      .then((payload) => {
        if (cancelled) return
        setData(payload)
        setSelectedProv(payload.intent.provider || payload.enabled_gateways[0]?.provider || 'cbe_bank')
        setPayerName(payload.intent.party_name || '')
        setPayerEmail(payload.intent.customer_email || '')
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unable to load checkout')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [token])

  const submitPayment = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/public/pay/${encodeURIComponent(token)}/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProv,
          payer_name: payerName.trim(),
          payer_email: payerEmail.trim(),
          payer_reference: payerRef.trim(),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Payment authorization failed')
      setData((prev) =>
        prev
          ? {
              ...prev,
              intent: {
                ...json.intent,
                invoice: json.invoice || json.intent?.invoice || null,
              },
            }
          : prev,
      )
      setReceiptSig(json.receipt_signature || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment confirmation failed')
    } finally {
      setBusy(false)
    }
  }

  const resendInvoice = async (): Promise<void> => {
    if (!data?.intent?.tx_ref) return
    setResendingInvoice(true)
    setInvoiceFeedback(null)
    try {
      const targetEmail = payerEmail.trim() || data.intent.invoice?.recipient_email || data.intent.customer_email || ''
      const res = await fetch(`/api/invoices/${encodeURIComponent(data.intent.tx_ref)}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) {
        setInvoiceFeedback(json?.message || 'Unable to send PDF invoice.')
        return
      }
      setData((prev) =>
        prev
          ? {
              ...prev,
              intent: { ...prev.intent, customer_email: json.invoice?.recipient_email || prev.intent.customer_email, invoice: json.invoice },
            }
          : prev,
      )
      setInvoiceFeedback(
        json.invoice?.delivery_status === 'sent'
          ? `PDF invoice emailed to ${json.invoice.recipient_email}.`
          : `PDF invoice queued in outbox for ${json.invoice.recipient_email}.`,
      )
    } catch {
      setInvoiceFeedback('Network error while dispatching PDF invoice.')
    } finally {
      setResendingInvoice(false)
    }
  }

  const activeGateway = data?.enabled_gateways.find((g) => g.provider === selectedProv)

  return (
    <main className="pl-auth" id="main-content" style={{ minHeight: '100vh', padding: '28px 16px' }}>
      <div className="pl-card" style={{ width: '100%', maxWidth: 540, margin: '0 auto' }}>
        {loading ? (
          <p role="status" style={{ color: 'var(--text-dim)', textAlign: 'center', padding: 24 }}>Loading secure checkout…</p>
        ) : !data ? (
          <div style={{ textAlign: 'center', padding: 24 }}>
            <h1 style={{ fontSize: '1.25rem', marginBottom: 8 }}>Payment Link Not Found</h1>
            <p style={{ color: 'var(--text-dim)', fontSize: '.9rem' }}>{error || 'This checkout link has expired or is invalid.'}</p>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid var(--border)', paddingBottom: 14, marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: '.78rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                  <i className="fa-solid fa-shield-halved" aria-hidden="true" style={{ marginRight: 6 }} />
                  Verified Merchant Checkout
                </div>
                <h1 style={{ fontSize: '1.35rem', margin: '4px 0 2px' }}>{data.merchant.name}</h1>
                <small style={{ color: 'var(--text-dim)' }}>
                  {data.merchant.address || 'Addis Ababa'}
                  {data.merchant.tin_number ? ` · TIN ${data.merchant.tin_number}` : ''}
                </small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '.78rem', color: 'var(--text-dim)' }}>Amount Due</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>
                  {fmtMoney(data.intent.amount)} {data.intent.currency}
                </div>
              </div>
            </div>

            <div style={{ background: 'var(--input)', borderRadius: 10, padding: 12, marginBottom: 16, fontSize: '.88rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--text-dim)' }}>Purpose</span>
                <strong>{data.intent.description}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-dim)' }}>Transaction Ref</span>
                <code>{data.intent.tx_ref}</code>
              </div>
            </div>

            {data.intent.status === 'settled' ? (
              <div style={{ border: '1px solid rgba(52, 211, 153, .45)', borderRadius: 12, padding: 18, background: 'rgba(52, 211, 153, .08)' }} role="status">
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <i className="fa-solid fa-circle-check" style={{ fontSize: '1.4rem', color: '#34d399' }} aria-hidden="true" />
                  <div>
                    <h2 style={{ fontSize: '1.1rem', margin: 0 }}>Payment Confirmed &amp; Settled</h2>
                    <small style={{ color: 'var(--text-dim)' }}>Settled at {fmtDateTime(data.intent.settled_at)}</small>
                  </div>
                </div>
                <div style={{ fontSize: '.85rem', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>Paid via: <strong>{PAYMENT_PROVIDERS[data.intent.provider]?.name ?? data.intent.provider}</strong></div>
                  <div>Payer: <strong>{data.intent.party_name}</strong></div>
                  <div>Confirmation Ref: <code>{data.intent.payer_reference}</code></div>
                  {data.intent.gl_voucher_no && <div>Merchant Ledger Voucher: <code>{data.intent.gl_voucher_no}</code></div>}
                  {receiptSig && <div>Signature Digest: <code style={{ wordBreak: 'break-all' }}>{receiptSig.slice(0, 24)}…</code></div>}
                </div>

                <div
                  data-testid="public-invoice-card"
                  style={{
                    marginTop: 14,
                    padding: 12,
                    borderRadius: 10,
                    background: 'var(--surface)',
                    border: '1px solid var(--border2)',
                    fontSize: '.84rem',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text)' }}>
                        <i className="fa-solid fa-file-pdf" aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 6 }} />
                        {data.intent.invoice?.invoice_number || `Invoice (${data.intent.tx_ref})`}
                      </div>
                      <small style={{ color: 'var(--text-dim)' }}>
                        {data.intent.invoice?.delivery_status === 'sent'
                          ? `PDF invoice emailed to ${data.intent.invoice.recipient_email}`
                          : data.intent.invoice?.delivery_status === 'sandbox_outbox'
                            ? `PDF ready · Outbox queued for ${data.intent.invoice.recipient_email}`
                            : data.intent.invoice?.delivery_reason || 'PDF invoice generated automatically'}
                      </small>
                    </div>
                    {data.intent.invoice?.send_count ? (
                      <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#34d399' }}>
                        Sent ×{data.intent.invoice.send_count}
                      </span>
                    ) : null}
                  </div>

                  {!data.intent.invoice?.recipient_email && (
                    <div style={{ marginBottom: 8 }}>
                      <input
                        type="email"
                        className="pl-input"
                        placeholder="Enter email to dispatch PDF invoice"
                        value={payerEmail}
                        onChange={(e) => setPayerEmail(e.target.value)}
                        aria-label="Recipient email for PDF invoice"
                      />
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <a
                      href={data.intent.invoice?.pdf_url || `/api/invoices/${encodeURIComponent(data.intent.tx_ref)}/pdf`}
                      download={data.intent.invoice?.filename || `${data.intent.tx_ref}.pdf`}
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      style={{ textDecoration: 'none' }}
                      data-testid="public-invoice-download"
                    >
                      <i className="fa-solid fa-download" aria-hidden="true" /> Download PDF Invoice
                    </a>
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      disabled={resendingInvoice}
                      onClick={() => void resendInvoice()}
                      data-testid="public-invoice-resend"
                    >
                      <i className="fa-solid fa-paper-plane" aria-hidden="true" />{' '}
                      {resendingInvoice ? 'Sending…' : 'Resend PDF Email'}
                    </button>
                  </div>
                  {invoiceFeedback && (
                    <p style={{ marginTop: 8, marginBottom: 0, fontSize: '.8rem', color: 'var(--accent)' }}>{invoiceFeedback}</p>
                  )}
                </div>

                {data.intent.return_url && (
                  <div style={{ marginTop: 14 }}>
                    <a
                      href={data.intent.return_url}
                      className="pl-btn pl-btn-primary"
                      style={{ width: '100%', justifyContent: 'center', textDecoration: 'none' }}
                    >
                      <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Return &amp; Verify Receipt
                    </a>
                  </div>
                )}
              </div>
            ) : (
              <form onSubmit={submitPayment}>
                <div style={{ marginBottom: 14 }}>
                  <span className="pl-field-label" style={{ display: 'block', marginBottom: 8 }}>Select Payment Method</span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }} role="radiogroup" aria-label="Payment method">
                    {data.enabled_gateways.map((gw) => {
                      const def = PAYMENT_PROVIDERS[gw.provider]
                      const active = selectedProv === gw.provider
                      return (
                        <button
                          key={gw.provider}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          className={`pl-btn ${active ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                          style={{ justifyContent: 'flex-start', padding: '10px 12px', fontSize: '.85rem' }}
                          onClick={() => setSelectedProv(gw.provider)}
                        >
                          <i className={def?.icon || 'fa-solid fa-credit-card'} aria-hidden="true" />
                          <span>{def?.name.split(' ')[0] || gw.provider}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>

                {activeGateway?.public_config?.settlement_account && (
                  <div style={{ padding: 11, borderRadius: 10, border: '1px dashed var(--border2)', marginBottom: 14, fontSize: '.84rem' }}>
                    <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>Merchant Destination Account / Wallet</div>
                    <strong>{activeGateway.public_config.bank_name ? `${activeGateway.public_config.bank_name} · ` : ''}{activeGateway.public_config.settlement_account}</strong>
                    {activeGateway.public_config.account_holder && (
                      <div style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>Beneficiary: {activeGateway.public_config.account_holder}</div>
                    )}
                  </div>
                )}

                <div className="pl-field">
                  <label className="pl-field-label" htmlFor="payer-name">Your Full Name</label>
                  <input
                    id="payer-name"
                    className="pl-input"
                    required
                    placeholder="Enter payer name"
                    value={payerName}
                    onChange={(e) => setPayerName(e.target.value)}
                  />
                </div>

                <div className="pl-field">
                  <label className="pl-field-label" htmlFor="payer-email">Receipt Email (for PDF Invoice)</label>
                  <input
                    id="payer-email"
                    type="email"
                    className="pl-input"
                    placeholder="you@company.com"
                    value={payerEmail}
                    onChange={(e) => setPayerEmail(e.target.value)}
                  />
                </div>

                <div className="pl-field">
                  <label className="pl-field-label" htmlFor="payer-ref">
                    {selectedProv === 'cbe_bank' ? 'Bank Transfer / FT Reference' : 'Wallet Phone / Transaction ID'}
                  </label>
                  <input
                    id="payer-ref"
                    className="pl-input"
                    required
                    placeholder={selectedProv === 'cbe_bank' ? 'e.g. FT2611500912' : '+2519… or TXN ID'}
                    value={payerRef}
                    onChange={(e) => setPayerRef(e.target.value)}
                  />
                </div>

                {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.86rem', marginBottom: 10 }}>{error}</p>}

                <button type="submit" className="pl-btn pl-btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy}>
                  <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
                  {busy ? 'Authorizing Payment…' : `Pay ${fmtMoney(data.intent.amount)} ${data.intent.currency} Securely`}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  )
}
