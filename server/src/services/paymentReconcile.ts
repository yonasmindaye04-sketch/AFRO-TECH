import { pool } from '../config/db.js'
import { settlePaymentSuccess, markPaymentFailed } from './billing.js'
import { telebirrConfigured, telebirrQueryStatus } from './payments/telebirr.js'
import { mpesaConfigured, mpesaQueryStatus } from './payments/mpesa.js'

/**
 * Payment reconciliation sweep - ported from the yekis project
 * (apps/backend/src/queue/paymentReconcile.worker.ts), adapted to run as a
 * plain interval (AFRO Suite workers only run when Redis is configured, and
 * payment reconciliation must not depend on Redis).
 *
 * Safety net for when provider webhooks are missed: polls Telebirr/M-Pesa
 * for subscription payments stuck in "pending" and settles or fails them.
 * Gives up after GIVE_UP_HOURS and leaves the row for manual review.
 */

const INTERVAL_MS = Math.max(60_000, Number(process.env.PAYMENT_RECONCILE_INTERVAL_MS || 5 * 60_000))
const STALE_MINUTES = Number(process.env.PAYMENT_RECONCILE_STALE_MINUTES || 10)
const GIVE_UP_HOURS = Number(process.env.PAYMENT_RECONCILE_GIVE_UP_HOURS || 26)
const BATCH_LIMIT = 50

let timer: ReturnType<typeof setInterval> | null = null
let running = false

async function reconcileOnce(): Promise<void> {
  if (running) return // previous sweep still in flight
  running = true
  try {
    const { rows } = await pool.query<{
      id: string
      tx_ref: string
      provider: string
      provider_ref: string | null
    }>(
      `SELECT id, tx_ref, provider, provider_ref
       FROM payments
       WHERE status = 'pending'
         AND provider IN ('telebirr', 'mpesa')
         AND created_at < now() - ($1 || ' minutes')::interval
         AND created_at > now() - ($2 || ' hours')::interval
       ORDER BY created_at ASC
       LIMIT $3`,
      [String(STALE_MINUTES), String(GIVE_UP_HOURS), BATCH_LIMIT]
    )

    for (const payment of rows) {
      try {
        let status: 'SUCCESS' | 'FAILED' | 'PENDING' | null = null

        if (payment.provider === 'telebirr') {
          if (!telebirrConfigured() || !payment.provider_ref) continue
          const r = await telebirrQueryStatus(payment.provider_ref)
          status = r ? r.status : null
        } else if (payment.provider === 'mpesa') {
          if (!mpesaConfigured()) continue
          const r = await mpesaQueryStatus(payment.tx_ref)
          status = r ? r.status : null
        }

        if (status === 'SUCCESS') {
          await settlePaymentSuccess(pool, payment.id)
          console.log(`[payment-reconcile] settled ${payment.provider} payment ${payment.tx_ref}`)
        } else if (status === 'FAILED') {
          await markPaymentFailed(payment.id, `${payment.provider} reconciliation: payment failed or cancelled`)
          console.log(`[payment-reconcile] failed ${payment.provider} payment ${payment.tx_ref}`)
        }
        // PENDING / null: leave for the next sweep
      } catch (err) {
        console.error(`[payment-reconcile] error checking payment ${payment.tx_ref}:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.error('[payment-reconcile] sweep failed:', err instanceof Error ? err.message : err)
  } finally {
    running = false
  }
}

export function startPaymentReconcileSweep(): void {
  if (timer) return
  if (!telebirrConfigured() && !mpesaConfigured()) {
    console.log('[payment-reconcile] no queryable providers configured - sweep disabled')
    return
  }
  console.log(`[payment-reconcile] sweep started (every ${Math.round(INTERVAL_MS / 60000)}m, stale>${STALE_MINUTES}m, give-up>${GIVE_UP_HOURS}h)`)
  timer = setInterval(() => void reconcileOnce(), INTERVAL_MS)
  timer.unref?.()
}

export function stopPaymentReconcileSweep(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
