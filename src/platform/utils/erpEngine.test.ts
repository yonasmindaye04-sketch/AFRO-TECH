import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildReversalLines,
  computeFinancialStatements,
  computeMonthlyDepreciation,
  computeSmartReorderQty,
  detectAccountingExceptions,
  evaluateBom,
  evaluateThreeWayMatch,
  validateJournalEntry,
  type CoaAccount,
} from './erpEngine'

test('computeFinancialStatements aggregates P&L and Balance Sheet accurately', () => {
  const accounts: CoaAccount[] = [
    { code: '1110', name: 'Cash', root_type: 'Asset', account_type: 'Cash', balance: 50000 },
    { code: '1410', name: 'Stock', root_type: 'Asset', account_type: 'Stock', balance: 20000 },
    { code: '2110', name: 'Payable', root_type: 'Liability', account_type: 'Payable', balance: 15000 },
    { code: '3100', name: 'Capital', root_type: 'Equity', account_type: 'Equity', balance: 50000 },
    { code: '4100', name: 'Sales', root_type: 'Income', account_type: 'Income', balance: 12000 },
    { code: '5200', name: 'Rent', root_type: 'Expense', account_type: 'Expense', balance: 7000 },
  ]
  const fs = computeFinancialStatements(accounts, [
    { account_code: '1110', debit: 12000, credit: 0 },
    { account_code: '4100', debit: 0, credit: 12000 },
  ])
  assert.equal(fs.totalAssets, 70000)
  assert.equal(fs.totalLiabilities, 15000)
  assert.equal(fs.totalEquity, 50000)
  assert.equal(fs.netProfit, 5000)
  assert.equal(fs.liabilitiesAndEquity, 70000)
  assert.equal(fs.trialBalanced, true)
})

test('validateJournalEntry rejects unbalanced or single-line entries', () => {
  assert.equal(validateJournalEntry([{ account_code: '1110', debit: 100, credit: 0 }]).valid, false)
  assert.equal(
    validateJournalEntry([
      { account_code: '1110', debit: 100, credit: 0 },
      { account_code: '4100', debit: 0, credit: 90 },
    ]).valid,
    false
  )
  const ok = validateJournalEntry([
    { account_code: '5200', debit: 250.5, credit: 0 },
    { account_code: '1110', debit: 0, credit: 250.5 },
  ])
  assert.equal(ok.valid, true)
  assert.equal(ok.totalDebit, 250.5)
})

test('evaluateBom computes unit material cost and bottleneck buildable capacity', () => {
  const res = evaluateBom([
    { product_id: 'p1', qty_per_unit: 2, unit_cost: 55, available_stock: 15 },
    { product_id: 'p2', qty_per_unit: 1, unit_cost: 310, available_stock: 20 },
  ])
  assert.equal(res.unitMaterialCost, 420)
  assert.equal(res.maxBuildableUnits, 7)
})

test('computeMonthlyDepreciation caps at remaining depreciable value', () => {
  const step1 = computeMonthlyDepreciation({
    purchase_cost: 12000,
    salvage_value: 2000,
    useful_life_months: 10,
    accumulated_depreciation: 0,
  })
  assert.equal(step1.monthlyAmount, 1000)
  assert.equal(step1.netBookValue, 11000)
  assert.equal(step1.isFullyDepreciated, false)

  const finalStep = computeMonthlyDepreciation({
    purchase_cost: 12000,
    salvage_value: 2000,
    useful_life_months: 10,
    accumulated_depreciation: 9500,
  })
  assert.equal(finalStep.monthlyAmount, 500)
  assert.equal(finalStep.netBookValue, 2000)
  assert.equal(finalStep.isFullyDepreciated, true)
})

test('buildReversalLines swaps debits and credits cleanly while keeping balance', () => {
  const rev = buildReversalLines([
    { account_code: '5200', debit: 1500, credit: 0 },
    { account_code: '1110', debit: 0, credit: 1500 },
  ])
  assert.deepEqual(rev, [
    { account_code: '5200', debit: 0, credit: 1500 },
    { account_code: '1110', debit: 1500, credit: 0 },
  ])
  assert.equal(validateJournalEntry(rev).valid, true)
})

test('detectAccountingExceptions flags voucher imbalance and warehouse vs catalog drift', () => {
  const accounts: CoaAccount[] = [
    { code: '1210', name: 'AR', root_type: 'Asset', account_type: 'Receivable', balance: 500 },
    { code: '1410', name: 'Stock', root_type: 'Asset', account_type: 'Stock', balance: 1000 },
    { code: '2110', name: 'AP', root_type: 'Liability', account_type: 'Payable', balance: 200 },
  ]
  const findings = detectAccountingExceptions({
    accounts,
    glEntries: [
      { voucher_no: 'JV-1', account_code: '1210', debit: 500, credit: 0 },
      { voucher_no: 'JV-1', account_code: '4100', debit: 0, credit: 400 },
    ],
    products: [{ id: 'p1', name: 'Amox', stock: 10, cost_price: 100 }],
    warehouses: [{ id: 'w1', name: 'Main', stock_map: { p1: 7 } }],
    customers: [{ balance: 500 }],
    suppliers: [{ balance: 200 }],
  })
  const voucherCheck = findings.find((f) => f.id === 'exc-voucher-parity')
  const whCheck = findings.find((f) => f.id === 'exc-warehouse-sync')
  const arCheck = findings.find((f) => f.id === 'exc-ar-subledger')
  assert.equal(voucherCheck?.severity, 'error')
  assert.equal(whCheck?.severity, 'warn')
  assert.equal(arCheck?.severity, 'ok')
})

test('computeSmartReorderQty incorporates sales velocity, lead time, and safety stock', () => {
  const res = computeSmartReorderQty({
    stock: 20,
    threshold: 10,
    avgDailySales: 3,
    leadTimeDays: 7,
    safetyDays: 3,
  })
  assert.equal(res.dynamicReorderPoint, 30)
  assert.equal(res.needsReorder, true)
  assert.equal(res.daysOfCover, 6.7)
  assert.equal(res.suggestedOrderQty, 52)
})

test('evaluateThreeWayMatch detects exact match, partial receipt, and price/qty variance', () => {
  const exact = evaluateThreeWayMatch(
    [{ product_id: 'p1', product_name: 'Item A', quantity: 10, unit_cost: 50 }],
    [{ product_id: 'p1', received_qty: 10, billed_unit_cost: 50 }]
  )
  assert.equal(exact.status, 'matched')
  assert.equal(exact.amountVariance, 0)

  const partial = evaluateThreeWayMatch(
    [{ product_id: 'p1', product_name: 'Item A', quantity: 10, unit_cost: 50 }],
    [{ product_id: 'p1', received_qty: 6, billed_unit_cost: 50 }]
  )
  assert.equal(partial.status, 'partial')
  assert.equal(partial.qtyVarianceTotal, 4)

  const priceVar = evaluateThreeWayMatch(
    [{ product_id: 'p1', product_name: 'Item A', quantity: 10, unit_cost: 50 }],
    [{ product_id: 'p1', received_qty: 10, billed_unit_cost: 55 }]
  )
  assert.equal(priceVar.status, 'variance')
  assert.equal(priceVar.amountVariance, 50)
})

test('computeFinancialStatements and detectAccountingExceptions handle missing/malformed arrays without throwing', () => {
  const fs = computeFinancialStatements(undefined as unknown as CoaAccount[], undefined as unknown as [])
  assert.equal(fs.totalAssets, 0)
  assert.equal(fs.trialBalanced, true)

  const findings = detectAccountingExceptions({
    accounts: undefined,
    glEntries: undefined,
    products: undefined,
    warehouses: undefined,
    customers: undefined,
    suppliers: undefined,
  })
  assert.equal(findings.length, 2)
  assert.equal(findings[0]?.severity, 'ok')
})


