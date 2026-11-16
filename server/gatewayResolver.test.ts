import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  initiateGatewayCheckout,
  normalizeGatewayProvider,
  resolveGatewayRuntime,
  verifyGatewaySettlement,
} from './gatewayResolver.js';

const { privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

function buildStore({ telebirrLive = false } = {}) {
  return {
    paymentGateways: {
      cbe_bank: {
        provider: 'cbe_bank',
        enabled: true,
        configured: true,
        is_default: true,
        mode: 'sandbox',
        public_config: { account_holder: 'Bole Pharmacy', settlement_account: '1000248910332', bank_name: 'CBE Bole' },
        encrypted_secrets: {},
      },
      telebirr: telebirrLive
        ? {
            provider: 'telebirr',
            enabled: true,
            configured: true,
            is_default: false,
            mode: 'live',
            public_config: {
              merchant_id: '554120',
              fabric_app_id: 'FAB-123',
              merchant_app_id: 'MAPP-123',
              settlement_account: '+251911000111',
            },
            encrypted_secrets: {
              secret_key: 'enc:tb-secret',
              private_key: 'enc:tb-priv',
            },
          }
        : {
            provider: 'telebirr',
            enabled: false,
            configured: false,
            is_default: false,
            mode: 'sandbox',
            public_config: {},
            encrypted_secrets: {},
          },
      mpesa: {
        provider: 'mpesa',
        enabled: true,
        configured: true,
        is_default: false,
        mode: 'sandbox',
        public_config: { merchant_id: '174379' },
        encrypted_secrets: {},
      },
    },
  };
}

test('normalizeGatewayProvider maps POS rails and aliases accurately', () => {
  assert.equal(normalizeGatewayProvider('telebirr'), 'telebirr');
  assert.equal(normalizeGatewayProvider('mpesa'), 'mpesa');
  assert.equal(normalizeGatewayProvider('cbe'), 'cbe_bank');
  assert.equal(normalizeGatewayProvider('card'), 'chapa');
  assert.equal(normalizeGatewayProvider('chapa'), 'chapa');
  assert.equal(normalizeGatewayProvider(''), null);
});

test('resolveGatewayRuntime NEVER silently swaps requested Telebirr to default CBE', () => {
  const store = buildStore({ telebirrLive: false });
  const runtime = resolveGatewayRuntime({ store, provider: 'telebirr', env: {} });
  assert.equal(runtime.ok, true);
  assert.equal(runtime.provider, 'telebirr');
  assert.equal(runtime.mode, 'sandbox');
  assert.notEqual(runtime.provider, 'cbe_bank');
});

test('resolveGatewayRuntime prioritizes tenant live keys and falls back to platform live env keys', () => {
  const decryptFn = (v) => (v === 'enc:tb-priv' ? privateKey : v.replace(/^enc:/, ''));

  const tenantLive = resolveGatewayRuntime({
    store: buildStore({ telebirrLive: true }),
    provider: 'telebirr',
    env: {},
    decryptSecretFn: decryptFn,
  });
  assert.equal(tenantLive.mode, 'live');
  assert.equal(tenantLive.source, 'tenant_live');
  assert.equal(tenantLive.credentials.fabricAppId, 'FAB-123');

  const platformChapa = resolveGatewayRuntime({
    store: buildStore(),
    provider: 'chapa',
    env: { CHAPA_SECRET_KEY: 'CHASECK_TEST-live-env' },
    decryptSecretFn: decryptFn,
  });
  assert.equal(platformChapa.mode, 'live');
  assert.equal(platformChapa.source, 'platform_live');
  assert.equal(platformChapa.credentials.secretKey, 'CHASECK_TEST-live-env');
});

test('initiateGatewayCheckout & verifyGatewaySettlement execute real Chapa flow without faking settlement', async () => {
  const runtime = resolveGatewayRuntime({
    store: buildStore(),
    provider: 'chapa',
    env: { CHAPA_SECRET_KEY: 'CHASECK_TEST-real-123' },
  });

  const missingEmail = await initiateGatewayCheckout({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-1010', amount: 505, currency: 'ETB', party_name: 'Abebe' },
    callbacks: { chapaCallbackUrl: 'https://a.test/cb', returnUrl: 'https://a.test/ret' },
  });
  assert.equal(missingEmail.ok, false);
  assert.equal(missingEmail.statusCode, 400);

  const initOk = await initiateGatewayCheckout({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-1010', amount: 505, currency: 'ETB', party_name: 'Abebe Bikila' },
    payerEmail: 'abebe@et.com',
    callbacks: { chapaCallbackUrl: 'https://a.test/cb', returnUrl: 'https://a.test/ret' },
    fetchFn: async () =>
      new Response(JSON.stringify({ status: 'success', data: { checkout_url: 'https://checkout.chapa.co/pay/xyz' } }), {
        status: 200,
      }),
  });
  assert.equal(initOk.ok, true);
  assert.equal(initOk.action, 'redirect');
  assert.equal(initOk.checkoutUrl, 'https://checkout.chapa.co/pay/xyz');

  const pendingCheck = await verifyGatewaySettlement({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-1010', status: 'pending' },
    fetchFn: async () =>
      new Response(JSON.stringify({ status: 'success', data: { status: 'pending' } }), { status: 200 }),
  });
  assert.equal(pendingCheck.verified, false);

  const paidCheck = await verifyGatewaySettlement({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-1010', status: 'pending' },
    fetchFn: async () =>
      new Response(JSON.stringify({ status: 'success', data: { status: 'success', reference: 'AP998877' } }), {
        status: 200,
      }),
  });
  assert.equal(paidCheck.verified, true);
  assert.equal(paidCheck.payerReference, 'AP998877');
});

test('initiateGatewayCheckout & verifyGatewaySettlement execute real M-Pesa STK Push and status query', async () => {
  const runtime = resolveGatewayRuntime({
    store: buildStore(),
    provider: 'mpesa',
    env: {
      MPESA_CONSUMER_KEY: 'ck',
      MPESA_CONSUMER_SECRET: 'cs',
      MPESA_SHORTCODE: '174379',
      MPESA_PASSKEY: 'pk',
    },
  });

  const mockFetch = async (url) => {
    if (String(url).includes('/v1/token/generate')) {
      return new Response(JSON.stringify({ access_token: 'tok-mp' }), { status: 200 });
    }
    if (String(url).includes('/mpesa/stkpush/v3/processrequest')) {
      return new Response(
        JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_REAL_01', CustomerMessage: 'Enter M-Pesa PIN' }),
        { status: 200 },
      );
    }
    return new Response(JSON.stringify({ ResultCode: '0', ResultDesc: 'Paid' }), { status: 200 });
  };

  const push = await initiateGatewayCheckout({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-2020', amount: 505, currency: 'ETB' },
    payerPhone: '0711223344',
    callbacks: { mpesaCallbackUrl: 'https://a.test/api/mpesa/callback' },
    fetchFn: mockFetch,
  });
  assert.equal(push.ok, true);
  assert.equal(push.action, 'stk_poll');
  assert.equal(push.checkoutRequestId, 'ws_CO_REAL_01');

  const statusRes = await verifyGatewaySettlement({
    runtime,
    intent: { tx_ref: 'AFRO-PAY-2020', status: 'pending', checkout_request_id: 'ws_CO_REAL_01' },
    fetchFn: mockFetch,
  });
  assert.equal(statusRes.verified, true);
});
