import confetti, { type Options as ConfettiOptions } from 'canvas-confetti';

export const SUBTLE_CONFETTI_COLORS = ['#34d399', '#e5b94c', '#10b981', '#f3e8c0', '#ffffff'] as const;

export const SUBTLE_CONFETTI_OPTIONS: ConfettiOptions = {
  particleCount: 42,
  spread: 58,
  startVelocity: 26,
  gravity: 0.95,
  ticks: 140,
  scalar: 0.85,
  origin: { y: 0.58 },
  colors: [...SUBTLE_CONFETTI_COLORS],
  disableForReducedMotion: true,
  zIndex: 1200,
};

const celebratedTxRefs = new Set<string>();

export interface PaymentVerificationCheck {
  txRef?: string | null;
  verified?: boolean;
  status?: string | null;
  reducedMotion?: boolean;
}

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isBackendPaymentVerified(params: PaymentVerificationCheck): boolean {
  if (params.verified === true) {
    const st = String(params.status || '').trim().toLowerCase();
    return !st || st === 'settled' || st === 'success';
  }
  return false;
}

export function shouldCelebratePaymentVerification(
  params: PaymentVerificationCheck,
  seenRefs: Set<string> = celebratedTxRefs,
): boolean {
  if (!isBackendPaymentVerified(params)) return false;
  if (params.reducedMotion ?? prefersReducedMotion()) return false;
  const key = String(params.txRef || '').trim();
  if (!key) return false;
  if (seenRefs.has(key)) return false;
  return true;
}

export function celebrateVerifiedPayment(
  params: PaymentVerificationCheck,
  launcher: (opts: ConfettiOptions) => unknown = confetti,
  seenRefs: Set<string> = celebratedTxRefs,
): boolean {
  if (!shouldCelebratePaymentVerification(params, seenRefs)) {
    return false;
  }
  const key = String(params.txRef || '').trim();
  seenRefs.add(key);

  if (typeof window === 'undefined' && launcher === confetti) {
    return false;
  }

  try {
    void launcher(SUBTLE_CONFETTI_OPTIONS);
    return true;
  } catch {
    return false;
  }
}

export function resetCelebratedPayments(seenRefs: Set<string> = celebratedTxRefs): void {
  seenRefs.clear();
}
