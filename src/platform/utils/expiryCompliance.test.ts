import test from 'node:test'
import assert from 'node:assert/strict'
import {
  filterExpiryBatches,
  formatExpiryCountdown,
  summarizeExpiryRisk,
  type ExpiryBatchItem,
} from './expiryCompliance'

const NOW = Date.parse('2026-11-19T12:00:00Z')

const SAMPLE_BATCHES: ExpiryBatchItem[] = [
  {
    id: 'b-exp',
    batch_no: 'AMX-2024-EXP',
    expiry_date: '2026-11-05',
    quantity: 4,
    cost_price: '310',
    product_id: 'prod-1',
    product_name: 'Amoxicillin 500mg Capsule',
    category: 'Antibiotics',
    expired: true,
    expiring_soon: false,
    days_remaining: -14,
    value_at_cost: 1240,
  },
  {
    id: 'b-crit',
    batch_no: 'AMX-2025-25D',
    expiry_date: '2026-12-14',
    quantity: 12,
    cost_price: '310',
    product_id: 'prod-1',
    product_name: 'Amoxicillin 500mg Capsule',
    category: 'Antibiotics',
    expired: false,
    expiring_soon: true,
    days_remaining: 25,
    value_at_cost: 3720,
  },
  {
    id: 'b-watch',
    batch_no: 'PCM-2026-75D',
    expiry_date: '2027-02-02',
    quantity: 8,
    cost_price: '55',
    product_id: 'prod-2',
    product_name: 'Paracetamol 500mg Tablet',
    category: 'Analgesics',
    expired: false,
    expiring_soon: true,
    days_remaining: 75,
    value_at_cost: 440,
  },
]

test('formatExpiryCountdown renders expired, critical, and watch countdowns clearly', () => {
  assert.deepEqual(formatExpiryCountdown(SAMPLE_BATCHES[0], NOW), {
    label: 'Expired 14d ago',
    tone: 'bad',
  })
  assert.deepEqual(formatExpiryCountdown(SAMPLE_BATCHES[1], NOW), {
    label: '25d left (Critical)',
    tone: 'warn',
  })
  assert.deepEqual(formatExpiryCountdown(SAMPLE_BATCHES[2], NOW), {
    label: '75d left',
    tone: 'warn',
  })
})

test('filterExpiryBatches filters by status tier and batch/product recall query', () => {
  assert.equal(filterExpiryBatches(SAMPLE_BATCHES, { statusFilter: 'expired', search: '' }, NOW).length, 1)
  assert.equal(filterExpiryBatches(SAMPLE_BATCHES, { statusFilter: 'critical_30', search: '' }, NOW).length, 1)
  assert.equal(filterExpiryBatches(SAMPLE_BATCHES, { statusFilter: 'soon', search: '' }, NOW).length, 2)

  const recallHits = filterExpiryBatches(
    SAMPLE_BATCHES,
    { statusFilter: 'all', search: 'PCM-2026' },
    NOW
  )
  assert.equal(recallHits.length, 1)
  assert.equal(recallHits[0].product_name, 'Paracetamol 500mg Tablet')
})

test('summarizeExpiryRisk totals expired value, at-risk value, and critical batch counts', () => {
  const summary = summarizeExpiryRisk(SAMPLE_BATCHES, NOW)
  assert.equal(summary.totalBatches, 3)
  assert.equal(summary.expiredCount, 1)
  assert.equal(summary.critical30Count, 1)
  assert.equal(summary.expiredUnits, 4)
  assert.equal(summary.atRiskUnits, 20)
  assert.equal(summary.expiredValue, 1240)
  assert.equal(summary.atRiskValue, 4160)
})
