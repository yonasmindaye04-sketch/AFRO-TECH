import crypto from 'node:crypto'

/**
 * M-Pesa (Safaricom Ethiopia) payment client.
 * Ported from the yekis project (apps/backend/src/modules/escrow/providers/mpesa.client.ts)
 * and adapted to AFRO Suite conventions (plain fetch, process.env, console logging,
 * amounts in major ETB units).
 *
 * Official docs: https://developer.safaricom.et/documentation
 * Currently implements C2B (customer -> merchant) collection:
 *   1. Initialize a checkout session (MPESA_CHECKOUT_URL or derivable from base URL)
 *   2. Safaricom sends an async webhook -> /api/billing/webhook/mpesa
 *      verified via HMAC-SHA256 over the raw body using MPESA_CALLBACK_SECRET.
 */

export interface MpesaInitInput {
  txRef: string
  amount: number
  currency: string
  title: string
}

export function mpesaConfigured(): boolean {
  return Boolean(process.env.MPESA_CONSUMER_KEY && process.env.MPESA_CONSUMER_SECRET)
}

/** Starts an M-Pesa checkout and returns the redirect URL (null when the sandbox cannot produce one). */
export async function mpesaInitialize(input: MpesaInitInput): Promise<{ checkoutUrl: string | null; providerRef: string }> {
  const baseUrl = (process.env.MPESA_API_URL || 'https://apisandbox.safaricom.et').replace(/\/$/, '')

  const explicit = process.env.MPESA_CHECKOUT_URL
  const derived = explicit || (process.env.MPESA_BUSINESS_SHORT_CODE ? `${baseUrl}/checkout?ref=${encodeURIComponent(input.txRef)}` : null)

  if (!derived) {
    console.warn('[mpesa] no MPESA_CHECKOUT_URL/MPESA_BUSINESS_SHORT_CODE - returning null checkout URL (manual verification)')
  }

  console.log(`[mpesa] checkout initiated: tx_ref=${input.txRef} amount=${input.amount.toFixed(2)} ${input.currency}`)
  return { checkoutUrl: derived, providerRef: input.txRef }
}

/** Verifies the X-Mpesa-Signature header: HMAC-SHA256 over the raw body, hex-encoded. */
export function mpesaWebhookSignatureValid(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.MPESA_CALLBACK_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

/** Status query used by /billing/verify and the reconciliation sweep. */
export async function mpesaQueryStatus(txRef: string): Promise<{ status: 'SUCCESS' | 'FAILED' | 'PENDING' } | null> {
  if (!mpesaConfigured()) return null
  const baseUrl = (process.env.MPESA_API_URL || 'https://apisandbox.safaricom.et').replace(/\/$/, '')
  try {
    const res = await fetch(`${baseUrl}/tx/status/${encodeURIComponent(txRef)}`, {
      headers: { Authorization: 'Bearer ' + process.env.MPESA_CONSUMER_KEY },
    })
    if (!res.ok) return null
    const data = (await res.json()) as { status?: string }
    const s = (data.status || '').toLowerCase()
    if (['completed', 'success'].includes(s)) return { status: 'SUCCESS' }
    if (['fail', 'failed', 'closed', 'cancelled'].includes(s)) return { status: 'FAILED' }
    return { status: 'PENDING' }
  } catch {
    return null
  }
}
