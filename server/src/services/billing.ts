import crypto from 'crypto'
import type { PoolClient } from 'pg'
import { pool } from '../config/db.js'
import { AppError } from '../utils/helpers.js'
import { telebirrConfigured, telebirrInitialize, telebirrQueryStatus } from './payments/telebirr.js'
import { mpesaConfigured, mpesaInitialize, mpesaQueryStatus } from './payments/mpesa.js'
import { cbeConfigured, cbeInitialize } from './payments/cbe.js'

/* â”€â”€ Provider selection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
   Chapa (chapa.co) remains the default provider. Telebirr, M-Pesa
   (Safaricom ET) and CBE Birr are ported from the yekis project and
   can be selected per-checkout via the `provider` parameter. If no
   provider at all is configured and we are outside production, a
   mock provider lets the whole flow be tested end-to-end locally. */

const CHAPA_SECRET = process.env.CHAPA_SECRET_KEY || ''
const CHAPA_WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET || ''
const CHAPA_API = 'https://api.chapa.co/v1'

export type PaymentProvider = 'chapa' | 'telebirr' | 'mpesa' | 'cbe' | 'mock'

export function isPaymentProvider(v: unknown): v is PaymentProvider {
  return v === 'chapa' || v === 'telebirr' || v === 'mpesa' || v === 'cbe' || v === 'mock'
}

/** True when a provider has the credentials it needs to accept payments. */
export function providerConfigured(provider: PaymentProvider): boolean {
  switch (provider) {
    case 'chapa': return Boolean(CHAPA_SECRET)
    case 'telebirr': return telebirrConfigured()
    case 'mpesa': return mpesaConfigured()
    case 'cbe': return cbeConfigured()
    case 'mock': return process.env.NODE_ENV !== 'production'
  }
}

/** Providers exposed to the checkout UI, with availability flags. */
export function listProviders(): { id: PaymentProvider; name: string; configured: boolean }[] {
  return [
    { id: 'chapa', name: 'Chapa', configured: providerConfigured('chapa') },
    { id: 'telebirr', name: 'Telebirr', configured: providerConfigured('telebirr') },
    { id: 'mpesa', name: 'M-Pesa', configured: providerConfigured('mpesa') },
    { id: 'cbe', name: 'CBE Birr (bank transfer)', configured: providerConfigured('cbe') },
  ]
}

/**
 * Resolve the provider for a checkout: an explicitly requested provider is
 * validated for availability; otherwise the default (first configured, with
 * Chapa preferred) is used.
 */
export function resolveProvider(requested?: string): PaymentProvider {
  if (requested !== undefined) {
    if (!isPaymentProvider(requested)) {
      throw new AppError(400, 'Unknown payment provider. Supported: chapa, telebirr, mpesa, cbe.', 'BAD_PROVIDER')
    }
    if (!providerConfigured(requested)) {
      throw new AppError(503, `${requested} payments are not configured yet. Contact AFRO-TECH.`, 'PAYMENTS_NOT_CONFIGURED')
    }
    return requested
  }
  if (CHAPA_SECRET) return 'chapa'
  if (telebirrConfigured()) return 'telebirr'
  if (mpesaConfigured()) return 'mpesa'
  if (cbeConfigured()) return 'cbe'
  if (process.env.NODE_ENV === 'production')
    throw new AppError(503, 'Online payments are not configured yet. Contact AFRO-TECH.', 'PAYMENTS_NOT_CONFIGURED')
  return 'mock'
}

export interface CheckoutInput {
  txRef: string
  amount: number
  currency: string
  email: string
  fullName: string
  planName: string
  returnUrl: string
  callbackUrl: string
}

export interface VerifyResult {
  success: boolean
  /** true = provider has no final answer yet; do not mark the payment failed. */
  pending?: boolean
  providerRef: string | null
  amount: number | null
  currency: string | null
  payerEmail: string | null
  failureReason: string | null
}

/* â”€â”€ Chapa â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

async function chapaRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${CHAPA_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${CHAPA_SECRET}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as { status?: string; message?: string } | null
  if (!res.ok) throw new AppError(502, data?.message || `Payment provider error (${res.status})`, 'GATEWAY_ERROR')
  return data as T
}

export async function chapaInitialize(input: CheckoutInput): Promise<string> {
  const [firstName, ...rest] = input.fullName.trim().split(/\s+/)
  const data = await chapaRequest<{ data?: { checkout_url?: string } }>('POST', '/transaction/initialize', {
    amount: input.amount.toFixed(2),
    currency: input.currency,
    email: input.email,
    first_name: firstName,
    last_name: rest.join(' ') || firstName,
    tx_ref: input.txRef,
    callback_url: input.callbackUrl,
    return_url: input.returnUrl,
    'customization[title]': 'AFRO Suite Subscription',
    'customization[description]': `${input.planName} subscription`,
  })
  const url = data?.data?.checkout_url
  if (!url) throw new AppError(502, 'Payment provider did not return a checkout link', 'GATEWAY_ERROR')
  return url
}

export async function chapaVerify(txRef: string): Promise<VerifyResult> {
  const data = await chapaRequest<{ data?: Record<string, unknown> }>('GET', `/transaction/verify/${encodeURIComponent(txRef)}`)
  const d = data?.data ?? {}
  const ok = String(d.status ?? '').toLowerCase() === 'success'
  return {
    success: ok,
    providerRef: (d.reference as string) ?? (d.trx_ref as string) ?? null,
    amount: d.amount != null ? Number(d.amount) : null,
    currency: (d.currency as string) ?? null,
    payerEmail: (d.email as string) ?? null,
    failureReason: ok ? null : `Provider status: ${String(d.status ?? 'unknown')}`,
  }
}

/** Chapa webhook signature: x-chapa-signature (HMAC) or chapa-signature (raw secret hash). */
export function chapaWebhookSignatureValid(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): boolean {
  if (!CHAPA_WEBHOOK_SECRET) return false
  const raw = headers['chapa-signature']
  if (typeof raw === 'string' && raw.length > 0 && timingSafeEq(raw, CHAPA_WEBHOOK_SECRET)) return true
  const sig = headers['x-chapa-signature']
  if (typeof sig === 'string' && sig.length > 0) {
    const expected = crypto.createHmac('sha256', CHAPA_WEBHOOK_SECRET).update(rawBody).digest('hex')
    if (timingSafeEq(sig, expected)) return true
    try {
      const expectedRaw = crypto.createHmac('sha256', CHAPA_WEBHOOK_SECRET).update(rawBody).digest()
      if (timingSafeEqBuffer(Buffer.from(sig, 'hex'), expectedRaw)) return true
    } catch {
      /* not hex */
    }
  }
  return false
}

function timingSafeEq(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return timingSafeEqBuffer(ba, bb)
}
function timingSafeEqBuffer(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false
  return crypto.timingSafeEqual(a, b)
}

/* â”€â”€ Settlement: the single, idempotent activation path â”€â”€â”€â”€â”€â”€
   Used by verify, webhook and manual confirmation. Safe to call
   repeatedly for the same payment â€” the row lock + status check
   guarantee subscription time is granted exactly once. */

export interface PaymentRow {
  id: string
  tenant_id: string
  plan_id: string | null
  tx_ref: string
  amount: string
  currency: string
  period_months: number
  status: 'pending' | 'success' | 'failed' | 'refunded'
}

export async function settlePaymentSuccess(poolLike: { connect: () => Promise<PoolClient> }, paymentId: string): Promise<{ alreadyProcessed: boolean; periodEnd: Date | null }> {
  const client = await poolLike.connect()
  try {
    await client.query('BEGIN')

    const { rows: payRows } = await client.query<PaymentRow>(
      `SELECT id, tenant_id, plan_id, tx_ref, amount::text, currency, period_months, status
       FROM payments WHERE id = $1 FOR UPDATE`,
      [paymentId]
    )
    const payment = payRows[0]
    if (!payment) throw new AppError(404, 'Payment not found', 'NOT_FOUND')
    if (payment.status === 'success') {
      const sub = await client.query<{ current_period_end: Date }>(
        `SELECT current_period_end FROM subscriptions WHERE tenant_id = $1`,
        [payment.tenant_id]
      )
      await client.query('COMMIT')
      return { alreadyProcessed: true, periodEnd: sub.rows[0]?.current_period_end ?? null }
    }
    if (payment.status !== 'pending') throw new AppError(409, `Payment is ${payment.status}`, 'BAD_STATE')

    // Lock the tenant row so concurrent settlements stack correctly.
    await client.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [payment.tenant_id])

    const { rows: subRows } = await client.query<{ current_period_start: Date; current_period_end: Date }>(
      `SELECT current_period_start, current_period_end FROM subscriptions WHERE tenant_id = $1 AND status = 'active'`,
      [payment.tenant_id]
    )
    const now = new Date()
    const existing = subRows[0] && new Date(subRows[0].current_period_end) > now ? subRows[0] : null
    // Stack on top of an unexpired period; otherwise start a fresh one now.
    const periodStart = existing ? new Date(existing.current_period_start) : now
    const base = existing ? new Date(existing.current_period_end) : now
    const end = new Date(base)
    end.setMonth(end.getMonth() + payment.period_months)

    await client.query(
      `INSERT INTO subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end, updated_at)
       VALUES ($1, $2, 'active', $3, $4, now())
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan_id = EXCLUDED.plan_id,
         status = 'active',
         current_period_start = EXCLUDED.current_period_start,
         current_period_end = EXCLUDED.current_period_end,
         updated_at = now()`,
      [payment.tenant_id, payment.plan_id, periodStart.toISOString(), end.toISOString()]
    )

    await client.query(
      `UPDATE payments SET status = 'success', paid_at = now(), updated_at = now() WHERE id = $1`,
      [paymentId]
    )

    // Access for the whole workspace is keyed off tenants.status + trial_ends_at.
    await client.query(
      `UPDATE tenants SET status = 'active', trial_ends_at = $2, updated_at = now() WHERE id = $1`,
      [payment.tenant_id, end.toISOString()]
    )

    await client.query(
      `INSERT INTO audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
       VALUES ($1, NULL, 'system', 'billing.payment.success', 'payment', $2, $3)`,
      [payment.tenant_id, paymentId, JSON.stringify({ tx_ref: payment.tx_ref, amount: payment.amount, months: payment.period_months })]
    )

    await client.query('COMMIT')
    return { alreadyProcessed: false, periodEnd: end }
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Mark a pending payment failed (idempotent). */
export async function markPaymentFailed(paymentId: string, reason: string): Promise<void> {
  await pool.query(
    `UPDATE payments SET status = 'failed', failure_reason = $2, updated_at = now()
     WHERE id = $1 AND status = 'pending'`,
    [paymentId, reason.slice(0, 300)]
  )
}

/* -- Multi-provider dispatch (Telebirr / M-Pesa / CBE ported from yekis) -- */

export interface ProviderCheckoutResult {
  /** Hosted checkout URL to redirect the customer to; null for mock/CBE manual flows. */
  checkoutUrl: string | null
  /** Provider-side reference (Telebirr merch_order_id); stored on payments.provider_ref. */
  providerRef: string | null
}

function telebirrNotifyUrl(): string | undefined {
  if (process.env.TELEBIRR_NOTIFY_URL) return process.env.TELEBIRR_NOTIFY_URL
  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '')
  return base ? `${base}/api/v1/billing/webhook/telebirr` : undefined
}

/** Initiate a checkout with the chosen provider. */
export async function initializeCheckout(provider: PaymentProvider, input: CheckoutInput): Promise<ProviderCheckoutResult> {
  switch (provider) {
    case 'chapa':
      return { checkoutUrl: await chapaInitialize(input), providerRef: null }
    case 'telebirr': {
      const r = await telebirrInitialize({
        txRef: input.txRef,
        amount: input.amount,
        currency: input.currency,
        title: `AFRO Suite - ${input.planName}`,
        notifyUrl: telebirrNotifyUrl(),
        returnUrl: input.returnUrl,
      })
      return { checkoutUrl: r.checkoutUrl, providerRef: r.providerRef }
    }
    case 'mpesa': {
      const r = await mpesaInitialize({ txRef: input.txRef, amount: input.amount, currency: input.currency, title: `AFRO Suite - ${input.planName}` })
      return { checkoutUrl: r.checkoutUrl, providerRef: r.providerRef }
    }
    case 'cbe': {
      const r = await cbeInitialize({ txRef: input.txRef, amount: input.amount, currency: input.currency, title: `AFRO Suite - ${input.planName}` })
      return { checkoutUrl: r.checkoutUrl, providerRef: r.providerRef }
    }
    case 'mock':
      return { checkoutUrl: null, providerRef: `mock-${input.txRef}` }
  }
}

/**
 * Verify/query a payment\'s status with its own provider.
 * `pending: true` means "no final answer yet" (do NOT mark the payment failed).
 */
export async function verifyByProvider(provider: PaymentProvider, txRef: string, providerRef: string | null): Promise<VerifyResult> {
  switch (provider) {
    case 'chapa':
      return chapaVerify(txRef)
    case 'telebirr': {
      if (!providerRef) return { success: false, pending: true, providerRef: null, amount: null, currency: null, payerEmail: null, failureReason: 'Awaiting Telebirr confirmation' }
      const r = await telebirrQueryStatus(providerRef)
      if (!r || r.status === 'PENDING') {
        return { success: false, pending: true, providerRef, amount: null, currency: null, payerEmail: null, failureReason: 'Awaiting Telebirr confirmation' }
      }
      return {
        success: r.status === 'SUCCESS',
        providerRef,
        amount: null,
        currency: null,
        payerEmail: null,
        failureReason: r.status === 'FAILED' ? 'Telebirr reports the payment failed or was cancelled' : null,
      }
    }
    case 'mpesa': {
      const r = await mpesaQueryStatus(txRef)
      if (!r || r.status === 'PENDING') {
        return { success: false, pending: true, providerRef, amount: null, currency: null, payerEmail: null, failureReason: 'Awaiting M-Pesa confirmation' }
      }
      return {
        success: r.status === 'SUCCESS',
        providerRef,
        amount: null,
        currency: null,
        payerEmail: null,
        failureReason: r.status === 'FAILED' ? 'M-Pesa reports the payment failed or was cancelled' : null,
      }
    }
    case 'cbe':
      // No queryable API yet - the payment is confirmed by webhook or manual admin action.
      return { success: false, pending: true, providerRef, amount: null, currency: null, payerEmail: null, failureReason: 'Awaiting CBE Birr transfer confirmation' }
    case 'mock':
      return { success: false, pending: true, providerRef, amount: null, currency: null, payerEmail: null, failureReason: 'In mock mode, complete the payment from the developer console' }
  }
}
