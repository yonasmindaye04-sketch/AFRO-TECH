import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPaymentLinkUrl,
  computeGatewayFee,
  validateGatewayConfig,
  validateOutboundPayout,
} from './paymentEngine'

test('validateGatewayConfig requires mandatory merchant fields unless secret already stored', () => {
  const missing = validateGatewayConfig('chapa', { public_key: 'CHAPUBK_TEST-1' }, false)
  assert.equal(missing.valid, false)
  assert.ok(missing.errors.secret_key)
  assert.ok(missing.errors.settlement_account)

  const okWithExistingSecret = validateGatewayConfig(
    'chapa',
    { public_key: 'CHAPUBK_TEST-1', settlement_account: '100023456789' },
    true,
  )
  assert.equal(okWithExistingSecret.valid, true)
})

test('computeGatewayFee calculates accurate fee and net settlement per provider', () => {
  const chapa = computeGatewayFee(1000, 'chapa')
  assert.equal(chapa.gross, 1000)
  assert.equal(chapa.fee, 25)
  assert.equal(chapa.net, 975)

  const cbe = computeGatewayFee(1000, 'cbe_bank')
  assert.equal(cbe.fee, 0)
  assert.equal(cbe.net, 1000)
})

test('buildPaymentLinkUrl constructs clean shareable checkout URLs', () => {
  assert.equal(buildPaymentLinkUrl('https://afro.et/', 'tok_abc 123'), 'https://afro.et/pay/tok_abc%20123')
})

test('validateOutboundPayout enforces enabled gateway, outbound support, positive amount, and destination', () => {
  assert.equal(
    validateOutboundPayout({
      amount: 500,
      destinationAccount: '1000555666',
      providerEnabled: false,
      providerSupportsOutbound: true,
    }).valid,
    false,
  )
  assert.equal(
    validateOutboundPayout({
      amount: 500,
      destinationAccount: '1000555666',
      providerEnabled: true,
      providerSupportsOutbound: false,
    }).valid,
    false,
  )
  assert.equal(
    validateOutboundPayout({
      amount: 0,
      destinationAccount: '1000555666',
      providerEnabled: true,
      providerSupportsOutbound: true,
    }).valid,
    false,
  )
  assert.equal(
    validateOutboundPayout({
      amount: 500,
      destinationAccount: '1000555666',
      providerEnabled: true,
      providerSupportsOutbound: true,
    }).valid,
    true,
  )
})
