import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPaymentLinkUrl,
  computeGatewayFee,
  mapPosRailToGateway,
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

  const telebirrLiveMissing = validateGatewayConfig(
    'telebirr',
    { merchant_id: '554120', secret_key: 'sec', settlement_account: '+251911000111' },
    false,
    'live',
  )
  assert.equal(telebirrLiveMissing.valid, false)
  assert.ok(telebirrLiveMissing.errors.fabric_app_id)
  assert.ok(telebirrLiveMissing.errors.merchant_app_id)
  assert.ok(telebirrLiveMissing.errors.private_key)
})

test('mapPosRailToGateway maps POS payment rails accurately', () => {
  assert.equal(mapPosRailToGateway('telebirr'), 'telebirr')
  assert.equal(mapPosRailToGateway('mpesa'), 'mpesa')
  assert.equal(mapPosRailToGateway('cbe'), 'cbe_bank')
  assert.equal(mapPosRailToGateway('card'), 'chapa')
  assert.equal(mapPosRailToGateway('cash'), null)
  assert.equal(mapPosRailToGateway('credit'), null)
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
