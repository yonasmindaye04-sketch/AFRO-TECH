import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTelebirrOrderSummary,
  normalizeTelebirrMerchantConfig,
  sanitizeTelebirrOrderNote,
  validateTelebirrDirectForm,
} from './telebirrCheckout';

test('sanitizeTelebirrOrderNote strips Fabric-disallowed punctuation and caps at 24 characters', () => {
  assert.equal(
    sanitizeTelebirrOrderNote('  Milestone #1 <urgent> & QA phase extra chars  '),
    'Milestone 1 urgent QA ph',
  );
  assert.equal(sanitizeTelebirrOrderNote('   '), '');
});

test('normalizeTelebirrMerchantConfig parses live and sandbox responses safely without exposing secrets', () => {
  const live = normalizeTelebirrMerchantConfig({
    mode: 'live',
    merchant_configured: true,
    merchant_code_masked: '55••20',
    public_key_configured: true,
    web_gateway_host: 'developerportal.ethiotelebirr.et:38443',
  });
  assert.equal(live.mode, 'live');
  assert.equal(live.merchantConfigured, true);
  assert.equal(live.merchantCodeMasked, '55••20');
  assert.equal(live.publicKeyConfigured, true);
  assert.equal(live.webGatewayHost, 'developerportal.ethiotelebirr.et:38443');

  const fallback = normalizeTelebirrMerchantConfig(null);
  assert.equal(fallback.mode, 'sandbox');
  assert.equal(fallback.merchantConfigured, false);
  assert.equal(fallback.merchantCodeMasked, null);
});

test('buildTelebirrOrderSummary formats deposit, full, and custom ETB totals with sanitized title preview', () => {
  const summary = buildTelebirrOrderSummary({
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    notes: 'Phase 1 @ Bole',
  });
  assert.equal(summary.amount, 4000);
  assert.equal(summary.formattedAmount, '4,000 ETB');
  assert.equal(summary.sanitizedNote, 'Phase 1 Bole');
  assert.match(summary.fabricTitlePreview, /40% Deposit.*Phase 1 Bole/);
});

test('validateTelebirrDirectForm validates required identity, optional wallet phone, and ETB bounds', () => {
  const bad = validateTelebirrDirectForm({
    serviceId: 1,
    paymentPlan: 'custom',
    customAmount: '20',
    fullName: 'A',
    email: 'bad-email',
    phone: '12',
    notes: 'Ref #1',
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.fullName);
  assert.ok(bad.errors.email);
  assert.ok(bad.errors.phone);
  assert.ok(bad.errors.amount);

  const ok = validateTelebirrDirectForm({
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Selamawit Tadesse',
    email: 'selam@afrotech.et',
    phone: '+251 911 223344',
    notes: 'Kickoff Deposit',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.amount, 4000);
  assert.equal(ok.sanitizedNote, 'Kickoff Deposit');
});
