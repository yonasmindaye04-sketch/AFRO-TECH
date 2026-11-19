import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildLowStockSignature,
  collectLowStockSummary,
  evaluateProductStock,
  normalizeThreshold,
  resolveEffectiveThreshold,
} from './lowStockMonitor'

test('normalizeThreshold parses valid thresholds and falls back cleanly', () => {
  assert.equal(normalizeThreshold(25), 25)
  assert.equal(normalizeThreshold('18'), 18)
  assert.equal(normalizeThreshold(14.9), 14)
  assert.equal(normalizeThreshold(-5), 0)
  assert.equal(normalizeThreshold('not-a-number', 10), 10)
  assert.equal(normalizeThreshold('', 12), 12)
})

test('resolveEffectiveThreshold respects global vs per_product mode', () => {
  assert.equal(resolveEffectiveThreshold(5, 20, 'global'), 20)
  assert.equal(resolveEffectiveThreshold(5, 20, 'per_product'), 5)
  assert.equal(resolveEffectiveThreshold(null, 20, 'per_product'), 20)
  assert.equal(resolveEffectiveThreshold(undefined, 15, 'per_product'), 15)
})

test('evaluateProductStock triggers strictly below threshold and distinguishes out_of_stock', () => {
  const atThreshold = evaluateProductStock({ id: '1', name: 'A', stock: 10, low_stock_threshold: 10 }, 10, 'global')
  assert.equal(atThreshold.isBelowThreshold, false)
  assert.equal(atThreshold.level, 'in_stock')
  assert.equal(atThreshold.deficit, 0)

  const below = evaluateProductStock({ id: '2', name: 'B', unit: 'box', stock: 9, low_stock_threshold: 10 }, 10, 'global')
  assert.equal(below.isBelowThreshold, true)
  assert.equal(below.isOutOfStock, false)
  assert.equal(below.level, 'low_stock')
  assert.equal(below.deficit, 1)

  const zero = evaluateProductStock({ id: '3', name: 'C', unit: 'pcs', stock: 0, low_stock_threshold: 10 }, 10, 'global')
  assert.equal(zero.isBelowThreshold, true)
  assert.equal(zero.isOutOfStock, true)
  assert.equal(zero.level, 'out_of_stock')
  assert.equal(zero.deficit, 10)

  const disabled = evaluateProductStock({ id: '4', name: 'D', stock: 0 }, 0, 'global')
  assert.equal(disabled.isBelowThreshold, false)
  assert.equal(disabled.level, 'in_stock')
})

test('collectLowStockSummary sorts out-of-stock first then highest deficit and builds alert signature', () => {
  const products = [
    { id: 'p1', name: 'Amoxicillin', unit: 'box', stock: 48, low_stock_threshold: 10 },
    { id: 'p2', name: 'Paracetamol', unit: 'strip', stock: 8, low_stock_threshold: 15 },
    { id: 'p3', name: 'Insulin Pen', unit: 'pack', stock: 0, low_stock_threshold: 5 },
    { id: 'p4', name: 'Bandage Roll', unit: 'pcs', stock: 3, low_stock_threshold: 10 },
  ]

  const summary = collectLowStockSummary(products, 20, 'global')
  assert.equal(summary.totalProducts, 4)
  assert.equal(summary.outOfStockCount, 1)
  assert.equal(summary.lowStockCount, 2)
  assert.equal(summary.alertCount, 3)
  assert.equal(summary.healthyCount, 1)
  assert.deepEqual(
    summary.alerts.map((a) => a.productId),
    ['p3', 'p4', 'p2']
  )
  assert.equal(summary.alerts[0].severity, 'bad')
  assert.equal(summary.alerts[1].severity, 'warn')
  assert.equal(summary.alerts[1].deficit, 17)

  const sig1 = buildLowStockSignature(summary)
  const summaryRaised = collectLowStockSummary(products, 50, 'global')
  assert.equal(summaryRaised.alertCount, 4)
  assert.notEqual(sig1, buildLowStockSignature(summaryRaised))
})

test('collectLowStockSummary evaluates per_product overrides accurately when mode is per_product', () => {
  const products = [
    { id: 'p1', name: 'Amoxicillin', unit: 'box', stock: 48, low_stock_threshold: 50 },
    { id: 'p2', name: 'Paracetamol', unit: 'strip', stock: 8, low_stock_threshold: 5 },
  ]

  const summary = collectLowStockSummary(products, 10, 'per_product')
  assert.equal(summary.alertCount, 1)
  assert.equal(summary.alerts[0].productId, 'p1')
  assert.equal(summary.alerts[0].deficit, 2)
})
