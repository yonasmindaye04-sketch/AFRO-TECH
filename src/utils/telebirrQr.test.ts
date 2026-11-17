import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelebirrQrRequestSignature,
  formatQrExpiryCountdown,
  normalizeTelebirrQrSession,
  renderTelebirrQrDataUrl,
} from './telebirrQr';

test('buildTelebirrQrRequestSignature distinguishes distinct orders cleanly', () => {
  const sigA = buildTelebirrQrRequestSignature({
    serviceId: 1,
    paymentPlan: 'deposit',
    amount: 4000,
    fullName: 'Abebe Bikila',
    email: 'abebe@example.com',
    notes: 'Phase 1',
  });
  const sigB = buildTelebirrQrRequestSignature({
    serviceId: 1,
    paymentPlan: 'full',
    amount: 10000,
    fullName: 'Abebe Bikila',
    email: 'abebe@example.com',
    notes: 'Phase 1',
  });
  assert.notEqual(sigA, sigB);
});

test('normalizeTelebirrQrSession validates required tx_ref & qr_payload and normalizes fields', () => {
  assert.equal(normalizeTelebirrQrSession(null), null);
  assert.equal(normalizeTelebirrQrSession({ ok: true, tx_ref: 'TB-QR-1' }), null);

  const normalized = normalizeTelebirrQrSession({
    ok: true,
    tx_ref: 'TB-QR-7788',
    token: 'tbqr-1234',
    mode: 'live',
    amount: 4000,
    currency: 'ETB',
    service_name: 'Landing Page',
    qr_payload: 'RECEIVE_CODE_7788',
    qr_data_url: 'data:image/png;base64,iVBORw0KGgo=',
    checkout_url: 'https://196.188.120.3:38443/paygate?prepay_id=99',
    prepay_id: 'PRE-99',
    receive_code: 'RECEIVE_CODE_7788',
    merchant_code_masked: '55••20',
    expires_at: '2026-11-16T21:00:00.000Z',
  });

  assert.ok(normalized);
  assert.equal(normalized.txRef, 'TB-QR-7788');
  assert.equal(normalized.mode, 'live');
  assert.equal(normalized.receiveCode, 'RECEIVE_CODE_7788');
  assert.equal(normalized.qrDataUrl, 'data:image/png;base64,iVBORw0KGgo=');
});

test('formatQrExpiryCountdown formats MM:SS accurately and detects expiry', () => {
  const now = Date.parse('2026-11-16T20:00:00.000Z');
  const future = '2026-11-16T20:14:05.000Z';
  assert.deepEqual(formatQrExpiryCountdown(future, now), {
    label: '14:05',
    expired: false,
    remainingSec: 845,
  });

  const past = '2026-11-16T19:59:50.000Z';
  assert.deepEqual(formatQrExpiryCountdown(past, now), {
    label: '00:00',
    expired: true,
    remainingSec: 0,
  });
});

test('renderTelebirrQrDataUrl renders a valid PNG data URL for transaction payloads', async () => {
  const dataUrl = await renderTelebirrQrDataUrl('https://afrotech.et/pay/tbqr-123?scan=telebirr&tx_ref=TB-QR-1');
  assert.match(dataUrl, /^data:image\/png;base64,/);
  assert.ok(dataUrl.length > 200);
});
