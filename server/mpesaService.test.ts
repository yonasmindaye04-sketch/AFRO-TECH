import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMpesaPassword,
  buildMpesaStkPayload,
  initiateMpesaStkPush,
  normalizeMpesaPhone,
  parseMpesaCallback,
  queryMpesaStkStatus,
} from './mpesaService.js';

test('normalizeMpesaPhone converts Ethiopian mobile variants to 251XXXXXXXXX', () => {
  assert.equal(normalizeMpesaPhone('+251 711 223 344'), '251711223344');
  assert.equal(normalizeMpesaPhone('0711223344'), '251711223344');
  assert.equal(normalizeMpesaPhone('0911223344'), '251911223344');
  assert.equal(normalizeMpesaPhone('12345'), null);
});

test('buildMpesaStkPayload encodes password and MSISDN fields accurately', () => {
  const payload = buildMpesaStkPayload({
    shortCode: '174379',
    passkey: 'passkey-test',
    amount: 4000,
    phoneNumber: '0711223344',
    callbackUrl: 'https://afrotech.et/api/mpesa/callback',
    accountReference: 'MPESA-SVC-01',
    transactionDesc: 'ERP Deposit',
    timestamp: '20261115120000',
  });

  assert.equal(payload.BusinessShortCode, '174379');
  assert.equal(payload.Password, buildMpesaPassword('174379', 'passkey-test', '20261115120000'));
  assert.equal(payload.PartyA, '251711223344');
  assert.equal(payload.PhoneNumber, '251711223344');
  assert.equal(payload.Amount, '4000');
  assert.equal(payload.TransactionType, 'CustomerPayBillOnline');
});

test('initiateMpesaStkPush & queryMpesaStkStatus authenticate via OAuth and dispatch STK requests', async () => {
  const seen = [];
  const mockFetch = async (url, init) => {
    seen.push({ url: String(url), method: init.method, auth: init.headers.Authorization });
    if (String(url).includes('/v1/token/generate')) {
      return new Response(JSON.stringify({ access_token: 'mpesa-tok-123', expires_in: '3599' }), { status: 200 });
    }
    if (String(url).includes('/mpesa/stkpush/v3/processrequest')) {
      return new Response(
        JSON.stringify({
          ResponseCode: '0',
          MerchantRequestID: 'MR-100',
          CheckoutRequestID: 'ws_CO_112233',
          CustomerMessage: 'Success. Request accepted for processing',
        }),
        { status: 200 },
      );
    }
    return new Response(
      JSON.stringify({ ResultCode: '0', ResultDesc: 'The service request is processed successfully.' }),
      { status: 200 },
    );
  };

  const config = {
    baseUrl: 'https://apisandbox.safaricom.et',
    consumerKey: 'ck-test',
    consumerSecret: 'cs-secret-test',
    shortCode: '174379',
    passkey: 'passkey-secret',
  };

  const push = await initiateMpesaStkPush({
    config,
    orderParams: {
      amount: 4000,
      phoneNumber: '+251711223344',
      callbackUrl: 'https://afrotech.et/api/mpesa/callback',
      accountReference: 'MPESA01',
      transactionDesc: 'Service Deposit',
    },
    fetchFn: mockFetch,
  });

  assert.equal(push.ok, true);
  assert.equal(push.checkoutRequestId, 'ws_CO_112233');
  assert.match(seen[0].auth, /^Basic /);
  assert.equal(seen[1].auth, 'Bearer mpesa-tok-123');

  const query = await queryMpesaStkStatus({ config, checkoutRequestId: 'ws_CO_112233', fetchFn: mockFetch });
  assert.equal(query.verified, true);
  assert.equal(query.status, 'settled');
});

test('parseMpesaCallback extracts receipt metadata cleanly', () => {
  const parsed = parseMpesaCallback({
    Body: {
      stkCallback: {
        MerchantRequestID: 'MR-1',
        CheckoutRequestID: 'ws_CO_99',
        ResultCode: 0,
        ResultDesc: 'Processed',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 4000 },
            { Name: 'MpesaReceiptNumber', Value: 'SLK9812XYZ' },
            { Name: 'PhoneNumber', Value: '251711223344' },
          ],
        },
      },
    },
  });

  assert.equal(parsed.valid, true);
  assert.equal(parsed.success, true);
  assert.equal(parsed.mpesaReceiptNumber, 'SLK9812XYZ');
  assert.equal(parsed.checkoutRequestId, 'ws_CO_99');
});
