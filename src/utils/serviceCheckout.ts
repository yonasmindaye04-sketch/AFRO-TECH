import { services } from '../data';

export type PaymentPlanMode = 'deposit' | 'full' | 'custom';
export type ServicePaymentProvider = 'chapa' | 'telebirr' | 'mpesa';

export interface PaymentProviderOption {
  id: ServicePaymentProvider;
  label: string;
  subtitle: string;
  icon: string;
  configEndpoint: string;
  initEndpoint: string;
  verifyEndpointPrefix: string;
  requiresPhone: boolean;
}

export interface GatewayRequirementSpec {
  id: ServicePaymentProvider;
  displayName: string;
  railSummary: string;
  flowTitle: string;
  securityProtocol: string;
  settlementNote: string;
  amountRule: string;
  wholeEtbOnly: boolean;
  phoneLabel: string;
  phonePlaceholder: string;
  phoneRequired: boolean;
  phoneHint: string;
  referenceLabel: string;
  referencePlaceholder: string;
  referenceMaxLen: number;
  requirements: readonly string[];
}

export const SERVICE_PAYMENT_PROVIDERS: readonly PaymentProviderOption[] = [
  {
    id: 'chapa',
    label: 'Chapa',
    subtitle: 'Telebirr, CBE Birr, Bank & Cards',
    icon: 'fa-solid fa-bolt',
    configEndpoint: '/api/chapa/config',
    initEndpoint: '/api/chapa/initialize',
    verifyEndpointPrefix: '/api/chapa/verify',
    requiresPhone: false,
  },
  {
    id: 'telebirr',
    label: 'TeleBirr',
    subtitle: 'Ethio Telecom Direct Fabric H5',
    icon: 'fa-solid fa-mobile-screen-button',
    configEndpoint: '/api/telebirr/config',
    initEndpoint: '/api/telebirr/initialize',
    verifyEndpointPrefix: '/api/telebirr/verify',
    requiresPhone: false,
  },
  {
    id: 'mpesa',
    label: 'M-Pesa',
    subtitle: 'Safaricom STK / USSD Push',
    icon: 'fa-solid fa-sim-card',
    configEndpoint: '/api/mpesa/config',
    initEndpoint: '/api/mpesa/stkpush',
    verifyEndpointPrefix: '/api/mpesa/query',
    requiresPhone: true,
  },
];

export const GATEWAY_REQUIREMENTS: Record<ServicePaymentProvider, GatewayRequirementSpec> = {
  chapa: {
    id: 'chapa',
    displayName: 'Chapa Multi-Rail Gateway',
    railSummary: 'Telebirr · CBE Birr · Amole · Visa / Mastercard',
    flowTitle: 'Hosted Multi-Channel Redirect Checkout',
    securityProtocol: 'Bearer Secret Auth + HMAC-SHA256 Webhook Verification',
    settlementNote: 'ETB settlement with instant callback verification & receipt ref',
    amountRule: '50 – 5,000,000 ETB (supports decimals)',
    wholeEtbOnly: false,
    phoneLabel: 'Mobile / Wallet Phone',
    phonePlaceholder: '+251 910 011 818',
    phoneRequired: false,
    phoneHint: 'Optional — pre-fills mobile wallet rails on the hosted Chapa checkout page.',
    referenceLabel: 'Project Reference',
    referencePlaceholder: 'Quote ID or milestone (optional)',
    referenceMaxLen: 40,
    requirements: [
      'Customer Full Name (min 2 chars) & valid Receipt Email',
      'Payable ETB amount between 50 and 5,000,000 ETB',
      'Optional Ethiopian phone number for faster mobile-wallet pre-fill',
      'Authorization completes on Chapa hosted checkout page',
    ],
  },
  telebirr: {
    id: 'telebirr',
    displayName: 'TeleBirr SuperApp Fabric H5',
    railSummary: 'Ethio Telecom TeleBirr Wallet · H5 Web & QR',
    flowTitle: 'Direct Fabric Token + RSA Pre-Order Handoff',
    securityProtocol: 'SHA256WithRSA Request Signing + Public-Key Notify Check',
    settlementNote: 'Direct merchant code settlement via Ethio Telecom Fabric API',
    amountRule: '50 – 5,000,000 ETB',
    wholeEtbOnly: false,
    phoneLabel: 'TeleBirr Wallet Phone',
    phonePlaceholder: '+251 911 234 567',
    phoneRequired: false,
    phoneHint: 'Optional — enter your 09xx Ethio Telecom number for wallet record matching.',
    referenceLabel: 'Order Note (TeleBirr Title)',
    referencePlaceholder: 'Max 24 chars note (optional)',
    referenceMaxLen: 24,
    requirements: [
      'Active TeleBirr SuperApp or USSD (*127#) wallet account',
      'Customer Full Name & Receipt Email for order tracking',
      'RSA-signed Pre-Order token redirects directly to TeleBirr H5 checkout',
      'Order title notes are trimmed to 24 characters per Fabric API spec',
    ],
  },
  mpesa: {
    id: 'mpesa',
    displayName: 'Safaricom Ethiopia M-Pesa STK',
    railSummary: 'Direct Handset PIN Prompt · STK / USSD Push',
    flowTitle: 'OAuth Token + Daraja STK Push Prompt to Handset',
    securityProtocol: 'OAuth 2.0 Bearer + Timestamp/Passkey STK Signature',
    settlementNote: 'Instant M-Pesa prompt pushed directly to payer SIM toolkit',
    amountRule: '50 – 5,000,000 ETB (whole integer ETB only)',
    wholeEtbOnly: true,
    phoneLabel: 'M-Pesa Mobile Number',
    phonePlaceholder: '+251 711 223344',
    phoneRequired: true,
    phoneHint: 'Required — must be a valid Ethiopian mobile MSISDN (+251 7xx/9xx or 07xx/09xx).',
    referenceLabel: 'Account Reference',
    referencePlaceholder: 'Max 12 chars ref (optional)',
    referenceMaxLen: 12,
    requirements: [
      'Registered Ethiopian mobile number (+251 7xx/9xx or 07xx/09xx) is mandatory',
      'Amount is rounded to whole integer ETB for Safaricom STK Push',
      'Account reference / note is capped at 12 characters on the USSD prompt',
      'Payer enters M-Pesa PIN directly on handset when prompt arrives',
    ],
  },
};

export interface ServicePackageOption {
  id: number;
  name: string;
  tier: string;
  basePriceEtb: number;
  depositAmountEtb: number;
  priceRangeLabel: string;
}

export interface ServicePaymentFormInput {
  provider?: ServicePaymentProvider;
  serviceId: number;
  paymentPlan: PaymentPlanMode;
  customAmount: string;
  fullName: string;
  email: string;
  phone: string;
  notes?: string;
}

export type ServicePaymentErrors = Partial<Record<'fullName' | 'email' | 'phone' | 'amount', string>>;

export interface GatewayChecklistItem {
  id: string;
  label: string;
  met: boolean;
  required: boolean;
}

/**
 * Parses the starting ETB numeric value from service catalog price strings (e.g. "10,000 – 18,000" -> 10000).
 */
export function parseStartingEtbPrice(priceLabel: string): number {
  const firstSegment = String(priceLabel || '').split(/[–-]/)[0] || '';
  const digits = firstSegment.replace(/[^0-9]/g, '');
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10000;
}

/**
 * Derives clean payable service options from the AFRO-TECH digital services catalog.
 */
export const PAYABLE_SERVICES: readonly ServicePackageOption[] = services.map((s) => {
  const basePriceEtb = parseStartingEtbPrice(s.price);
  return {
    id: s.id,
    name: s.type,
    tier: s.tier,
    basePriceEtb,
    depositAmountEtb: Math.round(basePriceEtb * 0.4),
    priceRangeLabel: `${s.price} ETB`,
  };
});

/**
 * Computes the payable ETB amount for the selected service and payment option.
 */
export function resolvePayableAmount(
  serviceId: number,
  paymentPlan: PaymentPlanMode,
  customAmount: string,
): number {
  if (paymentPlan === 'custom') {
    const cleaned = Number(String(customAmount || '').replace(/,/g, '').trim());
    return Number.isFinite(cleaned) ? Math.round(cleaned * 100) / 100 : 0;
  }
  const pkg = PAYABLE_SERVICES.find((s) => s.id === serviceId) ?? PAYABLE_SERVICES[0];
  return paymentPlan === 'full' ? pkg.basePriceEtb : pkg.depositAmountEtb;
}

/**
 * Formats currency cleanly with tabular-friendly numerals.
 */
export function formatEtb(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${Math.round(safe).toLocaleString('en-US')} ETB`;
}

/**
 * Checks whether a phone string is a valid Ethiopian mobile MSISDN (+2517/9... or 07/09...).
 */
export function isEthiopianMobileNumber(phone: string): boolean {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  return (
    (digits.startsWith('251') && digits.length === 12 && (digits[3] === '7' || digits[3] === '9')) ||
    (digits.startsWith('0') && digits.length === 10 && (digits[1] === '7' || digits[1] === '9')) ||
    (digits.length === 9 && (digits[0] === '7' || digits[0] === '9'))
  );
}

/**
 * Formats an Ethiopian mobile number into Safaricom M-Pesa 251XXXXXXXXX preview format.
 */
export function formatMpesaMsisdnPreview(phone: string): string | null {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (!isEthiopianMobileNumber(digits)) return null;
  if (digits.startsWith('251')) return digits;
  if (digits.startsWith('0')) return `251${digits.slice(1)}`;
  return `251${digits}`;
}

/**
 * Evaluates gateway-specific pre-checkout readiness items dynamically as user switches gateways or types.
 */
export function evaluateGatewayReadiness(input: ServicePaymentFormInput): GatewayChecklistItem[] {
  const provider = input.provider ?? 'chapa';
  const spec = GATEWAY_REQUIREMENTS[provider];
  const amount = resolvePayableAmount(input.serviceId, input.paymentPlan, input.customAmount);
  const effectiveAmount = spec.wholeEtbOnly ? Math.round(amount) : amount;
  const hasIdentity = input.fullName.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim());
  const validAmount = Number.isFinite(effectiveAmount) && effectiveAmount >= 50 && effectiveAmount <= 5_000_000;
  const cleanPhone = input.phone.trim();
  const phoneValid =
    provider === 'mpesa'
      ? isEthiopianMobileNumber(cleanPhone)
      : !cleanPhone || /^[+\d][\d\s-]{6,18}$/.test(cleanPhone);

  const items: GatewayChecklistItem[] = [
    {
      id: 'identity',
      label: 'Payer name & receipt email',
      met: hasIdentity,
      required: true,
    },
    {
      id: 'amount',
      label: spec.wholeEtbOnly
        ? `Whole ETB amount (${validAmount ? `${Math.round(amount).toLocaleString('en-US')} ETB` : 'min 50 ETB'})`
        : 'Amount within 50 – 5,000,000 ETB',
      met: validAmount,
      required: true,
    },
  ];

  if (provider === 'mpesa') {
    const preview = formatMpesaMsisdnPreview(cleanPhone);
    items.push({
      id: 'phone',
      label: preview ? `M-Pesa MSISDN ready (${preview})` : 'M-Pesa phone (+251 7xx / 9xx) required',
      met: phoneValid,
      required: true,
    });
  } else if (provider === 'telebirr') {
    items.push({
      id: 'phone',
      label: cleanPhone
        ? phoneValid
          ? 'TeleBirr wallet number valid'
          : 'Check TeleBirr phone format'
        : 'TeleBirr wallet phone (optional pre-fill)',
      met: phoneValid && Boolean(cleanPhone),
      required: false,
    });
  } else {
    items.push({
      id: 'phone',
      label: cleanPhone
        ? phoneValid
          ? 'Wallet pre-fill phone ready'
          : 'Check phone number format'
        : 'Optional mobile pre-fill for hosted page',
      met: phoneValid && Boolean(cleanPhone),
      required: false,
    });
  }

  return items;
}

/**
 * Validates customer & amount fields before calling Chapa, Telebirr, or M-Pesa initialization endpoints.
 */
export function validateServicePaymentForm(input: ServicePaymentFormInput): {
  valid: boolean;
  amount: number;
  errors: ServicePaymentErrors;
} {
  const errors: ServicePaymentErrors = {};
  const provider = input.provider ?? 'chapa';
  const cleanName = input.fullName.trim();
  const cleanEmail = input.email.trim();
  const cleanPhone = input.phone.trim();
  const rawAmount = resolvePayableAmount(input.serviceId, input.paymentPlan, input.customAmount);
  const amount = GATEWAY_REQUIREMENTS[provider].wholeEtbOnly ? Math.round(rawAmount) : rawAmount;

  if (cleanName.length < 2) {
    errors.fullName = 'Please enter your full name (min 2 characters).';
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    errors.email = 'Please enter a valid email for your payment receipt.';
  }
  if (provider === 'mpesa') {
    if (!isEthiopianMobileNumber(cleanPhone)) {
      errors.phone = 'Enter an Ethiopian mobile number for M-Pesa STK Push (e.g. +251 711 223344).';
    }
  } else if (cleanPhone && !/^[+\d][\d\s-]{6,18}$/.test(cleanPhone)) {
    errors.phone = 'Enter a valid phone number (e.g. +251 910 011 818).';
  }
  if (!Number.isFinite(amount) || amount < 50 || amount > 5_000_000) {
    errors.amount = 'Enter a valid ETB amount between 50 and 5,000,000 ETB.';
  }

  return {
    valid: Object.keys(errors).length === 0,
    amount,
    errors,
  };
}
