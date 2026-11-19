import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allocateFefoBatches,
  enrichBatchCompliance,
  isBatchExpired,
  recomputeProductBatchMetrics,
} from './fefoBatchEngine.js';

const NOW = Date.parse('2026-11-19T12:00:00Z');

test('isBatchExpired detects expired dates vs non-expired dates accurately', () => {
  assert.equal(isBatchExpired({ expiry_date: '2026-11-01' }, NOW), true);
  assert.equal(isBatchExpired({ expiry_date: '2026-11-19' }, NOW), false);
  assert.equal(isBatchExpired({ expiry_date: '2026-12-25' }, NOW), false);
  assert.equal(isBatchExpired({ expiry_date: null }, NOW), false);
});

test('allocateFefoBatches picks earliest-expiring non-expired batch first and skips expired batches', () => {
  const batches = [
    { id: 'b-late', product_id: 'p1', batch_no: 'LATE', expiry_date: '2027-05-01', quantity: 20, created_at: '2026-01-01' },
    { id: 'b-exp', product_id: 'p1', batch_no: 'EXPIRED', expiry_date: '2026-10-01', quantity: 10, created_at: '2025-01-01' },
    { id: 'b-soon', product_id: 'p1', batch_no: 'SOON', expiry_date: '2026-12-10', quantity: 5, created_at: '2026-02-01' },
  ];

  const res = allocateFefoBatches(batches, 'p1', 8, NOW);
  assert.equal(res.ok, true);
  assert.equal(res.totalDeducted, 8);
  assert.deepEqual(
    res.allocations.map((a) => ({ batch_no: a.batch_no, qty: a.qty })),
    [
      { batch_no: 'SOON', qty: 5 },
      { batch_no: 'LATE', qty: 3 },
    ]
  );
  assert.equal(batches.find((b) => b.id === 'b-exp')?.quantity, 10);
  assert.equal(batches.find((b) => b.id === 'b-soon')?.quantity, 0);
  assert.equal(batches.find((b) => b.id === 'b-late')?.quantity, 17);
});

test('allocateFefoBatches blocks sale when only expired stock remains', () => {
  const batches = [
    { id: 'b-exp', product_id: 'p1', batch_no: 'EXPIRED', expiry_date: '2026-11-01', quantity: 6 },
    { id: 'b-ok', product_id: 'p1', batch_no: 'OK', expiry_date: '2027-01-01', quantity: 2 },
  ];

  const blocked = allocateFefoBatches(batches, 'p1', 3, NOW);
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /expired unit\(s\) blocked by FEFO guard/i);
  assert.equal(batches[0].quantity, 6);
  assert.equal(batches[1].quantity, 2);
});

test('recomputeProductBatchMetrics separates sellable_stock, expired_qty, and expiring_soon', () => {
  const product = { id: 'p1', sell_by_pill: true, pills_per_unit: 20, stock: 0 };
  const batches = [
    { id: 'b1', product_id: 'p1', expiry_date: '2026-11-01', quantity: 4 },
    { id: 'b2', product_id: 'p1', expiry_date: '2026-12-10', quantity: 6 },
    { id: 'b3', product_id: 'p1', expiry_date: '2027-08-01', quantity: 10 },
  ];

  recomputeProductBatchMetrics(product, batches, NOW);
  assert.equal(product.sellable_stock, 16);
  assert.equal(product.stock, 16);
  assert.equal(product.expired_qty, 4);
  assert.equal(product.expiring_soon, 6);
  assert.equal(product.display_stock, 320);
});

test('enrichBatchCompliance calculates days_remaining, value_at_cost, and urgency tiers', () => {
  const expired = enrichBatchCompliance(
    { id: 'b1', expiry_date: '2026-11-05', quantity: 4, cost_price: '310' },
    NOW
  );
  assert.equal(expired.expired, true);
  assert.equal(expired.urgency, 'expired');
  assert.equal(expired.value_at_cost, 1240);
  assert.ok((expired.days_remaining ?? 0) < 0);

  const critical = enrichBatchCompliance(
    { id: 'b2', expiry_date: '2026-12-09', quantity: 5, cost_price: '100' },
    NOW
  );
  assert.equal(critical.expired, false);
  assert.equal(critical.expiring_soon, true);
  assert.equal(critical.urgency, 'critical_30');
  assert.equal(critical.value_at_cost, 500);
});
