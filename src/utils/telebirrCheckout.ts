import {
  formatEtb,
  PAYABLE_SERVICES,
  resolvePayableAmount,
  validateOptionalReceiptEmail,
  validateServicePaymentForm,
  type PaymentPlanMode,
  type ServicePaymentErrors,
} from './serviceCheckout';

export { validateOptionalReceiptEmail };

export const TELEBIRR_NOTE_MAX_LEN = 24;
export const TELEBIRR_GATEWAY_HEARTBEAT_MS = 15000;
export const TELEBIRR_SESSION_TTL_MS = 10 * 60 * 1000;

export type TelebirrConnectionStatus = 'live' | 'pending';

export interface TelebirrMerchantConfig {
  mode: 'live' | 'sandbox';
  merchantConfigured: boolean;
  merchantCodeMasked: string | null;
  publicKeyConfigured: boolean;
  webGatewayHost: string;
  connectionStatus: TelebirrConnectionStatus;
  connectionReason: string;
  checkedAt: string | null;
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

  const connectionStatus: TelebirrConnectionStatus =
    obj.connection_status === 'live'
      ? 'live'
      : obj.connection_status === 'pending'
        ? 'pending'
        : mode === 'live' && obj.gateway_reachable !== false
          ? 'live'
          : 'pending';

  const connectionReason =
    typeof obj.connection_reason === 'string' && obj.connection_reason.trim()
      ? obj.connection_reason.trim()
      : connectionStatus === 'live'
        ? 'Connected to Telebirr Fabric merchant gateway.'
        : 'Awaiting live Telebirr merchant gateway connection.';

  const checkedAt =
    typeof obj.checked_at === 'string' && obj.checked_at.trim() ? obj.checked_at.trim() : null;

  return {
    mode,
    merchantConfigured,
    merchantCodeMasked,
    publicKeyConfigured,
    webGatewayHost,
    connectionStatus,
    connectionReason,
    checkedAt,
  };
}

export function resolveTelebirrGatewayIndicator(input: {
  probing: boolean;
  config: TelebirrMerchantConfig;
  networkError?: boolean;
}): {
  status: TelebirrConnectionStatus;
  label: 'Live' | 'Pending';
  detail: string;
} {
  if (input.networkError) {
    return {
      status: 'pending',
      label: 'Pending',
      detail: 'Reconnecting to Telebirr gateway…',
    };
  }
  if (input.probing && !input.config.checkedAt) {
    return {
      status: 'pending',
      label: 'Pending',
      detail: 'Checking Telebirr merchant gateway…',
    };
  }
  if (input.config.connectionStatus === 'live') {
    return {
      status: 'live',
      label: 'Live',
      detail: input.config.connectionReason,
    };
  }
  return {
    status: 'pending',
    label: 'Pending',
    detail: input.config.connectionReason,
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
 * Validates customer, optional receipt email, Telebirr wallet phone, and ETB amount inputs before H5 preOrder initialization.
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
  receiptEmail: string | null;
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
    receiptEmail: base.receiptEmail,
    sanitizedNote: sanitizeTelebirrOrderNote(input.notes),
    errors: base.errors,
  };
}

export const TELEBIRR_POLL_INTERVAL_MS = 5000;
export const TELEBIRR_MAX_POLL_ATTEMPTS = 60;

export type TelebirrVerifyOutcome = 'verified' | 'pending' | 'failed' | 'error';

/**
 * Classifies /api/telebirr/verify/:txRef responses into deterministic polling outcomes.
 */
export function classifyTelebirrVerifyOutcome(
  resOk: boolean,
  payload: Record<string, unknown> | null,
): TelebirrVerifyOutcome {
  if (!resOk || !payload || payload.ok === false) {
    return 'error';
  }
  if (payload.verified === true) {
    return 'verified';
  }
  const statusUpper = String(payload.status || '').toUpperCase();
  if (['FAILED', 'FAIL', 'CLOSED', 'CANCELLED', 'EXPIRED'].includes(statusUpper)) {
    return 'failed';
  }
  return 'pending';
}

export interface TelebirrSessionCountdown {
  label: string;
  expired: boolean;
  remainingMs: number;
  remainingSec: number;
  isUrgent: boolean;
  progressPct: number;
}

/**
 * Evaluates a 10-minute active Telebirr payment session expiry timestamp into MM:SS countdown state.
 */
export function evaluateTelebirrSessionCountdown(
  expiresAtIso: string | null,
  nowMs = Date.now(),
): TelebirrSessionCountdown {
  const defaultSec = Math.floor(TELEBIRR_SESSION_TTL_MS / 1000);
  if (!expiresAtIso) {
    return {
      label: '10:00',
      expired: false,
      remainingMs: TELEBIRR_SESSION_TTL_MS,
      remainingSec: defaultSec,
      isUrgent: false,
      progressPct: 100,
    };
  }
  const expiresMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresMs)) {
    return {
      label: '10:00',
      expired: false,
      remainingMs: TELEBIRR_SESSION_TTL_MS,
      remainingSec: defaultSec,
      isUrgent: false,
      progressPct: 100,
    };
  }
  const remainingMs = Math.min(TELEBIRR_SESSION_TTL_MS, Math.max(0, expiresMs - nowMs));
  const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
  if (remainingMs <= 0 || remainingSec <= 0) {
    return {
      label: '00:00',
      expired: true,
      remainingMs: 0,
      remainingSec: 0,
      isUrgent: false,
      progressPct: 0,
    };
  }
  const mins = String(Math.floor(remainingSec / 60)).padStart(2, '0');
  const secs = String(remainingSec % 60).padStart(2, '0');
  const progressPct = Math.max(0, Math.min(100, Math.round((remainingMs / TELEBIRR_SESSION_TTL_MS) * 100)));
  return {
    label: `${mins}:${secs}`,
    expired: false,
    remainingMs,
    remainingSec,
    isUrgent: remainingSec <= 120,
    progressPct,
  };
}

export interface TelebirrPollDecision {
  shouldPoll: boolean;
  reason: 'active' | 'idle' | 'verified' | 'paused' | 'failed' | 'expired' | 'max_attempts';
}

/**
 * Pure guard determining whether 5-second automatic Telebirr verification polling should continue.
 */
export function evaluateTelebirrPollCycle(input: {
  activeTxRef: string | null;
  verified: boolean;
  terminalFailure?: boolean;
  expired?: boolean;
  paused: boolean;
  attempts: number;
  maxAttempts?: number;
}): TelebirrPollDecision {
  if (!input.activeTxRef) {
    return { shouldPoll: false, reason: 'idle' };
  }
  if (input.verified) {
    return { shouldPoll: false, reason: 'verified' };
  }
  if (input.expired) {
    return { shouldPoll: false, reason: 'expired' };
  }
  if (input.terminalFailure) {
    return { shouldPoll: false, reason: 'failed' };
  }
  if (input.paused) {
    return { shouldPoll: false, reason: 'paused' };
  }
  const cap = input.maxAttempts ?? TELEBIRR_MAX_POLL_ATTEMPTS;
  if (input.attempts >= cap) {
    return { shouldPoll: false, reason: 'max_attempts' };
  }
  return { shouldPoll: true, reason: 'active' };
}

export interface TelebirrErrorLogEntry {
  id: string;
  timestamp: string;
  stage: string;
  code: string;
  statusCode: number | null;
  message: string;
  txRef: string | null;
  repeatCount: number;
}

const TELEBIRR_STAGE_LABELS: Record<string, string> = {
  config: 'Config Check',
  validation: 'Validation',
  fabric_token: 'Fabric Auth',
  pre_order: 'H5 Pre-Order',
  initialize: 'H5 Initialize',
  query_order: 'Verify Query',
  verify_lookup: 'Order Lookup',
  invoice: 'PDF Invoice',
  network: 'Network',
};

export function formatTelebirrStageLabel(stage: string): string {
  const clean = String(stage || '').trim().toLowerCase();
  return TELEBIRR_STAGE_LABELS[clean] || (clean ? clean.replace(/_/g, ' ') : 'Gateway');
}

/**
 * Extracts specific backend error code, stage, HTTP status, and message from a Telebirr API response.
 */
export function extractTelebirrBackendError(input: {
  resStatus?: number | null;
  payload?: Record<string, unknown> | null;
  defaultStage: string;
  fallbackMessage: string;
  txRef?: string | null;
  timestamp?: string;
}): TelebirrErrorLogEntry {
  const p = input.payload && typeof input.payload === 'object' ? input.payload : {};
  const rawMsg = [p.query_error, p.message, p.error, p.errorMsg, p.msg]
    .find((v) => typeof v === 'string' && v.trim().length > 0);
  const message = typeof rawMsg === 'string' ? rawMsg.trim() : input.fallbackMessage;

  const statusVal =
    typeof p.status_code === 'number'
      ? p.status_code
      : typeof p.statusCode === 'number'
        ? p.statusCode
        : typeof input.resStatus === 'number' && input.resStatus > 0
          ? input.resStatus
          : null;

  const rawCode = [p.error_code, p.code, p.errorCode]
    .find((v) => typeof v === 'string' && v.trim().length > 0);
  const code =
    typeof rawCode === 'string'
      ? rawCode.trim()
      : statusVal
        ? `HTTP_${statusVal}`
        : 'TELEBIRR_ERROR';

  const rawStage = typeof p.stage === 'string' && p.stage.trim() ? p.stage.trim() : input.defaultStage;
  const txRef =
    (typeof input.txRef === 'string' && input.txRef.trim()) ||
    (typeof p.tx_ref === 'string' && p.tx_ref.trim()) ||
    null;

  const ts = input.timestamp || new Date().toISOString();

  return {
    id: `tb-err-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: ts,
    stage: rawStage,
    code,
    statusCode: statusVal,
    message,
    txRef,
    repeatCount: 1,
  };
}

/**
 * Prepends a Telebirr error entry, coalescing consecutive identical errors (e.g. during 5s polling).
 */
export function appendTelebirrErrorLog(
  entries: TelebirrErrorLogEntry[],
  next: TelebirrErrorLogEntry,
  maxEntries = 20,
): TelebirrErrorLogEntry[] {
  const latest = entries[0];
  if (
    latest &&
    latest.stage === next.stage &&
    latest.code === next.code &&
    latest.message === next.message &&
    latest.txRef === next.txRef
  ) {
    return [
      {
        ...latest,
        timestamp: next.timestamp,
        statusCode: next.statusCode ?? latest.statusCode,
        repeatCount: latest.repeatCount + 1,
      },
      ...entries.slice(1),
    ];
  }

  return [next, ...entries].slice(0, Math.max(1, maxEntries));
}

