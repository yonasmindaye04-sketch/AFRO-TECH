import crypto from 'node:crypto'

/**
 * CBE Birr (Commercial Bank of Ethiopia) payment client - placeholder.
 * Ported from the yekis project (apps/backend/src/modules/escrow/providers/cbe.client.ts).
 *
 * Real CBE Birr merchant APIs are not yet publicly documented in this repo;
 * initiation is simulated (no hosted checkout URL - the customer pays via
 * manual bank/CBE Birr transfer and the platform confirms via webhook or
 * admin verification). Webhooks are verified with HMAC-SHA256 over the raw
 * body using CBE_WEBHOOK_SECRET.
 */

export interface CbeInitInput {
  txRef: string
  amount: number
  currency: string
  title: string
}

export function cbeConfigured(): boolean {
  // CBE has no initiation credentials yet - "configured" means the webhook
  // verification secret is present so payments can be confirmed.
  return Boolean(process.env.CBE_WEBHOOK_SECRET)
}

/** Simulated CBE Birr initiation - always succeeds with no redirect (manual transfer flow). */
export async function cbeInitialize(input: CbeInitInput): Promise<{ checkoutUrl: string | null; providerRef: string }> {
  console.log(`[cbe] mock initiation: tx_ref=${input.txRef} amount=${input.amount.toFixed(2)} ${input.currency}`)
  return { checkoutUrl: null, providerRef: input.txRef }
}

/** Verifies the X-CBE-Signature header: HMAC-SHA256 over the raw body, hex-encoded. */
export function cbeWebhookSignatureValid(rawBody: string, signature: string | undefined): boolean {
  const secret = process.env.CBE_WEBHOOK_SECRET
  if (!secret || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}
