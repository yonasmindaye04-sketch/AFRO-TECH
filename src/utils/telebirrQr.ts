import QRCode from 'qrcode';
import type { PaymentPlanMode } from './serviceCheckout';

export const TELEBIRR_QR_TTL_MS = 15 * 60 * 1000;

export interface TelebirrQrSession {
  txRef: string;
  token: string;
  mode: 'live' | 'sandbox';
  amount: number;
  currency: string;
  serviceName: string;
  qrPayload: string;
  qrDataUrl: string | null;
  checkoutUrl: string;
  prepayId: string | null;
  receiveCode: string | null;
  merchantCodeMasked: string | null;
  createdAt: string | null;
  expiresAt: string | null;
}

export function buildTelebirrQrRequestSignature(input: {
  serviceId: number;
  paymentPlan: PaymentPlanMode;
  amount: number;
  fullName: string;
  email: string;
  notes: string;
}): string {
  return [
    input.serviceId,
    input.paymentPlan,
    Math.round(Number(input.amount || 0) * 100),
    input.fullName.trim().toLowerCase(),
    input.email.trim().toLowerCase(),
    input.notes.trim(),
  ].join('|');
}

export function normalizeTelebirrQrSession(raw: unknown): TelebirrQrSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const txRef = typeof obj.tx_ref === 'string' ? obj.tx_ref.trim() : '';
  const qrPayload = typeof obj.qr_payload === 'string' ? obj.qr_payload.trim() : '';
  if (!txRef || !qrPayload) return null;

  const amountNum = Number(obj.amount || 0);
  return {
    txRef,
    token: typeof obj.token === 'string' ? obj.token.trim() : '',
    mode: obj.mode === 'live' ? 'live' : 'sandbox',
    amount: Number.isFinite(amountNum) ? amountNum : 0,
    currency: typeof obj.currency === 'string' && obj.currency.trim() ? obj.currency.trim() : 'ETB',
    serviceName:
      typeof obj.service_name === 'string' && obj.service_name.trim()
        ? obj.service_name.trim()
        : 'Digital Service Package',
    qrPayload,
    qrDataUrl:
      typeof obj.qr_data_url === 'string' && obj.qr_data_url.startsWith('data:image/')
        ? obj.qr_data_url
        : null,
    checkoutUrl: typeof obj.checkout_url === 'string' ? obj.checkout_url.trim() : '',
    prepayId: typeof obj.prepay_id === 'string' && obj.prepay_id.trim() ? obj.prepay_id.trim() : null,
    receiveCode:
      typeof obj.receive_code === 'string' && obj.receive_code.trim() ? obj.receive_code.trim() : null,
    merchantCodeMasked:
      typeof obj.merchant_code_masked === 'string' && obj.merchant_code_masked.trim()
        ? obj.merchant_code_masked.trim()
        : null,
    createdAt: typeof obj.created_at === 'string' && obj.created_at.trim() ? obj.created_at.trim() : null,
    expiresAt: typeof obj.expires_at === 'string' && obj.expires_at.trim() ? obj.expires_at.trim() : null,
  };
}

export function formatQrExpiryCountdown(
  expiresAtIso: string | null,
  nowMs = Date.now(),
): { label: string; expired: boolean; remainingSec: number } {
  if (!expiresAtIso) {
    return { label: '15:00', expired: false, remainingSec: 900 };
  }
  const expiresMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresMs)) {
    return { label: '15:00', expired: false, remainingSec: 900 };
  }
  const diffSec = Math.max(0, Math.floor((expiresMs - nowMs) / 1000));
  if (diffSec === 0) {
    return { label: '00:00', expired: true, remainingSec: 0 };
  }
  const mins = String(Math.floor(diffSec / 60)).padStart(2, '0');
  const secs = String(diffSec % 60).padStart(2, '0');
  return { label: `${mins}:${secs}`, expired: false, remainingSec: diffSec };
}

export async function renderTelebirrQrDataUrl(qrPayload: string): Promise<string> {
  return QRCode.toDataURL(qrPayload, {
    errorCorrectionLevel: 'M',
    margin: 2,
    width: 320,
    color: {
      dark: '#0B0C10',
      light: '#FFFFFF',
    },
  });
}
