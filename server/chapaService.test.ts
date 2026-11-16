import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChapaInitPayload,
  initializeChapaPayment,
  sanitizeChapaError,
  splitCustomerName,
  verifyChapaPayment,
} from './chapaService.js';

test('splitCustomerName splits full name safely with fallback last name', () => {
  assert.deepEqual(splitCustomerName('Abebe Kebede Tesfaye'), { firstName: 'Abebe', lastName: 'Kebede Tesfaye' });
  assert.deepEqual(splitCustomerName('Selam'), { firstName: 'Selam', lastName: 'Client' });
});

test('buildChapaInitPayload formats valid Chapa initialize request body', () => {
  const payload = buildChapaInitPayload({
    amount: 12500,
    currency: 'etb',
    email: 'buyer@example.com',
    fullName: 'Dawit Mekonnen',
    phone: '+251 910 011 818',
    txRef: 'CHAPA-SVC-1234',
    callbackUrl: 'https://afrotech.et/api/chapa/webhook',
    returnUrl: 'https://afrotech.et/services?tx_ref=CHAPA-SVC-1234',
    serviceTitle: 'ERP System',
    description: 'ERP System (40% Kickoff Deposit)',
  });

  assert.equal(payload.amount, '12500');
  assert.equal(payload.currency, 'ETB');
  assert.equal(payload.first_name, 'Dawit');
  assert.equal(payload.last_name, 'Mekonnen');
  assert.equal(payload.phone_number, '+251910011818');
  assert.equal(payload.tx_ref, 'CHAPA-SVC-1234');
  assert.ok(payload.customization.title.length <= 16);
});

test('initializeChapaPayment sends Bearer CHAPA_SECRET_KEY and extracts checkout_url', async () => {
  let capturedUrl = '';
  let capturedAuth = '';
  let capturedBody = '';

  const mockFetch = async (url, opts) => {
    capturedUrl = url;
    capturedAuth = opts.headers.Authorization;
    capturedBody = opts.body;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        message: 'Hosted Link',
        status: 'success',
        data: { checkout_url: 'https://checkout.chapa.co/checkout/payment/abc123' },
      }),
    };
  };

  const payload = buildChapaInitPayload({
    amount: 7000,
    email: 'client@business.et',
    fullName: 'Sara Hailu',
    txRef: 'CHAPA-SVC-TEST1',
    callbackUrl: 'https://example.com/cb',
    returnUrl: 'https://example.com/ret',
    serviceTitle: 'Landing Page',
    description: 'Landing Page deposit',
  });

  const result = await initializeChapaPayment({
    secretKey: 'CHASECK_TEST-secret-key-xyz',
    payload,
    fetchFn: mockFetch,
  });

  assert.equal(result.ok, true);
  assert.equal(result.checkoutUrl, 'https://checkout.chapa.co/checkout/payment/abc123');
  assert.equal(capturedUrl, 'https://api.chapa.co/v1/transaction/initialize');
  assert.equal(capturedAuth, 'Bearer CHASECK_TEST-secret-key-xyz');
  assert.equal(JSON.parse(capturedBody).tx_ref, 'CHAPA-SVC-TEST1');
});

test('verifyChapaPayment checks transaction status and sanitizeChapaError redacts secrets', async () => {
  const redaction = sanitizeChapaError('Bad key CHASECK_TEST-secret-123 failed', 'CHASECK_TEST-secret-123');
  assert.equal(redaction.includes('CHASECK_TEST-secret-123'), false);

  const missing = await initializeChapaPayment({ secretKey: '', payload: {} });
  assert.equal(missing.ok, false);
  assert.equal(missing.configured, false);

  const verifyResult = await verifyChapaPayment({
    secretKey: 'CHASECK_TEST-secret-key-xyz',
    txRef: 'CHAPA-SVC-TEST1',
    fetchFn: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        status: 'success',
        data: { status: 'success', amount: 7000, currency: 'ETB', reference: 'AP123456' },
      }),
    }),
  });

  assert.equal(verifyResult.ok, true);
  assert.equal(verifyResult.verified, true);
  assert.equal(verifyResult.amount, 7000);
  assert.equal(verifyResult.reference, 'AP123456');
});
