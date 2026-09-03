import crypto from 'crypto'
import type { PoolClient } from 'pg'
import { pool } from '../config/db.js'
import { AppError } from '../utils/helpers.js'

/* ── Provider selection ───────────────────────────────────────
   Chapa (chapa.co) is the primary provider. If no secret key is
   configured and we are outside production, a mock provider lets
   the whole flow be tested end-to-end locally. */

const CHAPA_SECRET = process.env.CHAPA_SECRET_KEY || ''
const CHAPA_WEBHOOK_SECRET = process.env.CHAPA_WEBHOOK_SECRET || ''
const CHAPA_API = 'https://api.chapa.co/v1'

export type PaymentProvider = 'chapa' | 'mock'

export function paymentsProvider(): PaymentProvider {
  if (CHAPA_SECRET) return 'chapa'
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
  providerRef: string | null
  amount: number | null
  currency: string | null
  payerEmail: string | null
  failureReason: string | null
}

/* ── Chapa ────────────────────────────────────────────────── */

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

/* ── Settlement: the single, idempotent activation path ──────
   Used by verify, webhook and manual confirmation. Safe to call
   repeatedly for the same payment — the row lock + status check
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
