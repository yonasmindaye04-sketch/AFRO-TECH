import { randomUUID } from 'node:crypto'
import {
  buildSigningString,
  createNonceStr,
  createTimestamp,
  signRequestObject,
  verifyWithRsaPss,
} from './telebirr.signing.js'
import { getFabricToken, invalidateFabricToken } from './telebirr.token.js'

/**
 * Telebirr C2B Web Checkout client.
 * Ported from the yekis project (apps/backend/src/modules/escrow/providers/telebirr.client.ts)
 * and adapted to AFRO Suite conventions (plain fetch, process.env, console logging,
 * amounts in major ETB units rather than minor units).
 *
 * Flow (same shape as Chapa):
 *   1. telebirrInitialize() -> preOrder -> hosted web checkout URL -> customer pays
 *   2. Telebirr POSTs the result to TELEBIRR_NOTIFY_URL -> /api/billing/webhook/telebirr
 *   3. Browser lands on /api/billing/return -> frontend /api/billing/verify (queryOrder)
 *   4. paymentReconcile sweep re-queries stale pending payments as a safety net
 */

export type TelebirrTradeStatus = 'SUCCESS' | 'FAILED' | 'PENDING'

function baseUrl(): string {
  return (
    process.env.TELEBIRR_BASE_URL ||
    'https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway'
  ).replace(/\/$/, '')
}

function webBaseUrl(): string {
  return (
    process.env.TELEBIRR_WEB_BASE_URL ||
    'https://developerportal.ethiotelebirr.et:38443/payment/web/paygate?'
  )
}

/** True when all credentials needed for a C2B initiation are present. */
export function telebirrConfigured(): boolean {
  return Boolean(
    process.env.TELEBIRR_FABRIC_APP_ID &&
      process.env.TELEBIRR_APP_SECRET &&
      process.env.TELEBIRR_MERCHANT_APP_ID &&
      process.env.TELEBIRR_MERCHANT_CODE &&
      process.env.TELEBIRR_PRIVATE_KEY
  )
}

/**
 * Telebirr rejects certain special characters in biz_content titles.
 * Sanitizes by removing/replacing them with ASCII-safe equivalents.
 */
function sanitizeTelebirrTitle(title: string): string {
  const replacements: Record<string, string> = {
    '\u2014': '-', // em dash
    '\u2013': '-', // en dash
    '\u2018': "'", // left single quote
    '\u2019': "'", // right single quote
    '\u201C': '"', // left double quote
    '\u201D': '"', // right double quote
    '\u2026': '...', // ellipsis
  }
  let sanitized = title
  for (const [char, replacement] of Object.entries(replacements)) {
    sanitized = sanitized.split(char).join(replacement)
  }
  sanitized = sanitized.replace(/[^\x20-\x7E]/g, '') // ASCII printable only
  sanitized = sanitized.replace(/[<>"&']/g, '')
  return sanitized || 'Payment'
}

export interface TelebirrInitInput {
  /** AFRO tx_ref, used for our internal tracking and notifications. */
  txRef: string
  /** Amount in major units (ETB), e.g. 500. */
  amount: number
  currency: string
  /** Short order title shown on the checkout page. */
  title: string
  /** Server-to-server callback URL (TELEBIRR_NOTIFY_URL or derived from BACKEND_PUBLIC_URL). */
  notifyUrl?: string
  /** Browser redirect URL after payment (billing return endpoint). */
  returnUrl: string
}

export interface TelebirrInitResult {
  checkoutUrl: string
  /** merch_order_id sent to Telebirr - stored on payments.provider_ref for webhook matching. */
  providerRef: string
}

/** Creates a Telebirr preOrder and returns the hosted web checkout URL. */
export async function telebirrInitialize(input: TelebirrInitInput): Promise<TelebirrInitResult> {
  if (!telebirrConfigured()) {
    throw new Error('Telebirr is not configured (missing TELEBIRR_* credentials)')
  }

  // Telebirr merch_order_id: alphanumerics, max 32 chars
  const merchOrderId = ('AFT' + Date.now().toString(36) + randomUUID().replace(/-/g, '').slice(0, 10)).slice(0, 32)
  const amountStr = input.amount.toFixed(2)
  const sanitizedTitle = sanitizeTelebirrTitle(input.title)

  const fabricToken = await getFabricToken()

  const preOrderRequest: Record<string, unknown> = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method: 'payment.preorder',
    version: '1.0',
    biz_content: {
      notify_url: input.notifyUrl,
      appid: process.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: process.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: merchOrderId,
      trade_type: 'Checkout',
      title: sanitizedTitle,
      total_amount: amountStr,
      trans_currency: input.currency,
      timeout_express: process.env.TELEBIRR_TIMEOUT_EXPRESS || '120m',
      redirect_url: input.returnUrl,
    },
    sign: '',
    sign_type: 'SHA256WithRSA',
  }
  preOrderRequest.sign = signRequestObject(preOrderRequest, process.env.TELEBIRR_PRIVATE_KEY!)

  let preOrderResponse: Response
  try {
    preOrderResponse = await fetch(`${baseUrl()}/payment/v1/merchant/preOrder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': process.env.TELEBIRR_FABRIC_APP_ID!,
        Authorization: `Bearer ${fabricToken}`,
      },
      body: JSON.stringify(preOrderRequest),
    })
  } catch (err) {
    await invalidateFabricToken()
    throw new Error(`Telebirr preOrder request failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!preOrderResponse.ok) {
    const body = await preOrderResponse.text().catch(() => '')
    if (preOrderResponse.status === 401) await invalidateFabricToken()
    throw new Error(`Telebirr preOrder failed: HTTP ${preOrderResponse.status} - ${body}`)
  }

  const preOrderData = (await preOrderResponse.json()) as {
    code: number
    msg: string
    biz_content?: { prepay_id?: string }
  }
  if (preOrderData.code !== 200 && preOrderData.code !== 0) {
    throw new Error(`Telebirr preOrder returned error: code=${preOrderData.code}, msg=${preOrderData.msg}`)
  }
  const prepayId = preOrderData.biz_content?.prepay_id
  if (!prepayId) {
    throw new Error('Telebirr preOrder succeeded but returned no prepay_id')
  }

  // Assemble the web checkout URL the customer browser is redirected to.
  const rawMap: Record<string, string> = {
    appid: process.env.TELEBIRR_MERCHANT_APP_ID!,
    merch_code: process.env.TELEBIRR_MERCHANT_CODE!,
    nonce_str: createNonceStr(),
    prepay_id: prepayId,
    timestamp: createTimestamp(),
  }
  const rawSign = signRequestObject(rawMap, process.env.TELEBIRR_PRIVATE_KEY!)
  const rawRequest =
    Object.keys(rawMap)
      .sort()
      .map((k) => `${k}=${encodeURIComponent(rawMap[k]!)}`)
      .join('&') +
    `&sign=${encodeURIComponent(rawSign)}&sign_type=SHA256WithRSA`

  const checkoutUrl = `${webBaseUrl()}${rawRequest}&version=1.0&trade_type=Checkout`

  console.log(`[telebirr] preOrder created: merch_order_id=${merchOrderId} amount=${amountStr} ${input.currency}`)
  return { checkoutUrl, providerRef: merchOrderId }
}

export interface TelebirrWebhookResult {
  valid: boolean
  merchOrderId: string | null
  status: TelebirrTradeStatus | null
  tradeStatus: string | null
  totalAmount: string | null
  paymentOrderId: string | null
}

/**
 * Verifies an incoming Telebirr webhook. The signature is embedded inside
 * the JSON body as the "sign" field (NOT an HTTP header) and uses RSA-PSS
 * with Telebirr\'s public key (TELEBIRR_PUBLIC_KEY).
 */
export function telebirrVerifyWebhook(rawBody: string): TelebirrWebhookResult {
  const none: TelebirrWebhookResult = {
    valid: false,
    merchOrderId: null,
    status: null,
    tradeStatus: null,
    totalAmount: null,
    paymentOrderId: null,
  }

  const publicKey = process.env.TELEBIRR_PUBLIC_KEY
  if (!publicKey) {
    console.error('[telebirr] TELEBIRR_PUBLIC_KEY not set - rejecting webhook rather than trusting an unverifiable payload')
    return none
  }

  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>
  } catch {
    console.warn('[telebirr] webhook body is not valid JSON')
    return none
  }

  const sign = payload.sign
  if (typeof sign !== 'string' || !sign) {
    console.warn('[telebirr] webhook payload missing "sign" field')
    return none
  }

  const signingString = buildSigningString(payload)
  const isValid = verifyWithRsaPss(signingString, sign, publicKey)
  if (!isValid) {
    console.warn('[telebirr] webhook RSA-PSS signature verification failed')
    return none
  }

  const biz = (payload.biz_content ?? {}) as Record<string, unknown>
  const merchOrderId = typeof biz.merch_order_id === 'string' ? biz.merch_order_id : null
  const tradeStatus = typeof biz.trade_status === 'string' ? biz.trade_status : null
  const totalAmount = typeof biz.total_amount === 'string' ? biz.total_amount : null
  const paymentOrderId = typeof biz.payment_order_id === 'string' ? biz.payment_order_id : null

  let status: TelebirrTradeStatus | null = null
  if (tradeStatus) {
    const s = tradeStatus.toLowerCase()
    if (['completed', 'success', 'pay_success'].includes(s)) status = 'SUCCESS'
    else if (['fail', 'failed', 'closed', 'cancelled'].includes(s)) status = 'FAILED'
    else status = 'PENDING'
  }

  return { valid: true, merchOrderId, status, tradeStatus, totalAmount, paymentOrderId }
}

/**
 * Direct transaction-status query (payment.query.order) used by the
 * frontend /billing/verify endpoint and the payment reconciliation sweep.
 * Returns null when Telebirr has no record of the merch_order_id yet -
 * the customer likely never confirmed the checkout, i.e. normal PENDING.
 */
export async function telebirrQueryStatus(merchOrderId: string): Promise<{ status: TelebirrTradeStatus } | null> {
  if (!telebirrConfigured()) {
    console.warn('[telebirr] credentials not configured - status query unavailable')
    return null
  }

  const fabricToken = await getFabricToken()

  const queryRequest: Record<string, unknown> = {
    timestamp: createTimestamp(),
    nonce_str: createNonceStr(),
    method: 'payment.query.order',
    version: '1.0',
    biz_content: {
      appid: process.env.TELEBIRR_MERCHANT_APP_ID,
      merch_code: process.env.TELEBIRR_MERCHANT_CODE,
      merch_order_id: merchOrderId,
    },
    sign: '',
    sign_type: 'SHA256WithRSA',
  }
  queryRequest.sign = signRequestObject(queryRequest, process.env.TELEBIRR_PRIVATE_KEY!)

  let response: Response
  try {
    response = await fetch(`${baseUrl()}/payment/v1/merchant/queryOrder`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': process.env.TELEBIRR_FABRIC_APP_ID!,
        Authorization: `Bearer ${fabricToken}`,
      },
      body: JSON.stringify(queryRequest),
    })
  } catch (err) {
    await invalidateFabricToken()
    throw new Error(`Telebirr queryOrder request failed: ${err instanceof Error ? err.message : String(err)}`)
  }

  if (!response.ok) {
    if (response.status === 401) await invalidateFabricToken()
    const body = await response.text().catch(() => '')
    throw new Error(`Telebirr queryOrder failed: HTTP ${response.status} - ${body}`)
  }

  const data = (await response.json()) as {
    code?: number
    msg?: string
    biz_content?: { trade_status?: string; trade_voucher?: string; total_amount?: string }
  }

  if (data.code !== 200 || !data.biz_content?.trade_status) {
    console.log(`[telebirr] no record of order ${merchOrderId} yet (code=${data.code}) - still PENDING`)
    return null
  }

  const s = data.biz_content.trade_status.toLowerCase()
  let status: TelebirrTradeStatus
  if (['completed', 'success', 'pay_success'].includes(s)) status = 'SUCCESS'
  else if (['fail', 'failed', 'closed', 'cancelled'].includes(s)) status = 'FAILED'
  else status = 'PENDING'
  return { status }
}
