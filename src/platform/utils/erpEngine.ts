export type RootType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'

export interface CoaAccount {
  code: string
  name: string
  root_type: RootType
  account_type: string
  balance: number
}

export interface GlEntryRow {
  account_code: string
  debit: number
  credit: number
}

export interface FinancialStatements {
  assets: CoaAccount[]
  liabilities: CoaAccount[]
  equity: CoaAccount[]
  income: CoaAccount[]
  expenses: CoaAccount[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalIncome: number
  totalExpenses: number
  netProfit: number
  liabilitiesAndEquity: number
  trialDebit: number
  trialCredit: number
  trialBalanced: boolean
}

export interface JournalLineInput {
  account_code: string
  debit: number
  credit: number
}

export interface BomComponentInput {
  product_id: string
  qty_per_unit: number
  unit_cost: number
  available_stock: number
}

export interface FixedAssetInput {
  purchase_cost: number
  salvage_value: number
  useful_life_months: number
  accumulated_depreciation: number
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function computeFinancialStatements(accounts: CoaAccount[], glEntries: GlEntryRow[] = []): FinancialStatements {
  const safeAccounts = Array.isArray(accounts) ? accounts : []
  const safeGl = Array.isArray(glEntries) ? glEntries : []
  const byType = (t: RootType) => safeAccounts.filter((a) => a && a.root_type === t)
  const sum = (list: CoaAccount[]) => round2(list.reduce((s, a) => s + Number(a.balance || 0), 0))

  const assets = byType('Asset')
  const liabilities = byType('Liability')
  const equity = byType('Equity')
  const income = byType('Income')
  const expenses = byType('Expense')

  const totalAssets = sum(assets)
  const totalLiabilities = sum(liabilities)
  const totalEquity = sum(equity)
  const totalIncome = sum(income)
  const totalExpenses = sum(expenses)
  const netProfit = round2(totalIncome - totalExpenses)
  const liabilitiesAndEquity = round2(totalLiabilities + totalEquity + netProfit)

  const trialDebit = round2(safeGl.reduce((s, e) => s + Number(e?.debit || 0), 0))
  const trialCredit = round2(safeGl.reduce((s, e) => s + Number(e?.credit || 0), 0))

  return {
    assets,
    liabilities,
    equity,
    income,
    expenses,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalIncome,
    totalExpenses,
    netProfit,
    liabilitiesAndEquity,
    trialDebit,
    trialCredit,
    trialBalanced: Math.abs(trialDebit - trialCredit) < 0.01,
  }
}

export function validateJournalEntry(lines: JournalLineInput[]): { valid: boolean; totalDebit: number; totalCredit: number; error: string | null } {
  if (lines.length < 2) {
    return { valid: false, totalDebit: 0, totalCredit: 0, error: 'At least two account lines are required.' }
  }
  const totalDebit = round2(lines.reduce((s, l) => s + Math.max(0, Number(l.debit || 0)), 0))
  const totalCredit = round2(lines.reduce((s, l) => s + Math.max(0, Number(l.credit || 0)), 0))
  if (totalDebit <= 0) {
    return { valid: false, totalDebit, totalCredit, error: 'Total amount must be greater than zero.' }
  }
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return { valid: false, totalDebit, totalCredit, error: 'Total Debit must equal Total Credit.' }
  }
  return { valid: true, totalDebit, totalCredit, error: null }
}

export function evaluateBom(components: BomComponentInput[]): { unitMaterialCost: number; maxBuildableUnits: number } {
  if (!components.length) return { unitMaterialCost: 0, maxBuildableUnits: 0 }
  let unitMaterialCost = 0
  let maxBuildable = Infinity
  for (const c of components) {
    const req = Math.max(0, Number(c.qty_per_unit || 0))
    const cost = Math.max(0, Number(c.unit_cost || 0))
    const avail = Math.max(0, Number(c.available_stock || 0))
    unitMaterialCost += req * cost
    if (req > 0) {
      maxBuildable = Math.min(maxBuildable, Math.floor(avail / req))
    }
  }
  return {
    unitMaterialCost: round2(unitMaterialCost),
    maxBuildableUnits: maxBuildable === Infinity ? 0 : maxBuildable,
  }
}

export function computeMonthlyDepreciation(asset: FixedAssetInput): { monthlyAmount: number; nextAccumulated: number; netBookValue: number; isFullyDepreciated: boolean } {
  const cost = Math.max(0, Number(asset.purchase_cost || 0))
  const salvage = Math.min(cost, Math.max(0, Number(asset.salvage_value || 0)))
  const life = Math.max(1, Number(asset.useful_life_months || 1))
  const acc = Math.min(cost - salvage, Math.max(0, Number(asset.accumulated_depreciation || 0)))
  const remainingDepreciable = round2(Math.max(0, cost - salvage - acc))

  if (remainingDepreciable <= 0.005) {
    return {
      monthlyAmount: 0,
      nextAccumulated: round2(acc),
      netBookValue: round2(cost - acc),
      isFullyDepreciated: true,
    }
  }

  const rawMonthly = round2((cost - salvage) / life)
  const monthlyAmount = Math.min(remainingDepreciable, rawMonthly)
  const nextAccumulated = round2(acc + monthlyAmount)
  const netBookValue = round2(cost - nextAccumulated)

  return {
    monthlyAmount,
    nextAccumulated,
    netBookValue,
    isFullyDepreciated: round2(cost - salvage - nextAccumulated) <= 0.005,
  }
}

export function buildReversalLines(lines: JournalLineInput[]): JournalLineInput[] {
  return lines.map((l) => ({
    account_code: l.account_code,
    debit: round2(Math.max(0, Number(l.credit || 0))),
    credit: round2(Math.max(0, Number(l.debit || 0))),
  }))
}

export interface VoucherGlLine {
  voucher_no: string
  voucher_type?: string
  account_code: string
  debit: number
  credit: number
}

export interface AccountingExceptionItem {
  id: string
  severity: 'ok' | 'warn' | 'error'
  area: 'Trial Balance' | 'Vouchers' | 'Inventory Sync' | 'Inventory Valuation' | 'Receivables' | 'Payables'
  title: string
  detail: string
  variance: number
  suggestedAccountCode?: string
}

export function detectAccountingExceptions(input: {
  accounts?: CoaAccount[]
  glEntries?: VoucherGlLine[]
  products?: Array<{ id: string; name: string; stock: number; cost_price: number | string }>
  warehouses?: Array<{ id: string; name: string; stock_map?: Record<string, number> }>
  customers?: Array<{ balance?: number | string }>
  suppliers?: Array<{ balance?: number | string }>
}): AccountingExceptionItem[] {
  const findings: AccountingExceptionItem[] = []
  const accounts = Array.isArray(input?.accounts) ? input.accounts : []
  const glEntries = Array.isArray(input?.glEntries) ? input.glEntries : []
  const products = Array.isArray(input?.products) ? input.products : []
  const warehouses = Array.isArray(input?.warehouses) ? input.warehouses : []
  const customers = Array.isArray(input?.customers) ? input.customers : null
  const suppliers = Array.isArray(input?.suppliers) ? input.suppliers : null

  const fs = computeFinancialStatements(accounts, glEntries)

  // 1. Trial balance parity
  const trialDiff = round2(Math.abs(fs.trialDebit - fs.trialCredit))
  findings.push({
    id: 'exc-trial-balance',
    severity: trialDiff < 0.01 ? 'ok' : 'error',
    area: 'Trial Balance',
    title: trialDiff < 0.01 ? 'General Ledger Trial Balance matches' : 'Trial Balance out of balance',
    detail:
      trialDiff < 0.01
        ? `Total Debits (${fs.trialDebit.toFixed(2)} ETB) equal Total Credits (${fs.trialCredit.toFixed(2)} ETB).`
        : `Debits (${fs.trialDebit.toFixed(2)}) differ from Credits (${fs.trialCredit.toFixed(2)}) by ${trialDiff.toFixed(2)} ETB.`,
    variance: trialDiff,
  })

  // 2. Per-voucher balance check
  const byVoucher = new Map<string, { debit: number; credit: number; type: string }>()
  for (const row of glEntries) {
    if (!row) continue
    const key = row.voucher_no || 'UNKNOWN'
    const cur = byVoucher.get(key) ?? { debit: 0, credit: 0, type: row.voucher_type || 'Voucher' }
    cur.debit += Number(row.debit || 0)
    cur.credit += Number(row.credit || 0)
    byVoucher.set(key, cur)
  }
  const unbalancedVouchers: string[] = []
  for (const [vno, totals] of byVoucher.entries()) {
    if (Math.abs(totals.debit - totals.credit) >= 0.01) {
      unbalancedVouchers.push(`${vno} (diff ${round2(totals.debit - totals.credit)})`)
    }
  }
  findings.push({
    id: 'exc-voucher-parity',
    severity: unbalancedVouchers.length === 0 ? 'ok' : 'error',
    area: 'Vouchers',
    title:
      unbalancedVouchers.length === 0
        ? `All ${byVoucher.size} GL vouchers are balanced`
        : `${unbalancedVouchers.length} unbalanced voucher(s) detected`,
    detail:
      unbalancedVouchers.length === 0
        ? 'Every posted voucher has equal total debits and credits.'
        : `Inspect vouchers: ${unbalancedVouchers.slice(0, 4).join(', ')}`,
    variance: unbalancedVouchers.length,
  })

  // 3. Multi-warehouse vs catalog stock parity (ghost inventory check)
  if (products.length > 0 && warehouses.length > 0) {
    const mismatches: string[] = []
    for (const p of products) {
      const whTotal = warehouses.reduce((s, w) => s + Number(w?.stock_map?.[p.id] ?? 0), 0)
      const catStock = Number(p.stock || 0)
      if (Math.abs(whTotal - catStock) > 0.001) {
        mismatches.push(`${p.name}: catalog ${catStock} vs bins ${whTotal}`)
      }
    }
    findings.push({
      id: 'exc-warehouse-sync',
      severity: mismatches.length === 0 ? 'ok' : 'warn',
      area: 'Inventory Sync',
      title:
        mismatches.length === 0
          ? 'Warehouse bin totals match catalog stock'
          : `${mismatches.length} SKU(s) have warehouse vs catalog drift`,
      detail:
        mismatches.length === 0
          ? `Verified ${products.length} SKU(s) across ${warehouses.length} warehouse(s) with zero ghost inventory.`
          : mismatches.slice(0, 3).join(' · '),
      variance: mismatches.length,
    })
  }

  // 4. Inventory valuation vs GL 1410
  const invAccount = accounts.find((a) => a.code === '1410')
  if (invAccount && products.length > 0) {
    const physicalVal = round2(products.reduce((s, p) => s + Number(p.stock || 0) * Number(p.cost_price || 0), 0))
    const glVal = round2(invAccount.balance)
    const invDiff = round2(physicalVal - glVal)
    findings.push({
      id: 'exc-inv-gl',
      severity: Math.abs(invDiff) < 1 ? 'ok' : 'warn',
      area: 'Inventory Valuation',
      title:
        Math.abs(invDiff) < 1
          ? 'Inventory GL (1410) aligns with stock valuation'
          : 'Inventory GL (1410) differs from on-hand cost valuation',
      detail: `On-hand cost value: ${physicalVal.toFixed(2)} ETB vs GL 1410: ${glVal.toFixed(2)} ETB.`,
      variance: invDiff,
      suggestedAccountCode: '1410',
    })
  }

  // 5. Subledger AR/AP vs GL 1210 / 2110
  const arAccount = accounts.find((a) => a.code === '1210')
  if (arAccount && customers) {
    const custSub = round2(customers.reduce((s, c) => s + Number(c?.balance || 0), 0))
    const diff = round2(custSub - Number(arAccount.balance || 0))
    findings.push({
      id: 'exc-ar-subledger',
      severity: Math.abs(diff) < 1 ? 'ok' : 'warn',
      area: 'Receivables',
      title: Math.abs(diff) < 1 ? 'Accounts Receivable (1210) reconciled' : 'Customer balances differ from AR (1210)',
      detail: `Customer subledger: ${custSub.toFixed(2)} ETB vs GL 1210: ${round2(arAccount.balance).toFixed(2)} ETB.`,
      variance: diff,
      suggestedAccountCode: '1210',
    })
  }

  const apAccount = accounts.find((a) => a.code === '2110')
  if (apAccount && suppliers) {
    const supSub = round2(suppliers.reduce((s, sup) => s + Number(sup?.balance || 0), 0))
    const diff = round2(supSub - Number(apAccount.balance || 0))
    findings.push({
      id: 'exc-ap-subledger',
      severity: Math.abs(diff) < 1 ? 'ok' : 'warn',
      area: 'Payables',
      title: Math.abs(diff) < 1 ? 'Accounts Payable (2110) reconciled' : 'Supplier balances differ from AP (2110)',
      detail: `Supplier subledger: ${supSub.toFixed(2)} ETB vs GL 2110: ${round2(apAccount.balance).toFixed(2)} ETB.`,
      variance: diff,
      suggestedAccountCode: '2110',
    })
  }

  return findings
}

export interface SmartReorderInput {
  stock: number
  threshold: number
  avgDailySales: number
  leadTimeDays: number
  safetyDays: number
  targetCoverDays?: number
}

export function computeSmartReorderQty(input: SmartReorderInput): {
  dynamicReorderPoint: number
  daysOfCover: number | null
  suggestedOrderQty: number
  needsReorder: boolean
} {
  const stock = Math.max(0, Number(input.stock || 0))
  const threshold = Math.max(0, Number(input.threshold || 0))
  const velocity = Math.max(0, Number(input.avgDailySales || 0))
  const lead = Math.max(1, Number(input.leadTimeDays || 7))
  const safety = Math.max(0, Number(input.safetyDays || 3))
  const targetDays = Math.max(lead + safety, Number(input.targetCoverDays ?? lead + safety + 14))

  const velocityPoint = Math.ceil(velocity * (lead + safety))
  const dynamicReorderPoint = Math.max(threshold, velocityPoint)
  const daysOfCover = velocity > 0 ? Math.round((stock / velocity) * 10) / 10 : null
  const needsReorder = stock <= dynamicReorderPoint

  const targetStock = Math.max(threshold * 2, Math.ceil(velocity * targetDays))
  const suggestedOrderQty = needsReorder ? Math.max(1, targetStock - stock) : 0

  return {
    dynamicReorderPoint,
    daysOfCover,
    suggestedOrderQty,
    needsReorder,
  }
}

export interface ThreeWayOrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_cost: number
}

export interface ThreeWayReceivedItem {
  product_id: string
  received_qty: number
  billed_unit_cost: number
}

export function evaluateThreeWayMatch(
  ordered: ThreeWayOrderItem[],
  received: ThreeWayReceivedItem[]
): {
  status: 'matched' | 'partial' | 'variance'
  orderedTotal: number
  receivedTotal: number
  amountVariance: number
  qtyVarianceTotal: number
  lines: Array<{
    product_id: string
    product_name: string
    orderedQty: number
    receivedQty: number
    orderedCost: number
    billedCost: number
    qtyDiff: number
    costDiff: number
  }>
} {
  const recMap = new Map(received.map((r) => [r.product_id, r]))
  let orderedTotal = 0
  let receivedTotal = 0
  let qtyVarianceTotal = 0
  let hasPriceDiff = false
  let hasOverOrShort = false

  const lines = ordered.map((o) => {
    const r = recMap.get(o.product_id)
    const recQty = r ? Math.max(0, Number(r.received_qty || 0)) : o.quantity
    const billedCost = r ? Math.max(0, Number(r.billed_unit_cost || 0)) : o.unit_cost
    const lineOrdered = o.quantity * o.unit_cost
    const lineReceived = recQty * billedCost
    orderedTotal += lineOrdered
    receivedTotal += lineReceived
    const qtyDiff = recQty - o.quantity
    const costDiff = round2(billedCost - o.unit_cost)
    if (qtyDiff !== 0) {
      qtyVarianceTotal += Math.abs(qtyDiff)
      hasOverOrShort = true
    }
    if (Math.abs(costDiff) >= 0.01) hasPriceDiff = true
    return {
      product_id: o.product_id,
      product_name: o.product_name,
      orderedQty: o.quantity,
      receivedQty: recQty,
      orderedCost: round2(o.unit_cost),
      billedCost: round2(billedCost),
      qtyDiff,
      costDiff,
    }
  })

  const amountVariance = round2(receivedTotal - orderedTotal)
  const status: 'matched' | 'partial' | 'variance' =
    !hasPriceDiff && !hasOverOrShort
      ? 'matched'
      : !hasPriceDiff && lines.every((l) => l.receivedQty <= l.orderedQty)
        ? 'partial'
        : 'variance'

  return {
    status,
    orderedTotal: round2(orderedTotal),
    receivedTotal: round2(receivedTotal),
    amountVariance,
    qtyVarianceTotal,
    lines,
  }
}

