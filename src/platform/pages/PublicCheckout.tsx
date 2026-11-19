import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { fmtDateTime, fmtMoney } from '../api'
import { PAYMENT_PROVIDERS, type PaymentProviderId } from '../utils/paymentEngine'
import { fetchAndDownloadVerifiedPdfReceipt, saveRecentInvoiceContext } from '../../utils/invoiceHistory'
import { celebrateVerifiedPayment } from '../../utils/paymentCelebration'
import '../platform.css'

interface PublicGatewayOption {
  provider: PaymentProviderId
  mode: 'sandbox' | 'live' | 'direct'
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
    provider_locked?: boolean
    mode?: 'live' | 'sandbox' | 'direct'
    credential_source?: string
    party_name: string
    customer_email?: string | null
    customer_phone?: string | null
    description: string
    amount: number
    fee_amount: number
    net_amount: number
    currency: string
    status: 'pending' | 'processing' | 'settled' | 'failed' | 'refunded'
    payer_reference: string | null
    gl_voucher_no: string | null
    external_checkout_url?: string | null
    prepay_id?: string | null
    receive_code?: string | null
    checkout_request_id?: string | null
    customer_message?: string | null
    return_url?: string | null
    invoice?: InvoiceMeta | null
    created_at: string
    settled_at: string | null
  }
  enabled_gateways: PublicGatewayOption[]
}

interface InitiateState {
  action: 'redirect' | 'stk_poll' | 'sandbox_authorize' | 'sandbox_stk' | 'bank_transfer' | 'already_settled'
  mode: 'live' | 'sandbox' | 'direct'
  provider: PaymentProviderId
  checkout_url?: string | null
  prepay_id?: string | null
  receive_code?: string | null
  checkout_request_id?: string | null
  customer_message?: string | null
  msisdn?: string | null
}

function getGatewayShortLabel(provider: PaymentProviderId): string {
  switch (provider) {
    case 'chapa':
      return 'Chapa'
    case 'telebirr':
      return 'Telebirr'
    case 'mpesa':
      return 'M-Pesa'
    case 'cbe_bank':
      return 'CBE Bank'
    case 'stripe':
      return 'Stripe'
    default:
      return provider
  }
}

export default function PublicCheckout(): JSX.Element {
  const { token = '' } = useParams<{ token: string }>()
  const [searchParams] = useSearchParams()
  const [data, setData] = useState<PublicCheckoutPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedProv, setSelectedProv] = useState<PaymentProviderId>('cbe_bank')
  const [payerName, setPayerName] = useState('')
  const [payerEmail, setPayerEmail] = useState('')
  const [payerPhone, setPayerPhone] = useState('')
  const [payerRef, setPayerRef] = useState('')
  const [busy, setBusy] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [verifyNotice, setVerifyNotice] = useState<string | null>(null)
  const [initState, setInitState] = useState<InitiateState | null>(null)
  const [resendingInvoice, setResendingInvoice] = useState(false)
  const [downloadingReceipt, setDownloadingReceipt] = useState(false)
  const [invoiceFeedback, setInvoiceFeedback] = useState<string | null>(null)
  const [receiptSig, setReceiptSig] = useState<string | null>(null)
  const payerEmailRef = useRef(payerEmail)
  useEffect(() => {
    payerEmailRef.current = payerEmail
  }, [payerEmail])

  const verifyCheckout = useCallback(async (silent = false): Promise<boolean> => {
    if (!token) return false
    if (!silent) {
      setVerifying(true)
      setError(null)
    }
    try {
      const res = await fetch(`/api/v1/public/pay/${encodeURIComponent(token)}/verify`)
      const json = await res.json().catch(() => null)
      if (!res.ok) {
        if (!silent) setError(json?.error || 'Could not verify payment status')
        return false
      }
      if (json?.verified && json?.intent) {
        saveRecentInvoiceContext({
          email: payerEmailRef.current.trim() || json.intent.customer_email,
          txRef: json.intent.tx_ref,
        })
        setData((prev) =>
          prev
            ? {
                ...prev,
                intent: {
                  ...prev.intent,
                  ...json.intent,
                  invoice: json.invoice || json.intent?.invoice || prev.intent.invoice || null,
                },
              }
            : prev,
        )
        setReceiptSig(json.receipt_signature || null)
        setVerifyNotice(null)
        celebrateVerifiedPayment({
          txRef: json.intent.tx_ref,
          verified: true,
          status: json.intent.status,
        })
        return true
      }
      if (!silent && json?.message) {
        setVerifyNotice(json.message)
      }
      return false
    } catch {
      if (!silent) setError('Network error while checking payment status.')
      return false
    } finally {
      if (!silent) setVerifying(false)
    }
  }, [token])

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
        setError(null)
        setData(payload)
        const initialProv = payload.intent.provider || payload.enabled_gateways[0]?.provider || 'cbe_bank'
        setSelectedProv(initialProv)
        setPayerName(payload.intent.party_name || '')
        setPayerEmail(payload.intent.customer_email || '')
        setPayerPhone(payload.intent.customer_phone || '')
        if (payload.intent.checkout_request_id && initialProv === 'mpesa' && payload.intent.status !== 'settled') {
          setInitState({
            action: payload.intent.mode === 'live' ? 'stk_poll' : 'sandbox_stk',
            mode: payload.intent.mode || 'sandbox',
            provider: 'mpesa',
            checkout_request_id: payload.intent.checkout_request_id,
            customer_message: payload.intent.customer_message,
            msisdn: payload.intent.customer_phone,
          })
        } else {
          setInitState(null)
        }
        if (
          payload.intent.status !== 'settled' &&
          (searchParams.get('verify') === '1' || Boolean(searchParams.get('tx_ref')))
        ) {
          void verifyCheckout(false)
        }
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
  }, [token, searchParams, verifyCheckout])

  // Auto-poll Safaricom M-Pesa STK Push status in live mode
  useEffect(() => {
    if (initState?.action !== 'stk_poll' || data?.intent?.status === 'settled') return
    const timer = setInterval(() => {
      void verifyCheckout(true)
    }, 3000)
    return () => clearInterval(timer)
  }, [initState?.action, data?.intent?.status, verifyCheckout])

  const completeSettlement = async (overrideRef?: string): Promise<void> => {
    if (!data) return
    const effectiveRef = (overrideRef ?? payerRef).trim()
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
          payer_reference: effectiveRef,
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Payment authorization failed')
      saveRecentInvoiceContext({
        email: payerEmail.trim() || json.intent?.customer_email || data.intent.customer_email,
        txRef: json.intent?.tx_ref || data.intent.tx_ref,
      })
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
      setInitState(null)
      if (json?.ok && json?.intent?.status === 'settled') {
        celebrateVerifiedPayment({
          txRef: json.intent.tx_ref,
          verified: true,
          status: json.intent.status,
        })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment confirmation failed')
    } finally {
      setBusy(false)
    }
  }

  const handleGatewaySubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!data) return

    if (selectedProv === 'cbe_bank') {
      await completeSettlement()
      return
    }

    // Step 2: Sandbox authorization confirmation for Chapa / Telebirr / M-Pesa
    if (initState && (initState.action === 'sandbox_authorize' || initState.action === 'sandbox_stk')) {
      const refToUse =
        initState.action === 'sandbox_stk'
          ? payerRef.trim() || initState.checkout_request_id || payerPhone.trim()
          : payerRef.trim()
      await completeSettlement(refToUse)
      return
    }

    // Validate optional receipt email format when provided
    const cleanPayerEmail = payerEmail.trim()
    if (cleanPayerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanPayerEmail)) {
      setError('Please enter a valid receipt email address or leave it blank.')
      return
    }

    // Step 1: Initiate real protocol session (Chapa initialize / Telebirr preOrder / M-Pesa STK Push)
    setBusy(true)
    setError(null)
    setVerifyNotice(null)
    try {
      const res = await fetch(`/api/v1/public/pay/${encodeURIComponent(token)}/initiate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: selectedProv,
          payer_name: payerName.trim(),
          payer_email: payerEmail.trim(),
          payer_phone: payerPhone.trim(),
        }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(json?.error || 'Could not initiate payment gateway')

      if (json.action === 'already_settled' && json.intent) {
        setData((prev) => (prev ? { ...prev, intent: json.intent } : prev))
        return
      }

      const nextInit: InitiateState = {
        action: json.action,
        mode: json.mode || 'sandbox',
        provider: json.provider || selectedProv,
        checkout_url: json.checkout_url || null,
        prepay_id: json.prepay_id || null,
        receive_code: json.receive_code || null,
        checkout_request_id: json.checkout_request_id || null,
        customer_message: json.customer_message || null,
        msisdn: payerPhone.trim() || null,
      }
      setInitState(nextInit)

      if (json.action === 'redirect' && json.checkout_url) {
        window.location.assign(json.checkout_url)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment initiation failed')
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
  const providerDef = PAYMENT_PROVIDERS[selectedProv]
  const effectiveMode = initState?.mode || activeGateway?.mode || data?.intent.mode || 'sandbox'
  const isLocked = Boolean(data?.intent.provider_locked)

  return (
    <main className="pl-auth" id="main-content" style={{ minHeight: '100vh', padding: '28px 16px' }}>
      <div className="pl-card" style={{ width: '100%', maxWidth: 560, margin: '0 auto' }}>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '.76rem', color: 'var(--accent)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>
                    <i className="fa-solid fa-shield-halved" aria-hidden="true" style={{ marginRight: 6 }} />
                    Verified Merchant Checkout
                  </span>
                  <span
                    data-testid="checkout-mode-badge"
                    style={{
                      fontSize: '.68rem',
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 6,
                      letterSpacing: '.04em',
                      textTransform: 'uppercase',
                      border: effectiveMode === 'live'
                        ? '1px solid rgba(52, 211, 153, 0.45)'
                        : selectedProv === 'cbe_bank'
                          ? '1px solid var(--border2)'
                          : '1px solid rgba(245, 158, 11, 0.45)',
                      color: effectiveMode === 'live'
                        ? '#34d399'
                        : selectedProv === 'cbe_bank'
                          ? 'var(--text-dim)'
                          : '#f59e0b',
                    }}
                  >
                    {selectedProv === 'cbe_bank'
                      ? 'Direct Bank'
                      : effectiveMode === 'live'
                        ? 'Live Gateway'
                        : 'Sandbox Test'}
                  </span>
                </div>
                <h1 style={{ fontSize: '1.35rem', margin: '6px 0 2px' }}>{data.merchant.name}</h1>
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
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, gap: 8 }}>
                <span style={{ color: 'var(--text-dim)' }}>Purpose</span>
                <strong style={{ textAlign: 'right' }}>{data.intent.description}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: isLocked ? 4 : 0 }}>
                <span style={{ color: 'var(--text-dim)' }}>Transaction Ref</span>
                <code>{data.intent.tx_ref}</code>
              </div>
              {isLocked && (
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ color: 'var(--text-dim)' }}>Selected Gateway</span>
                  <strong style={{ color: 'var(--accent)' }}>{providerDef?.name ?? selectedProv}</strong>
                </div>
              )}
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
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      disabled={downloadingReceipt}
                      onClick={() => {
                        if (!data) return
                        setDownloadingReceipt(true)
                        setInvoiceFeedback(null)
                        void fetchAndDownloadVerifiedPdfReceipt(data.intent.tx_ref, {
                          fallbackFilename: data.intent.invoice?.filename || `${data.intent.tx_ref}.pdf`,
                          pdfUrl: data.intent.invoice?.pdf_url,
                        })
                          .then((res) => {
                            setInvoiceFeedback(`Downloaded ${res.filename} (${Math.max(1, Math.round(res.sizeBytes / 1024))} KB).`)
                          })
                          .catch((err) => {
                            setInvoiceFeedback(err instanceof Error ? err.message : 'Unable to download PDF receipt.')
                          })
                          .finally(() => setDownloadingReceipt(false))
                      }}
                      data-testid="public-invoice-download"
                    >
                      <i
                        className={`fa-solid ${downloadingReceipt ? 'fa-spinner fa-spin' : 'fa-download'}`}
                        aria-hidden="true"
                      />{' '}
                      {downloadingReceipt ? 'Preparing PDF…' : 'Download PDF Receipt'}
                    </button>
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
              <form onSubmit={handleGatewaySubmit}>
                <div style={{ marginBottom: 14 }}>
                  <span className="pl-field-label" style={{ display: 'block', marginBottom: 8 }}>
                    {isLocked ? 'Payment Method' : 'Select Payment Method'}
                  </span>
                  <div
                    style={{ display: 'grid', gridTemplateColumns: isLocked ? '1fr' : 'repeat(auto-fit, minmax(145px, 1fr))', gap: 8 }}
                    role="radiogroup"
                    aria-label="Payment method"
                    data-testid="public-gateway-options"
                  >
                    {data.enabled_gateways.map((gw) => {
                      const def = PAYMENT_PROVIDERS[gw.provider]
                      const active = selectedProv === gw.provider
                      return (
                        <button
                          key={gw.provider}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          data-testid={`public-gw-${gw.provider}`}
                          className={`pl-btn ${active ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
                          style={{ justifyContent: 'space-between', padding: '10px 12px', fontSize: '.85rem' }}
                          onClick={() => {
                            if (isLocked) return
                            setSelectedProv(gw.provider)
                            setInitState(null)
                            setError(null)
                            setVerifyNotice(null)
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <i className={def?.icon || 'fa-solid fa-credit-card'} aria-hidden="true" />
                            <span>{isLocked ? (def?.name || gw.provider) : getGatewayShortLabel(gw.provider)}</span>
                          </span>
                          {isLocked && (
                            <span style={{ fontSize: '.7rem', opacity: 0.85, textTransform: 'uppercase' }}>
                              Locked
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Live pre-initialized hosted redirect banner */}
                {data.intent.external_checkout_url && effectiveMode === 'live' && (selectedProv === 'chapa' || selectedProv === 'telebirr') && (
                  <div
                    data-testid="live-hosted-redirect-box"
                    style={{ padding: 12, borderRadius: 10, border: '1px solid var(--accent)', marginBottom: 14, fontSize: '.85rem' }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      {providerDef?.name} Session Ready
                    </div>
                    <p style={{ color: 'var(--text-dim)', margin: '0 0 10px' }}>
                      Complete payment directly on {getGatewayShortLabel(selectedProv)}, then verify status below.
                    </p>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a className="pl-btn pl-btn-primary pl-btn-sm" href={data.intent.external_checkout_url}>
                        Continue to {getGatewayShortLabel(selectedProv)}
                      </a>
                      <button
                        type="button"
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        disabled={verifying}
                        onClick={() => void verifyCheckout(false)}
                      >
                        {verifying ? 'Checking…' : 'Verify Completed Payment'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Gateway destination details / protocol note */}
                {selectedProv === 'cbe_bank' ? (
                  activeGateway?.public_config?.settlement_account && (
                    <div style={{ padding: 11, borderRadius: 10, border: '1px dashed var(--border2)', marginBottom: 14, fontSize: '.84rem' }}>
                      <div style={{ color: 'var(--text-dim)', marginBottom: 2 }}>Merchant Destination Account / Wallet</div>
                      <strong>{activeGateway.public_config.bank_name ? `${activeGateway.public_config.bank_name} · ` : ''}{activeGateway.public_config.settlement_account}</strong>
                      {activeGateway.public_config.account_holder && (
                        <div style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>Beneficiary: {activeGateway.public_config.account_holder}</div>
                      )}
                    </div>
                  )
                ) : (
                  <div style={{ padding: 11, borderRadius: 10, border: '1px dashed var(--border2)', marginBottom: 14, fontSize: '.83rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                      <strong>{providerDef?.name}</strong>
                      {activeGateway?.public_config?.merchant_id && (
                        <code>Shortcode {activeGateway.public_config.merchant_id}</code>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-dim)' }}>
                      {providerDef?.tagline}
                      {activeGateway?.public_config?.settlement_account
                        ? ` · Wallet ${activeGateway.public_config.settlement_account}`
                        : ''}
                    </div>
                  </div>
                )}

                {/* M-Pesa STK Push Waiting / Sandbox Prompt State */}
                {initState && (initState.action === 'stk_poll' || initState.action === 'sandbox_stk') ? (
                  <div
                    data-testid="mpesa-stk-panel"
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: '1px solid var(--accent)',
                      background: 'var(--input)',
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      <i className="fa-solid fa-sim-card" aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 6 }} />
                      {initState.action === 'stk_poll' ? 'M-Pesa STK Push Sent to Phone' : 'M-Pesa Sandbox STK Prompt'}
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', margin: '0 0 10px' }}>
                      {initState.customer_message}
                    </p>
                    <div style={{ fontSize: '.8rem', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                      <div>Subscriber MSISDN: <code>{initState.msisdn || payerPhone}</code></div>
                      <div>Checkout Request ID: <code>{initState.checkout_request_id}</code></div>
                    </div>

                    {initState.action === 'sandbox_stk' && (
                      <div className="pl-field" style={{ marginBottom: 12 }}>
                        <label className="pl-field-label" htmlFor="payer-ref">Sandbox M-Pesa Receipt / Confirmation ID</label>
                        <input
                          id="payer-ref"
                          className="pl-input"
                          placeholder={initState.checkout_request_id || 'e.g. MPESA-QKL901'}
                          value={payerRef}
                          onChange={(e) => setPayerRef(e.target.value)}
                        />
                      </div>
                    )}

                    {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.86rem', marginBottom: 10 }}>{error}</p>}
                    {verifyNotice && <p role="status" style={{ color: '#f59e0b', fontSize: '.84rem', marginBottom: 10 }}>{verifyNotice}</p>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {initState.action === 'stk_poll' ? (
                        <button
                          type="button"
                          className="pl-btn pl-btn-primary"
                          style={{ flex: 1, justifyContent: 'center' }}
                          disabled={verifying}
                          onClick={() => void verifyCheckout(false)}
                          data-testid="mpesa-verify-stk-btn"
                        >
                          {verifying ? 'Checking Safaricom M-Pesa…' : 'Check M-Pesa Payment Status'}
                        </button>
                      ) : (
                        <button
                          type="submit"
                          className="pl-btn pl-btn-primary"
                          style={{ flex: 1, justifyContent: 'center' }}
                          disabled={busy}
                          data-testid="mpesa-approve-sandbox-btn"
                        >
                          {busy ? 'Confirming…' : 'Authorize Sandbox STK Push'}
                        </button>
                      )}
                      <button
                        type="button"
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        onClick={() => {
                          setInitState(null)
                          setError(null)
                        }}
                      >
                        Change Phone
                      </button>
                    </div>
                  </div>
                ) : initState && initState.action === 'sandbox_authorize' ? (
                  /* Chapa / Telebirr explicit Sandbox Authorization Step */
                  <div
                    data-testid="sandbox-authorize-panel"
                    style={{
                      padding: 14,
                      borderRadius: 10,
                      border: '1px solid rgba(245, 158, 11, 0.45)',
                      background: 'var(--input)',
                      marginBottom: 14,
                    }}
                  >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                      <i className="fa-solid fa-flask" aria-hidden="true" style={{ color: '#f59e0b', marginRight: 6 }} />
                      {providerDef?.name} · Sandbox Authorization
                    </div>
                    <p style={{ color: 'var(--text-dim)', fontSize: '.84rem', margin: '0 0 12px' }}>
                      {initState.customer_message || 'Live merchant credentials are not active for this gateway yet. Complete this sandbox test authorization to verify settlement and PDF invoice generation.'}
                    </p>
                    <div className="pl-field">
                      <label className="pl-field-label" htmlFor="payer-ref">
                        {selectedProv === 'telebirr' ? 'Telebirr Test Wallet / Sandbox Ref' : 'Sandbox Payment Reference'}
                      </label>
                      <input
                        id="payer-ref"
                        className="pl-input"
                        required
                        placeholder={selectedProv === 'telebirr' ? 'e.g. +251911223344 or TB-SBX-101' : 'e.g. CHAPA-SBX-101'}
                        value={payerRef}
                        onChange={(e) => setPayerRef(e.target.value)}
                      />
                    </div>

                    {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.86rem', marginBottom: 10 }}>{error}</p>}

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="submit"
                        className="pl-btn pl-btn-primary"
                        style={{ flex: 1, justifyContent: 'center' }}
                        disabled={busy}
                        data-testid="sandbox-confirm-btn"
                      >
                        <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
                        {busy ? 'Settling Sandbox Payment…' : `Authorize ${fmtMoney(data.intent.amount)} ${data.intent.currency} (Sandbox)`}
                      </button>
                      <button
                        type="button"
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        onClick={() => {
                          setInitState(null)
                          setError(null)
                        }}
                      >
                        Back
                      </button>
                    </div>
                  </div>
                ) : (
                  /* Step 1: Collect Customer Details & Protocol Inputs */
                  <>
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
                      <label className="pl-field-label" htmlFor="payer-email">
                        {selectedProv === 'chapa'
                          ? 'Receipt Email (Required by Chapa)'
                          : selectedProv === 'telebirr'
                            ? 'Send Receipt to Email (Optional)'
                            : 'Receipt Email (for PDF Invoice)'}
                      </label>
                      <input
                        id="payer-email"
                        type="email"
                        className="pl-input"
                        required={selectedProv === 'chapa'}
                        placeholder="you@company.com"
                        value={payerEmail}
                        onChange={(e) => setPayerEmail(e.target.value)}
                      />
                    </div>

                    {selectedProv === 'mpesa' && (
                      <div className="pl-field">
                        <label className="pl-field-label" htmlFor="payer-phone">Safaricom M-Pesa Mobile Number</label>
                        <input
                          id="payer-phone"
                          className="pl-input"
                          required
                          placeholder="+251 711 223344 or 0711223344"
                          value={payerPhone}
                          onChange={(e) => setPayerPhone(e.target.value)}
                        />
                      </div>
                    )}

                    {selectedProv === 'telebirr' && (
                      <div className="pl-field">
                        <label className="pl-field-label" htmlFor="payer-phone">Telebirr Wallet Phone (Optional)</label>
                        <input
                          id="payer-phone"
                          className="pl-input"
                          placeholder="+251 911 000000"
                          value={payerPhone}
                          onChange={(e) => setPayerPhone(e.target.value)}
                        />
                      </div>
                    )}

                    {selectedProv === 'cbe_bank' && (
                      <div className="pl-field">
                        <label className="pl-field-label" htmlFor="payer-ref">Bank Transfer / FT Reference</label>
                        <input
                          id="payer-ref"
                          className="pl-input"
                          required
                          placeholder="e.g. FT2611500912"
                          value={payerRef}
                          onChange={(e) => setPayerRef(e.target.value)}
                        />
                      </div>
                    )}

                    {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.86rem', marginBottom: 10 }}>{error}</p>}
                    {verifyNotice && <p role="status" style={{ color: '#f59e0b', fontSize: '.84rem', marginBottom: 10 }}>{verifyNotice}</p>}

                    <button
                      type="submit"
                      className="pl-btn pl-btn-primary"
                      style={{ width: '100%', justifyContent: 'center' }}
                      disabled={busy}
                      data-testid="public-pay-submit"
                    >
                      <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
                      {busy
                        ? 'Connecting to Gateway…'
                        : selectedProv === 'mpesa'
                          ? `Send M-Pesa STK Push · ${fmtMoney(data.intent.amount)} ${data.intent.currency}`
                          : selectedProv === 'telebirr'
                            ? `Pay ${fmtMoney(data.intent.amount)} ${data.intent.currency} with Telebirr`
                            : selectedProv === 'chapa'
                              ? `Pay ${fmtMoney(data.intent.amount)} ${data.intent.currency} with Chapa`
                              : `Confirm CBE Transfer · ${fmtMoney(data.intent.amount)} ${data.intent.currency}`}
                    </button>
                  </>
                )}
              </form>
            )}
          </>
        )}
      </div>
    </main>
  )
}
