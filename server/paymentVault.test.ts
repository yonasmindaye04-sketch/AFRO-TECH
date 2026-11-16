import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from './paymentVault.js';

test('encryptSecret and decryptSecret round-trip cleanly and never expose plaintext', () => {
  const secret = 'CHASECK_TEST-987654321abcdef';
  const encrypted = encryptSecret(secret, 'unit-test-master-key');
  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.split(':').length, 3);
  assert.equal(decryptSecret(encrypted, 'unit-test-master-key'), secret);
});

test('decryptSecret fails when tampered or decrypted with wrong key', () => {
  const encrypted = encryptSecret('sk_live_secret123', 'key-a');
  assert.throws(() => decryptSecret(encrypted, 'key-b'));
});

test('maskSecret hides sensitive characters while keeping recognizable tail', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('1234'), '••••••••');
  assert.equal(maskSecret('chapa_live_12345678abcd'), 'chapa_••••••••abcd');
});

test('signWebhookPayload and verifyWebhookSignature validate HMAC-SHA256 payloads timing-safely', () => {
  const body = { tx_ref: 'AFRO-1001', amount: 450, status: 'settled' };
  const secret = 'whsec_test_9911';
  const signature = signWebhookPayload(body, secret);
  assert.equal(verifyWebhookSignature(body, secret, signature), true);
  assert.equal(verifyWebhookSignature(body, secret, `${signature.slice(0, -1)}0`), false);
  assert.equal(verifyWebhookSignature(body, 'wrong-secret', signature), false);
});
