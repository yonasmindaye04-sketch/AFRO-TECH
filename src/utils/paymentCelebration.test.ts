import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUBTLE_CONFETTI_OPTIONS,
  celebrateVerifiedPayment,
  isBackendPaymentVerified,
  resetCelebratedPayments,
  shouldCelebratePaymentVerification,
} from './paymentCelebration';

test('isBackendPaymentVerified requires explicit verified flag and non-failed status', () => {
  assert.equal(isBackendPaymentVerified({ verified: true, status: 'settled' }), true);
  assert.equal(isBackendPaymentVerified({ verified: true, status: 'success' }), true);
  assert.equal(isBackendPaymentVerified({ verified: true }), true);
  assert.equal(isBackendPaymentVerified({ verified: false, status: 'settled' }), false);
  assert.equal(isBackendPaymentVerified({ verified: true, status: 'pending' }), false);
  assert.equal(isBackendPaymentVerified({ verified: true, status: 'failed' }), false);
});

test('celebrateVerifiedPayment fires subtle confetti once per verified txRef and blocks duplicates or unverified states', () => {
  const seen = new Set<string>();
  const calls: unknown[] = [];
  const fakeLauncher = (opts: unknown) => {
    calls.push(opts);
  };

  // Must not trigger when backend has not verified payment
  assert.equal(
    celebrateVerifiedPayment({ txRef: 'AFRO-PAY-1001', verified: false, status: 'pending', reducedMotion: false }, fakeLauncher, seen),
    false,
  );
  assert.equal(calls.length, 0);

  // Must not trigger without a txRef
  assert.equal(
    celebrateVerifiedPayment({ txRef: '', verified: true, status: 'settled', reducedMotion: false }, fakeLauncher, seen),
    false,
  );
  assert.equal(calls.length, 0);

  // Triggers cleanly when backend verifies settlement
  assert.equal(
    celebrateVerifiedPayment({ txRef: 'AFRO-PAY-1001', verified: true, status: 'settled', reducedMotion: false }, fakeLauncher, seen),
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal(SUBTLE_CONFETTI_OPTIONS.particleCount! <= 50, true);
  assert.equal(SUBTLE_CONFETTI_OPTIONS.disableForReducedMotion, true);

  // Deduplicates repeat calls for the same txRef
  assert.equal(
    celebrateVerifiedPayment({ txRef: 'AFRO-PAY-1001', verified: true, status: 'settled', reducedMotion: false }, fakeLauncher, seen),
    false,
  );
  assert.equal(calls.length, 1);

  // Fires for a distinct newly verified txRef
  assert.equal(
    celebrateVerifiedPayment({ txRef: 'AFRO-PAY-1002', verified: true, status: 'settled', reducedMotion: false }, fakeLauncher, seen),
    true,
  );
  assert.equal(calls.length, 2);

  resetCelebratedPayments(seen);
  assert.equal(shouldCelebratePaymentVerification({ txRef: 'AFRO-PAY-1001', verified: true, status: 'settled', reducedMotion: false }, seen), true);
});

test('shouldCelebratePaymentVerification respects prefers-reduced-motion', () => {
  const seen = new Set<string>();
  assert.equal(
    shouldCelebratePaymentVerification({ txRef: 'AFRO-PAY-9999', verified: true, status: 'settled', reducedMotion: true }, seen),
    false,
  );
});
