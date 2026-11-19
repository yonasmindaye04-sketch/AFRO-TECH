import test from 'node:test'
import assert from 'node:assert/strict'
import { buildLabelPdfPath, encodeCode128Preview, resolveLabelCode } from './barcodeLabel'

test('resolveLabelCode returns trimmed barcode or deterministic fallback SKU', () => {
  assert.deepEqual(resolveLabelCode({ id: 'prod-1', barcode: ' 6001234567890 ' }), {
    code: '6001234567890',
    isGeneratedSku: false,
  })
  assert.deepEqual(resolveLabelCode({ id: 'prod-77x', barcode: '' }), {
    code: 'SKU-PROD77X',
    isGeneratedSku: true,
  })
})

test('encodeCode128Preview produces valid vector bar widths with quiet zones', () => {
  const res = encodeCode128Preview('6001234567890')
  assert.equal(res.value, '6001234567890')
  assert.equal(res.bars.length, 49)
  assert.equal(res.totalModules, 198)
})

test('buildLabelPdfPath builds clamped query params cleanly', () => {
  assert.equal(
    buildLabelPdfPath('prod-1', { layout: 'a4', copies: 120, includePrice: false, download: true }),
    '/api/v1/retail/products/prod-1/label.pdf?layout=a4&copies=60&price=0&download=1'
  )
  assert.equal(
    buildLabelPdfPath('prod-2', { layout: 'thermal', copies: 0, includePrice: true }),
    '/api/v1/retail/products/prod-2/label.pdf?layout=thermal&copies=1&price=1'
  )
})
