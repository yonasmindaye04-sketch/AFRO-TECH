import { Router, type Request } from 'express'
import crypto from 'crypto'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, withTransaction } from '../utils/helpers.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  resolveProvider,
  providerConfigured,
  listProviders,
  initializeCheckout,
  verifyByProvider,
  chapaVerify,
  chapaWebhookSignatureValid,
  settlePaymentSuccess,
  markPaymentFailed,
  type PaymentProvider,
} from '../services/billing.js'
import { telebirrVerifyWebhook } from '../services/payments/telebirr.js'
import { mpesaWebhookSignatureValid } from '../services/payments/mpesa.js'
import { cbeWebhookSignatureValid } from '../services/payments/cbe.js'

const router = Router()

const RETURN_URL_DEFAULT = () => {
  const base = (process.env.PUBLIC_URL || '').split(',')[0] || 'http://localhost:5173'
  return `${base.replace(/\/$/, '')}/app/subscription`
}
const CALLBACK_URL_DEFAULT = () => `${(process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '') || RETURN_URL_DEFAULT()}/api/v1/billing/webhook/chapa`

/* ── Public webhook (no auth) — must receive raw body for HMAC ── */
router.post(
  '/webhook/chapa',
  asyncHandler(async (req: Request, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
    if (process.env.CHAPA_WEBHOOK_SECRET) {
      const headers = req.headers as Record<string, string | string[] | undefined>
      if (!chapaWebhookSignatureValid(raw, headers)) throw new AppError(401, 'Invalid webhook signature', 'BAD_SIGNATURE')
    }

    const body = req.body as { tx_ref?: string; status?: string; reference?: string } | null
    const txRef = body?.tx_ref
    if (!txRef) return res.json({ ok: true, ignored: true })

    const payment = await queryOne<{ id: string; tx_ref: string }>(`SELECT id, tx_ref FROM payments WHERE tx_ref = $1`, [txRef])
    if (!payment) {
      await pool.query(`INSERT INTO payment_webhook_events (provider, event_ref, payload) VALUES ('chapa', $1, $2)`, [
        txRef,
        JSON.stringify(body ?? {}),
      ])
      return res.json({ ok: true, ignored: true })
    }

    await pool.query(
      `INSERT INTO payment_webhook_events (provider, event_ref, payload) VALUES ('chapa', $1, $2)
       ON CONFLICT DO NOTHING`,
      [txRef, JSON.stringify(body ?? {})]
    )

    if (!providerConfigured('chapa')) return res.json({ ok: true })

    const verified = await chapaVerify(txRef)
    if (verified.success) await settlePaymentSuccess(pool, payment.id)
    else await markPaymentFailed(payment.id, verified.failureReason || 'webhook reported failure')

    res.json({ ok: true })
  })
)

/* ── Telebirr webhook (public) — RSA-PSS signature embedded in the JSON body ── */
router.post(
  '/webhook/telebirr',
  asyncHandler(async (req: Request, res) => {
    // Telebirr expects this exact acknowledgement shape.
    const ack = () => res.json({ code: 0, msg: 'success' })
    const raw = ((req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))).toString('utf8')

    const result = telebirrVerifyWebhook(raw)
    if (!result.valid) throw new AppError(401, 'Invalid webhook signature', 'BAD_SIGNATURE')
    if (!result.merchOrderId) return ack()

    await pool.query(
      `INSERT INTO payment_webhook_events (provider, event_ref, payload) VALUES ('telebirr', $1, $2) ON CONFLICT DO NOTHING`,
      [result.merchOrderId, raw]
    )

    const payment = await queryOne<{ id: string }>(
      `SELECT id FROM payments WHERE provider = 'telebirr' AND (provider_ref = $1 OR tx_ref = $1)`,
      [result.merchOrderId]
    )
    if (!payment) return ack()

    if (result.status === 'SUCCESS') await settlePaymentSuccess(pool, payment.id)
    else if (result.status === 'FAILED')
      await markPaymentFailed(payment.id, `Telebirr trade_status: ${result.tradeStatus || 'FAILED'}`)
    // PENDING: acknowledge and wait for the final webhook / reconciliation sweep
    return ack()
  })
)

/* ── M-Pesa webhook (public) — HMAC-SHA256 in x-mpesa-signature ── */
router.post(
  '/webhook/mpesa',
  asyncHandler(async (req: Request, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
    if (process.env.MPESA_CALLBACK_SECRET) {
      const sig = req.headers['x-mpesa-signature'] as string | undefined
      if (!mpesaWebhookSignatureValid(raw.toString('utf8'), sig)) throw new AppError(401, 'Invalid webhook signature', 'BAD_SIGNATURE')
    }

    const body = req.body as { tx_ref?: string; reference?: string; status?: string } | null
    const txRef = body?.tx_ref || body?.reference
    if (!txRef) return res.json({ ok: true, ignored: true })

    await pool.query(
      `INSERT INTO payment_webhook_events (provider, event_ref, payload) VALUES ('mpesa', $1, $2) ON CONFLICT DO NOTHING`,
      [txRef, JSON.stringify(body ?? {})]
    )

    const payment = await queryOne<{ id: string }>(`SELECT id FROM payments WHERE provider = 'mpesa' AND tx_ref = $1`, [txRef])
    if (!payment) return res.json({ ok: true, ignored: true })

    const s = String(body?.status ?? '').toLowerCase()
    if (['success', 'completed'].includes(s)) await settlePaymentSuccess(pool, payment.id)
    else if (['fail', 'failed', 'closed', 'cancelled'].includes(s)) await markPaymentFailed(payment.id, `M-Pesa status: ${s || 'FAILED'}`)

    res.json({ ok: true })
  })
)

/* ── CBE Birr webhook (public) — HMAC-SHA256 in x-cbe-signature ── */
router.post(
  '/webhook/cbe',
  asyncHandler(async (req: Request, res) => {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}))
    if (process.env.CBE_WEBHOOK_SECRET) {
      const sig = req.headers['x-cbe-signature'] as string | undefined
      if (!cbeWebhookSignatureValid(raw.toString('utf8'), sig)) throw new AppError(401, 'Invalid webhook signature', 'BAD_SIGNATURE')
    }

    const body = req.body as { tx_ref?: string; reference?: string; status?: string } | null
    const txRef = body?.tx_ref || body?.reference
    if (!txRef) return res.json({ ok: true, ignored: true })

    await pool.query(
      `INSERT INTO payment_webhook_events (provider, event_ref, payload) VALUES ('cbe', $1, $2) ON CONFLICT DO NOTHING`,
      [txRef, JSON.stringify(body ?? {})]
    )

    const payment = await queryOne<{ id: string }>(`SELECT id FROM payments WHERE provider = 'cbe' AND tx_ref = $1`, [txRef])
    if (!payment) return res.json({ ok: true, ignored: true })

    const s = String(body?.status ?? '').toLowerCase()
    if (['success', 'completed'].includes(s)) await settlePaymentSuccess(pool, payment.id)
    else if (['fail', 'failed', 'closed', 'cancelled'].includes(s)) await markPaymentFailed(payment.id, `CBE Birr status: ${s || 'FAILED'}`)

    res.json({ ok: true })
  })
)

/* ── Authenticated routes ── */
router.use(authenticate)

/** GET /api/v1/billing/plans — plans offered for the caller's business type (owner only) */
router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const type = req.user?.tenant_id ? (await queryOne<{ business_type: string }>(`SELECT business_type FROM tenants WHERE id = $1`, [req.user.tenant_id]))?.business_type : null
    const rows = await query<{
      id: string
      code: string
      name: string
      business_types: string[]
      price_monthly: string
      price_semiannual: string
      price_annual: string
      description: string
      features: string[]
    }>(
      `SELECT id, code, name, business_types, price_monthly::text, price_semiannual::text, price_annual::text,
              description, features
       FROM subscription_plans
       WHERE is_active = true
         AND (cardinality(business_types) = 0 OR $1::text = ANY(business_types))
       ORDER BY sort`,
      [type ?? '']
    )
    res.json({ plans: rows })
  })
)

/** GET /api/v1/billing/providers — payment providers available for checkout */
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({ providers: listProviders() })
  })
)

/** GET /api/v1/billing/subscription — current subscription + access end */
router.get(
  '/subscription',
  asyncHandler(async (req, res) => {
    const tid = req.user?.tenant_id
    if (!tid) throw new AppError(403, 'Subscription is for workspace accounts', 'NO_TENANT')
    const sub = await queryOne<{
      id: string
      plan_id: string
      plan_code: string
      plan_name: string
      status: 'active' | 'expired' | 'cancelled'
      current_period_start: Date
      current_period_end: Date
      amount_last: string | null
    }>(
      `SELECT s.id, s.plan_id, p.code AS plan_code, p.name AS plan_name,
              s.status, s.current_period_start, s.current_period_end,
              (SELECT amount::text FROM payments WHERE tenant_id = s.tenant_id AND status = 'success'
               ORDER BY paid_at DESC LIMIT 1) AS amount_last
       FROM subscriptions s
       JOIN subscription_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = $1`,
      [tid]
    )
    const tenant = await queryOne<{ status: string; trial_ends_at: Date }>(
      `SELECT status, trial_ends_at FROM tenants WHERE id = $1`,
      [tid]
    )
    res.json({
      subscription: sub ?? null,
      tenant_status: tenant?.status ?? null,
      access_until: sub?.current_period_end ?? tenant?.trial_ends_at ?? null,
    })
  })
)

/** GET /api/v1/billing/payments — payment history (owner) */
router.get(
  '/payments',
  asyncHandler(async (req, res) => {
    const tid = req.user?.tenant_id
    if (!tid) throw new AppError(403, 'Subscription is for workspace accounts', 'NO_TENANT')
    const rows = await query<{
      id: string
      tx_ref: string
      provider: string
      amount: string
      currency: string
      period_months: number
      status: 'pending' | 'success' | 'failed' | 'refunded'
      paid_at: Date | null
      created_at: Date
      plan_name: string | null
      failure_reason: string | null
    }>(
      `SELECT pay.id, pay.tx_ref, pay.provider, pay.amount::text, pay.currency, pay.period_months,
              pay.status, pay.paid_at, pay.created_at, pay.failure_reason,
              sp.name AS plan_name
       FROM payments pay
       LEFT JOIN subscription_plans sp ON sp.id = pay.plan_id
       WHERE pay.tenant_id = $1
       ORDER BY pay.created_at DESC
       LIMIT 200`,
      [tid]
    )
    res.json({ payments: rows })
  })
)

/** POST /api/v1/billing/checkout — initialize a checkout (owner only) */
router.post(
  '/checkout',
  requireRole('owner'),
  validateBody(
    z.object({
      plan_code: z.string().min(1),
      period_months: z.number().int().refine((n) => [1, 6, 12].includes(n), 'Period must be 1, 6 or 12 months'),
      provider: z.string().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { plan_code, period_months, provider: requestedProvider } = req.body as { plan_code: string; period_months: number; provider?: string }
    const tid = req.user!.tenant_id
    if (!tid) throw new AppError(403, 'Subscription is for workspace accounts', 'NO_TENANT')

    const tenant = await queryOne<{ business_type: string; status: string }>(
      `SELECT business_type, status FROM tenants WHERE id = $1`,
      [tid]
    )
    if (!tenant) throw new AppError(404, 'Workspace not found', 'NOT_FOUND')

    const plan = await queryOne<{ id: string; code: string; name: string; business_types: string[]; price_monthly: string; price_semiannual: string; price_annual: string; is_active: boolean }>(
      `SELECT id, code, name, business_types, price_monthly::text, price_semiannual::text, price_annual::text, is_active
       FROM subscription_plans WHERE code = $1`,
      [plan_code]
    )
    if (!plan || !plan.is_active) throw new AppError(404, 'Plan not found', 'NOT_FOUND')
    if (plan.business_types.length && !plan.business_types.includes(tenant.business_type))
      throw new AppError(400, 'This plan is not available for your business type', 'PLAN_TYPE_MISMATCH')

    const amount = Number(period_months === 12 ? plan.price_annual : period_months === 6 ? plan.price_semiannual : plan.price_monthly)
    if (!(amount > 0)) throw new AppError(400, 'Invalid plan pricing', 'BAD_PRICE')

    const idempotencyKey = String(req.headers['idempotency-key'] || '').slice(0, 200) || null
    if (idempotencyKey) {
      const existing = await queryOne<{ id: string; tx_ref: string; status: string; amount: string; period_months: number }>(
        `SELECT id, tx_ref, status, amount::text, period_months FROM payments WHERE idempotency_key = $1`,
        [idempotencyKey]
      )
      if (existing) {
        return res.json({ payment_id: existing.id, tx_ref: existing.tx_ref, status: existing.status, amount: Number(existing.amount), period_months: existing.period_months, mock: false, idempotent_replay: true })
      }
    }

    const provider = resolveProvider(requestedProvider)
    const txRef = `afro-${tid.slice(0, 8)}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`

    const payment = await withTransaction(pool, async (client) => {
      const txResult = await client.query(
        `INSERT INTO payments (tenant_id, plan_id, idempotency_key, tx_ref, provider, amount, currency, period_months, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'ETB', $7, 'pending') RETURNING id`,
        [tid, plan.id, idempotencyKey, txRef, provider, amount, period_months]
      )
      return txResult.rows[0].id as string
    })

    let checkoutUrl: string | null = null
    try {
      const initiated = await initializeCheckout(provider, {
        txRef,
        amount,
        currency: 'ETB',
        email: req.user!.email,
        fullName: req.user!.full_name,
        planName: plan.name,
        returnUrl: RETURN_URL_DEFAULT() + `?tx_ref=${encodeURIComponent(txRef)}`,
        callbackUrl: CALLBACK_URL_DEFAULT(),
      })
      checkoutUrl = initiated.checkoutUrl
      if (initiated.providerRef) {
        await pool.query(`UPDATE payments SET provider_ref = $2 WHERE id = $1`, [payment, initiated.providerRef])
      }
    } catch (err) {
      await pool.query(`UPDATE payments SET status = 'failed', failure_reason = $2 WHERE id = $1`, [payment, (err as Error).message.slice(0, 300)])
      throw err
    }

    res.json({
      payment_id: payment,
      tx_ref: txRef,
      provider,
      status: 'pending',
      amount,
      currency: 'ETB',
      period_months,
      mock: provider === 'mock',
      checkout_url: checkoutUrl,
      return_url: RETURN_URL_DEFAULT() + `?tx_ref=${encodeURIComponent(txRef)}`,
    })
  })
)

/** POST /api/v1/billing/verify — server-side verify with the provider, then settle. */
router.post(
  '/verify',
  requireRole('owner'),
  validateBody(z.object({ tx_ref: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const { tx_ref } = req.body as { tx_ref: string }
    const payment = await queryOne<{ id: string; tenant_id: string; status: 'pending' | 'success' | 'failed' | 'refunded'; amount: string; currency: string; provider: string; provider_ref: string | null }>(
      `SELECT id, tenant_id, status, amount::text, currency, provider, provider_ref FROM payments WHERE tx_ref = $1 AND tenant_id = $2`,
      [tx_ref, req.user!.tenant_id]
    )
    if (!payment) throw new AppError(404, 'Payment not found', 'NOT_FOUND')

    if (payment.status === 'success') {
      const sub = await queryOne<{ current_period_end: Date }>(`SELECT current_period_end FROM subscriptions WHERE tenant_id = $1`, [payment.tenant_id])
      return res.json({ ok: true, already_processed: true, access_until: sub?.current_period_end ?? null })
    }
    if (payment.status !== 'pending') throw new AppError(409, `Payment is ${payment.status}`, 'BAD_STATE')

    const provider = (payment.provider || 'chapa') as PaymentProvider
    if (provider === 'mock') throw new AppError(400, 'In mock mode, complete the payment from the developer console', 'MOCK_MODE')

    const result = await verifyByProvider(provider, tx_ref, payment.provider_ref)
    if (!result.success) {
      if (result.pending) {
        // Provider has no final answer yet (e.g. customer still on the Telebirr
        // checkout page, or a manual CBE transfer awaiting confirmation).
        return res.json({ ok: false, pending: true, message: result.failureReason || 'Payment is still being processed' })
      }
      await markPaymentFailed(payment.id, result.failureReason || 'Provider reports failure')
      throw new AppError(402, result.failureReason || 'Payment failed', 'PAYMENT_FAILED')
    }

    const settled = await settlePaymentSuccess(pool, payment.id)
    res.json({ ok: true, already_processed: settled.alreadyProcessed, access_until: settled.periodEnd })
  })
)

/** POST /api/v1/billing/dev/complete — dev-only mock confirmation (gated by NODE_ENV) */
router.post(
  '/dev/complete',
  requireRole('owner'),
  validateBody(z.object({ tx_ref: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    if (process.env.NODE_ENV === 'production') throw new AppError(403, 'Dev endpoint disabled in production', 'DEV_ONLY')
    const { tx_ref } = req.body as { tx_ref: string }
    const payment = await queryOne<{ id: string; tenant_id: string; status: string }>(
      `SELECT id, tenant_id, status FROM payments WHERE tx_ref = $1 AND tenant_id = $2`,
      [tx_ref, req.user!.tenant_id]
    )
    if (!payment) throw new AppError(404, 'Payment not found', 'NOT_FOUND')
    if (payment.status === 'success') return res.json({ ok: true, already_processed: true })
    if (payment.status !== 'pending') throw new AppError(409, `Payment is ${payment.status}`, 'BAD_STATE')
    const settled = await settlePaymentSuccess(pool, payment.id)
    res.json({ ok: true, already_processed: settled.alreadyProcessed, access_until: settled.periodEnd })
  })
)

export default router
