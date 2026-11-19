import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGatewayReadiness,
  formatEtb,
  formatMpesaMsisdnPreview,
  GATEWAY_REQUIREMENTS,
  isEthiopianMobileNumber,
  parseStartingEtbPrice,
  PAYABLE_SERVICES,
  resolvePayableAmount,
  SERVICE_PAYMENT_PROVIDERS,
  validateServicePaymentForm,
} from './serviceCheckout';

test('parseStartingEtbPrice and PAYABLE_SERVICES parse catalog pricing accurately', () => {
  assert.equal(parseStartingEtbPrice('10,000 – 18,000'), 10000);
  assert.equal(parseStartingEtbPrice('280,000 – 1M+'), 280000);
  const landing = PAYABLE_SERVICES.find((s) => s.id === 1);
  assert.ok(landing);
  assert.equal(landing.basePriceEtb, 10000);
  assert.equal(landing.depositAmountEtb, 4000);
});

test('resolvePayableAmount handles kickoff deposit, full package, and custom quote amounts', () => {
  assert.equal(resolvePayableAmount(1, 'deposit', ''), 4000);
  assert.equal(resolvePayableAmount(1, 'full', ''), 10000);
  assert.equal(resolvePayableAmount(1, 'custom', '25,500'), 25500);
  assert.equal(resolvePayableAmount(1, 'custom', 'abc'), 0);
});

test('validateServicePaymentForm rejects missing/invalid fields and accepts clean input', () => {
  const invalid = validateServicePaymentForm({
    serviceId: 1,
    paymentPlan: 'custom',
    customAmount: '10',
    fullName: 'A',
    email: 'not-an-email',
    phone: '12',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.fullName);
  assert.ok(invalid.errors.email);
  assert.ok(invalid.errors.phone);
  assert.ok(invalid.errors.amount);

  const valid = validateServicePaymentForm({
    serviceId: 4,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Dawit Bekele',
    email: 'dawit@example.com',
    phone: '+251 911 223 344',
  });
  assert.equal(valid.valid, true);
  assert.equal(valid.amount, 28000);
  assert.equal(formatEtb(valid.amount), '28,000 ETB');
});

test('SERVICE_PAYMENT_PROVIDERS and M-Pesa MSISDN rules enforce mobile requirement cleanly', () => {
  assert.deepEqual(
    SERVICE_PAYMENT_PROVIDERS.map((p) => p.id),
    ['chapa', 'telebirr', 'mpesa'],
  );
  assert.equal(isEthiopianMobileNumber('0711223344'), true);
  assert.equal(isEthiopianMobileNumber('+251 910 011 818'), true);
  assert.equal(isEthiopianMobileNumber('12345'), false);
  assert.equal(formatMpesaMsisdnPreview('0711 223344'), '251711223344');
  assert.equal(formatMpesaMsisdnPreview('12345'), null);

  const missingMpesaPhone = validateServicePaymentForm({
    provider: 'mpesa',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: 'abebe@example.com',
    phone: '',
  });
  assert.equal(missingMpesaPhone.valid, false);
  assert.ok(missingMpesaPhone.errors.phone);

  const validMpesa = validateServicePaymentForm({
    provider: 'mpesa',
    serviceId: 1,
    paymentPlan: 'custom',
    customAmount: '1500.4',
    fullName: 'Abebe Bikila',
    email: 'abebe@example.com',
    phone: '+251 711 223344',
  });
  assert.equal(validMpesa.valid, true);
  assert.equal(validMpesa.amount, 1500);
});

test('GATEWAY_REQUIREMENTS and evaluateGatewayReadiness reflect provider-specific rules', () => {
  assert.equal(GATEWAY_REQUIREMENTS.chapa.phoneRequired, false);
  assert.equal(GATEWAY_REQUIREMENTS.telebirr.referenceMaxLen, 24);
  assert.equal(GATEWAY_REQUIREMENTS.mpesa.phoneRequired, true);
  assert.equal(GATEWAY_REQUIREMENTS.mpesa.wholeEtbOnly, true);

  const mpesaUnmet = evaluateGatewayReadiness({
    provider: 'mpesa',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Sara Tadesse',
    email: 'sara@example.com',
    phone: '',
  });
  const phoneCheck = mpesaUnmet.find((item) => item.id === 'phone');
  assert.equal(phoneCheck?.required, true);
  assert.equal(phoneCheck?.met, false);

  const mpesaReady = evaluateGatewayReadiness({
    provider: 'mpesa',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Sara Tadesse',
    email: 'sara@example.com',
    phone: '0711223344',
  });
  assert.equal(mpesaReady.every((item) => item.met), true);
  assert.ok(mpesaReady.find((item) => item.id === 'phone')?.label.includes('251711223344'));
});

test('Telebirr provider allows blank receipt email while rejecting malformed email format; Chapa still requires email', () => {
  const telebirrBlankOk = validateServicePaymentForm({
    provider: 'telebirr',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: '',
    phone: '',
  });
  assert.equal(telebirrBlankOk.valid, true);
  assert.equal(telebirrBlankOk.receiptEmail, null);

  const telebirrBadEmail = validateServicePaymentForm({
    provider: 'telebirr',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: 'bad@',
    phone: '',
  });
  assert.equal(telebirrBadEmail.valid, false);
  assert.ok(telebirrBadEmail.errors.email);

  const chapaBlankRejected = validateServicePaymentForm({
    provider: 'chapa',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: '',
    phone: '',
  });
  assert.equal(chapaBlankRejected.valid, false);
  assert.ok(chapaBlankRejected.errors.email);

  const readinessBlank = evaluateGatewayReadiness({
    provider: 'telebirr',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: '',
    phone: '',
  });
  assert.equal(readinessBlank.find((item) => item.id === 'identity')?.met, true);

  const readinessMalformed = evaluateGatewayReadiness({
    provider: 'telebirr',
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Abebe Bikila',
    email: 'invalid-email',
    phone: '',
  });
  assert.equal(readinessMalformed.find((item) => item.id === 'identity')?.met, false);
});
