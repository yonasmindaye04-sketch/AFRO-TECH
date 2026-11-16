import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultConfigForDataset, parseReportQuery, runCustomReport } from './reportBuilderEngine'

test('parseReportQuery translates plain-English ERP questions into accurate datasets and filters', () => {
  const lowStock = parseReportQuery('show low stock products')
  assert.equal(lowStock.matched, true)
  assert.equal(lowStock.config.dataset, 'products')
  assert.equal(lowStock.config.filters[0]?.field, 'stock')
  assert.equal(lowStock.config.sortDir, 'asc')

  const expenses = parseReportQuery('expenses over 1000 by category')
  assert.equal(expenses.matched, true)
  assert.equal(expenses.config.dataset, 'expenses')
  assert.equal(expenses.config.filters[0]?.value, '1000')
  assert.equal(expenses.config.groupBy, 'category')

  const unpaidPo = parseReportQuery('unpaid supplier purchases')
  assert.equal(unpaidPo.matched, true)
  assert.equal(unpaidPo.config.dataset, 'purchases')
  assert.equal(unpaidPo.config.filters[0]?.field, 'balance_due')
})

test('runCustomReport filters, sorts, sums, and groups dynamically', () => {
  const rows = [
    { invoice_no: 'INV-1', customer_name: 'A', payment_method: 'cash', total: 500, discount: 0 },
    { invoice_no: 'INV-2', customer_name: 'B', payment_method: 'credit', total: 1500, discount: 50 },
    { invoice_no: 'INV-3', customer_name: 'C', payment_method: 'cash', total: 800, discount: 0 },
  ]

  const flatCfg = defaultConfigForDataset('sales')
  flatCfg.filters = [{ field: 'total', op: 'gte', value: '800' }]
  flatCfg.sortBy = 'total'
  flatCfg.sortDir = 'desc'

  const flatRes = runCustomReport(rows, flatCfg)
  assert.equal(flatRes.totalCount, 2)
  assert.equal(flatRes.rows[0].invoice_no, 'INV-2')
  assert.equal(flatRes.sums.total, 2300)

  const grpCfg = { ...defaultConfigForDataset('sales'), groupBy: 'payment_method' }
  const grpRes = runCustomReport(rows, grpCfg)
  assert.equal(grpRes.rows.length, 2)
  const cashBucket = grpRes.rows.find((r) => r.payment_method === 'cash')
  assert.equal(cashBucket?.count, 2)
  assert.equal(cashBucket?.total, 1300)
})
