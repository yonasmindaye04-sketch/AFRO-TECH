import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  buildTelebirrCheckoutUrl,
  buildTelebirrPreOrderPayload,
  buildTelebirrSignString,
  initializeTelebirrOrder,
  queryTelebirrOrder,
  verifyTelebirrSignature,
} from './telebirrService.js';

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('buildTelebirrSignString sorts root and biz_content keys alphabetically while excluding sign fields', () => {
  const raw = buildTelebirrSignString({
    version: '1.0',
    sign: 'should-skip',
    sign_type: 'SHA256WithRSA',
    biz_content: {
      total_amount: '4000',
      appid: 'M-APP-1',
    },
    method: 'payment.preorder',
  });
  assert.equal(raw, 'appid=M-APP-1&method=payment.preorder&total_amount=4000&version=1.0');
});

test('buildTelebirrPreOrderPayload signs SHA256WithRSA payloads verifiable with matching public key', () => {
  const payload = buildTelebirrPreOrderPayload({
    merchantAppId: 'M-APP-99',
    merchantCode: '554120',
    merchOrderId: 'TB-SVC-AABB1122',
    title: 'Landing Page Deposit',
    amount: 4000,
    notifyUrl: 'https://afrotech.et/api/telebirr/notify',
    redirectUrl: 'https://afrotech.et/services?tx_ref=TB-SVC-AABB1122',
    privateKey,
    timestamp: '1760000000',
    nonceStr: 'nonce123',
  });

  assert.equal(payload.method, 'payment.preorder');
  assert.equal(payload.sign_type, 'SHA256WithRSA');
  assert.equal(payload.biz_content.total_amount, '4000');
  assert.ok(payload.sign);
  assert.equal(verifyTelebirrSignature(payload, payload.sign, publicKey), true);
  assert.equal(verifyTelebirrSignature({ ...payload, version: '2.0' }, payload.sign, publicKey), false);
});

test('buildTelebirrCheckoutUrl constructs signed H5 redirect link', () => {
  const url = buildTelebirrCheckoutUrl({
    prepayId: 'PREPAY-8899',
    merchantAppId: 'M-APP-99',
    merchantCode: '554120',
    privateKey,
    webBaseUrl: 'https://telebirr.test/paygate',
  });
  assert.match(url, /^https:\/\/telebirr\.test\/paygate\?appid=M-APP-99/);
  assert.match(url, /prepay_id=PREPAY-8899/);
  assert.match(url, /sign_type=SHA256WithRSA/);
});

test('initializeTelebirrOrder & queryTelebirrOrder call /payment/v1/token, preOrder, and queryOrder cleanly', async () => {
  const calls = [];
  const mockFetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    if (String(url).endsWith('/payment/v1/token')) {
      return new Response(JSON.stringify({ token: 'Bearer fabric-tok-1' }), { status: 200 });
    }
    if (String(url).endsWith('/payment/v1/merchant/preOrder')) {
      return new Response(
        JSON.stringify({
          biz_content: { prepay_id: 'PRE-777' },
          data: { receiveCode: 'RC-777' },
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({
        biz_content: { order_status: 'PAY_SUCCESS', payment_order_id: 'TB-999111', total_amount: '4000' },
      }),
      { status: 200 },
    );
  };

  const config = {
    baseUrl: 'https://tb.sandbox.test',
    webBaseUrl: 'https://tb.sandbox.test/web',
    fabricAppId: 'FAB-01',
    appSecret: 'SECRET-FABRIC-999',
    merchantAppId: 'M-APP-99',
    merchantCode: '554120',
    privateKey,
  };

  const initRes = await initializeTelebirrOrder({
    config,
    orderParams: {
      merchOrderId: 'TB-SVC-1234',
      title: 'Web Portal',
      amount: 4000,
      notifyUrl: 'https://afrotech.et/api/telebirr/notify',
      redirectUrl: 'https://afrotech.et/services',
    },
    fetchFn: mockFetch,
  });

  assert.equal(initRes.ok, true);
  assert.equal(initRes.prepayId, 'PRE-777');
  assert.equal(initRes.receiveCode, 'RC-777');
  assert.match(initRes.checkoutUrl, /prepay_id=PRE-777/);
  assert.equal(calls[0].headers['X-APP-Key'], 'FAB-01');
  assert.equal(calls[1].headers.Authorization, 'Bearer fabric-tok-1');

  const queryRes = await queryTelebirrOrder({ config, merchOrderId: 'TB-SVC-1234', fetchFn: mockFetch });
  assert.equal(queryRes.verified, true);
  assert.equal(queryRes.reference, 'TB-999111');
});
