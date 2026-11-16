export type PaymentProviderId = 'chapa' | 'telebirr' | 'mpesa' | 'cbe_bank' | 'stripe'

export type GatewayMode = 'sandbox' | 'live'

export interface GatewayFieldSpec {
  key: string
  label: string
  placeholder: string
  secret?: boolean
  required?: boolean
  hint?: string
}

export interface ProviderDefinition {
  id: PaymentProviderId
  name: string
  tagline: string
  icon: string
  feePct: number
  supportsInbound: boolean
  supportsOutbound: boolean
  fields: GatewayFieldSpec[]
}

export const PAYMENT_PROVIDERS: Record<PaymentProviderId, ProviderDefinition> = {
  chapa: {
    id: 'chapa',
    name: 'Chapa Gateway',
    tagline: 'Ethiopian cards, Telebirr, CBE Birr & bank checkout',
    icon: 'fa-solid fa-bolt',
    feePct: 2.5,
    supportsInbound: true,
    supportsOutbound: true,
    fields: [
      { key: 'public_key', label: 'Public Key', placeholder: 'CHAPUBK_TEST-…', required: true },
      { key: 'secret_key', label: 'Secret Key', placeholder: 'CHASECK_TEST-…', secret: true, required: true, hint: 'Encrypted with AES-256-GCM on the server' },
      { key: 'webhook_secret', label: 'Webhook Secret', placeholder: 'whsec_…', secret: true },
      { key: 'settlement_account', label: 'Settlement Bank / Account #', placeholder: '100023456789 (CBE)', required: true },
    ],
  },
  telebirr: {
    id: 'telebirr',
    name: 'Telebirr Merchant',
    tagline: 'Ethio Telecom Fabric H5 Checkout & In-App QR',
    icon: 'fa-solid fa-mobile-screen-button',
    feePct: 1.0,
    supportsInbound: true,
    supportsOutbound: true,
    fields: [
      { key: 'merchant_id', label: 'Merchant Shortcode', placeholder: 'e.g. 554120', required: true },
      { key: 'fabric_app_id', label: 'Fabric App ID (X-APP-Key)', placeholder: 'Telebirr Fabric App ID…' },
      { key: 'merchant_app_id', label: 'Merchant App ID', placeholder: 'Telebirr Merchant App ID…' },
      { key: 'secret_key', label: 'Fabric App Secret', placeholder: 'Enter Telebirr app secret…', secret: true, required: true },
      { key: 'private_key', label: 'Merchant RSA Private Key (PEM)', placeholder: '-----BEGIN PRIVATE KEY-----…', secret: true },
      { key: 'public_key', label: 'Ethio Telecom Public Key (optional)', placeholder: '-----BEGIN PUBLIC KEY-----…', secret: true },
      { key: 'base_url', label: 'Fabric Base URL (optional)', placeholder: 'https://196.188.120.3:38443/apiaccess/payment/gateway' },
      { key: 'settlement_account', label: 'Merchant Wallet Phone', placeholder: '+251911…', required: true },
    ],
  },
  mpesa: {
    id: 'mpesa',
    name: 'M-Pesa Safaricom',
    tagline: 'Safaricom Ethiopia Open API · OAuth + STK/USSD Push',
    icon: 'fa-solid fa-sim-card',
    feePct: 1.5,
    supportsInbound: true,
    supportsOutbound: true,
    fields: [
      { key: 'merchant_id', label: 'Business Shortcode / Paybill', placeholder: 'e.g. 174379', required: true },
      { key: 'public_key', label: 'Consumer Key', placeholder: 'Safaricom Consumer Key…', required: true },
      { key: 'secret_key', label: 'Consumer Secret', placeholder: 'Safaricom Consumer Secret…', secret: true, required: true },
      { key: 'passkey', label: 'Online STK Passkey', placeholder: 'Safaricom STK Passkey…', secret: true },
      { key: 'base_url', label: 'M-Pesa API Base URL (optional)', placeholder: 'https://apisandbox.safaricom.et' },
      { key: 'settlement_account', label: 'Settlement Phone / Account', placeholder: '+2517…' },
    ],
  },
  cbe_bank: {
    id: 'cbe_bank',
    name: 'CBE / Direct Bank Transfer',
    tagline: 'Zero-fee verified bank & CBE Birr reference settlement',
    icon: 'fa-solid fa-building-columns',
    feePct: 0,
    supportsInbound: true,
    supportsOutbound: true,
    fields: [
      { key: 'account_holder', label: 'Account Holder Name', placeholder: 'Bole Medhanealem Pharmacy PLC', required: true },
      { key: 'settlement_account', label: 'Account Number / IBAN', placeholder: '1000123456789', required: true },
      { key: 'bank_name', label: 'Bank Name / Branch', placeholder: 'Commercial Bank of Ethiopia · Bole', required: true },
    ],
  },
  stripe: {
    id: 'stripe',
    name: 'Stripe International Cards',
    tagline: 'Visa, Mastercard & international diaspora payments',
    icon: 'fa-brands fa-cc-stripe',
    feePct: 2.9,
    supportsInbound: true,
    supportsOutbound: false,
    fields: [
      { key: 'public_key', label: 'Publishable Key', placeholder: 'pk_test_… / pk_live_…', required: true },
      { key: 'secret_key', label: 'Secret Key', placeholder: 'sk_test_… / sk_live_…', secret: true, required: true },
      { key: 'webhook_secret', label: 'Signing Webhook Secret', placeholder: 'whsec_…', secret: true },
    ],
  },
}

const POS_RAIL_TO_GATEWAY: Record<string, PaymentProviderId> = {
  telebirr: 'telebirr',
  mpesa: 'mpesa',
  cbe: 'cbe_bank',
  cbe_bank: 'cbe_bank',
  card: 'chapa',
  chapa: 'chapa',
  stripe: 'stripe',
}

export function mapPosRailToGateway(rail: string): PaymentProviderId | null {
  const key = String(rail || '').trim().toLowerCase()
  return POS_RAIL_TO_GATEWAY[key] ?? null
}

export function validateGatewayConfig(
  provider: PaymentProviderId,
  values: Record<string, string>,
  hasExistingSecret = false,
  mode: GatewayMode = 'sandbox',
): { valid: boolean; errors: Record<string, string> } {
  const def = PAYMENT_PROVIDERS[provider]
  const errors: Record<string, string> = {}
  if (!def) {
    return { valid: false, errors: { provider: 'Unsupported payment provider.' } }
  }
  const liveExtraRequired: Record<string, string[]> = {
    telebirr: ['fabric_app_id', 'merchant_app_id', 'private_key'],
    mpesa: ['passkey'],
  }
  const extraSet = mode === 'live' ? new Set(liveExtraRequired[provider] ?? []) : new Set<string>()

  for (const field of def.fields) {
    const isRequired = Boolean(field.required) || extraSet.has(field.key)
    if (!isRequired) continue
    const val = String(values[field.key] ?? '').trim()
    const alreadyStored = field.secret && hasExistingSecret
    if (!val && !alreadyStored) {
      errors[field.key] = `${field.label} is required${extraSet.has(field.key) ? ' for Live mode' : ''}.`
    }
  }
  return { valid: Object.keys(errors).length === 0, errors }
}

export function computeGatewayFee(amount: number, provider: PaymentProviderId): {
  gross: number
  fee: number
  net: number
  feePct: number
} {
  const gross = Math.max(0, Number(amount || 0))
  const feePct = PAYMENT_PROVIDERS[provider]?.feePct ?? 0
  const fee = Math.round(gross * (feePct / 100) * 100) / 100
  const net = Math.round(Math.max(0, gross - fee) * 100) / 100
  return { gross, fee, net, feePct }
}

export function buildPaymentLinkUrl(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '')
  return `${base}/pay/${encodeURIComponent(token)}`
}

export function validateOutboundPayout(params: {
  amount: number
  destinationAccount: string
  providerEnabled: boolean
  providerSupportsOutbound: boolean
}): { valid: boolean; error: string | null } {
  if (!params.providerEnabled) {
    return { valid: false, error: 'Selected payment gateway is not enabled. Enable it in Gateway Setup first.' }
  }
  if (!params.providerSupportsOutbound) {
    return { valid: false, error: 'Selected gateway does not support outbound vendor payouts.' }
  }
  if (!Number.isFinite(params.amount) || params.amount <= 0) {
    return { valid: false, error: 'Payout amount must be greater than zero.' }
  }
  if (!params.destinationAccount.trim() || params.destinationAccount.trim().length < 4) {
    return { valid: false, error: 'Enter a valid recipient bank account or mobile wallet.' }
  }
  return { valid: true, error: null }
}
