import {
  formatEtb,
  PAYABLE_SERVICES,
  resolvePayableAmount,
  validateServicePaymentForm,
  type PaymentPlanMode,
  type ServicePaymentErrors,
} from './serviceCheckout';

export const TELEBIRR_NOTE_MAX_LEN = 24;

export interface TelebirrMerchantConfig {
  mode: 'live' | 'sandbox';
  merchantConfigured: boolean;
  merchantCodeMasked: string | null;
  publicKeyConfigured: boolean;
  webGatewayHost: string;
}

export interface TelebirrDirectOrderSummary {
  serviceName: string;
  amount: number;
  formattedAmount: string;
  sanitizedNote: string;
  fabricTitlePreview: string;
}

/**
 * Strips Ethio Telecom Fabric-disallowed punctuation from the order note
 * and enforces the 24-character suffix cap matching backend preOrder signing.
 */
export function sanitizeTelebirrOrderNote(rawNote: string): string {
  return String(rawNote || '')
    .replace(/[~`!@#$%^&*()_+=[\]{};':"\\|<>?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TELEBIRR_NOTE_MAX_LEN);
}

/**
 * Normalizes /api/telebirr/config JSON into safe UI metadata without defaults inventing credentials.
 */
export function normalizeTelebirrMerchantConfig(raw: unknown): TelebirrMerchantConfig {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = obj.mode === 'live' ? 'live' : 'sandbox';
  const merchantConfigured = Boolean(obj.merchant_configured ?? mode === 'live');
  const merchantCodeMasked =
    typeof obj.merchant_code_masked === 'string' && obj.merchant_code_masked.trim()
      ? obj.merchant_code_masked.trim()
      : null;
  const publicKeyConfigured = Boolean(obj.public_key_configured);
  const webGatewayHost =
    typeof obj.web_gateway_host === 'string' && obj.web_gateway_host.trim()
      ? obj.web_gateway_host.trim()
      : '196.188.120.3:38443';

  return {
    mode,
    merchantConfigured,
    merchantCodeMasked,
    publicKeyConfigured,
    webGatewayHost,
  };
}

/**
 * Computes the formatted ETB total and Fabric H5 order title preview for a Telebirr checkout.
 */
export function buildTelebirrOrderSummary(input: {
  serviceId: number;
  paymentPlan: PaymentPlanMode;
  customAmount: string;
  notes: string;
}): TelebirrDirectOrderSummary {
  const pkg = PAYABLE_SERVICES.find((s) => s.id === input.serviceId) ?? PAYABLE_SERVICES[0];
  const amount = resolvePayableAmount(pkg.id, input.paymentPlan, input.customAmount);
  const planSuffix =
    input.paymentPlan === 'full'
      ? 'Full Payment'
      : input.paymentPlan === 'custom'
        ? 'Custom Quote'
        : '40% Deposit';
  const sanitizedNote = sanitizeTelebirrOrderNote(input.notes);
  const baseTitle = `${pkg.name} (${planSuffix})`;
  const fabricTitlePreview = sanitizedNote ? `${baseTitle} - ${sanitizedNote}`.slice(0, 64) : baseTitle.slice(0, 64);

  return {
    serviceName: pkg.name,
    amount,
    formattedAmount: formatEtb(amount),
    sanitizedNote,
    fabricTitlePreview,
  };
}

/**
 * Validates customer, Telebirr wallet phone, and ETB amount inputs before H5 preOrder initialization.
 */
export function validateTelebirrDirectForm(input: {
  serviceId: number;
  paymentPlan: PaymentPlanMode;
  customAmount: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
}): {
  valid: boolean;
  amount: number;
  sanitizedNote: string;
  errors: ServicePaymentErrors;
} {
  const base = validateServicePaymentForm({
    provider: 'telebirr',
    serviceId: input.serviceId,
    paymentPlan: input.paymentPlan,
    customAmount: input.customAmount,
    fullName: input.fullName,
    email: input.email,
    phone: input.phone,
    notes: input.notes,
  });

  return {
    valid: base.valid,
    amount: base.amount,
    sanitizedNote: sanitizeTelebirrOrderNote(input.notes),
    errors: base.errors,
  };
}
